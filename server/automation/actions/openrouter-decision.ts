import { currentLogScope, logOperation } from '../../shared/logger.js'

type Request = {
  kind: 'lead' | 'topic'
  model: string
  screenshot: Buffer
  timeout: number
  payload: Record<string, unknown>
  errorPrefix: string
  key?: string
  fetcher?: typeof fetch
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Inspect JPEG headers without decoding, persisting, or logging the image. */
function imageDetails(bytes: Buffer) {
  const jpeg = bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8
  let width: number | undefined, height: number | undefined
  if (jpeg) {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]
      if (marker === 0xff) { offset++; continue }
      if (marker === 0xda || marker === 0xd9) break
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > bytes.length) break
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 5)
        width = bytes.readUInt16BE(offset + 7)
        break
      }
      offset += 2 + length
    }
  }
  return { imageBytes: bytes.length, imageMime: 'image/jpeg', imageHasJpegHeader: jpeg,
    imageHasJpegEnd: jpeg && bytes.readUInt16BE(bytes.length - 2) === 0xffd9, imageWidth: width, imageHeight: height }
}

/** One correlated event per Decisions request; only image metadata and sanitized error fields leave memory. */
export async function requestOpenRouterDecision(input: Request): Promise<unknown> {
  const timeoutMs = Math.max(1, Math.ceil(input.timeout))
  const parent = currentLogScope()
  return logOperation('automation.openrouter_decision', {
    targetUsername: parent?.fields.targetUsername, leadId: parent?.fields.leadId,
    kind: input.kind, model: input.model, timeoutMs, ...imageDetails(input.screenshot), stage: 'configuration',
  }, async scope => {
    const key = input.key ?? process.env.OPENROUTER_API_KEY
    scope.redact([key?.trim() ?? '', input.screenshot.toString('base64')])
    if (!key?.trim()) throw new Error('OpenRouter key is missing')
    const body = JSON.stringify(input.payload)
    scope.add({ requestBytes: Buffer.byteLength(body), stage: 'request' })
    const signal = AbortSignal.timeout(timeoutMs)
    let response: Response | undefined
    try {
      response = await (input.fetcher ?? fetch)('https://openrouter.ai/api/alpha/decisions', {
        method: 'POST', headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' }, signal, body,
      })
      scope.add({ httpStatus: response.status, stage: 'response',
        providerRequestId: response.headers.get('x-request-id'), generationId: response.headers.get('x-generation-id'),
        cfRay: response.headers.get('cf-ray'), retryAfter: response.headers.get('retry-after'),
        responseContentType: response.headers.get('content-type') })
      const text = await response.text()
      scope.add({ responseBytes: Buffer.byteLength(text) })
      let data: unknown
      try { data = JSON.parse(text); scope.add({ responseIsJson: true }) }
      catch {
        scope.add({ responseIsJson: false })
        if (response.ok) throw new Error(`${input.errorPrefix} returned invalid JSON`)
      }
      const error = object(object(data).error), metadata = object(error.metadata)
      let raw = metadata.raw
      if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { /* Plain provider message. */ } }
      const upstream = object(raw), upstreamError = object(upstream.error)
      scope.add(scope.safeFields({
        providerErrorMessage: error.message, providerErrorCode: error.code, providerErrorType: metadata.error_type,
        providerName: metadata.provider_name, providerCode: metadata.provider_code,
        upstreamErrorMessage: upstreamError.message ?? upstream.message ?? upstream.detail ?? (typeof raw === 'string' ? raw : undefined),
        upstreamErrorCode: upstreamError.code ?? upstream.code,
      }))
      if (!response.ok) throw new Error(`${input.errorPrefix} returned HTTP ${response.status}`)
      const answers = object(object(data).answers)
      scope.add(scope.safeFields({ answerTypes: Object.fromEntries(Object.keys(object(input.payload.questions)).map(name => [name, object(answers[name]).type ?? 'missing'])) }))
      if (object(data).error != null) scope.add({ outcome: 'error', failureKind: 'provider' })
      scope.add({ stage: 'complete' })
      return data
    } catch (error) {
      scope.add({ failureKind: signal.aborted ? 'timeout' : !response ? 'network' : !response.ok ? 'http' : 'response',
        networkCode: object(object(error).cause).code })
      throw error
    }
  })
}
