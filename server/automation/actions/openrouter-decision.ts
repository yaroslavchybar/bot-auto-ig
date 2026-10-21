import { currentLogScope, logOperation } from '../../shared/logger.js'
import { setTimeout as delay } from 'node:timers/promises'

type Request = {
  kind: 'lead' | 'lead_follow_check' | 'topic' | 'lead_post'
  model: string
  screenshot: Buffer
  timeout: number
  payload: Record<string, unknown>
  errorPrefix: string
  key?: string
  fetcher?: typeof fetch
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export class DecisionRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecisionRefusedError'
  }
}

/** Inspect JPEG headers without decoding, persisting, or logging the image. */
function imageDetails(bytes: Buffer) {
  const jpeg = bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8
  let width: number | undefined, height: number | undefined
  if (jpeg) {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset] !== 0xff) break
      const marker = bytes[offset + 1]
      if (marker === 0xff) {
        offset++
        continue
      }
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
  return {
    imageBytes: bytes.length,
    imageMime: 'image/jpeg',
    imageHasJpegHeader: jpeg,
    imageHasJpegEnd: jpeg && bytes.readUInt16BE(bytes.length - 2) === 0xffd9,
    imageWidth: width,
    imageHeight: height,
  }
}

const transientStatus = (status: number | undefined) =>
  status === 429 || status === 500 || status === 502 || status === 503 || status === 504

function retryDelay(value: string | null): number {
  const backoff = 100 + Math.floor(Math.random() * 151)
  if (!value) return backoff
  const seconds = Number(value)
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(requested) ? Math.max(backoff, requested) : backoff
}

/** At most two attempts share one deadline and one event; never retry refusals or invalid answers. */
export async function requestOpenRouterDecision(input: Request): Promise<unknown> {
  const timeoutMs = Math.max(1, Math.ceil(input.timeout))
  const parent = currentLogScope()
  return logOperation(
    'automation.openrouter_decision',
    {
      targetUsername: parent?.fields.targetUsername,
      leadId: parent?.fields.leadId,
      kind: input.kind,
      model: input.model,
      timeoutMs,
      ...imageDetails(input.screenshot),
      stage: 'configuration',
    },
    async (scope) => {
      const key = input.key ?? process.env.OPENROUTER_API_KEY
      scope.redact([key?.trim() ?? '', input.screenshot.toString('base64')])
      if (!key?.trim()) throw new Error('OpenRouter key is missing')
      const body = JSON.stringify(input.payload)
      scope.add({ requestBytes: Buffer.byteLength(body), stage: 'request' })
      const deadline = performance.now() + timeoutMs
      const overallSignal = AbortSignal.timeout(timeoutMs)
      const failures: Record<string, unknown>[] = []
      let previousFields: string[] = []
      for (let attempt = 1; attempt <= 2; attempt++) {
        // Keep the final fields about the current attempt; prior failures stay in retryFailures.
        const fields: Record<string, unknown> = { attemptCount: attempt, retryCount: attempt - 1, stage: 'request' }
        const annotate = (values: Record<string, unknown>) => Object.assign(fields, values)
        const remaining = Math.floor(deadline - performance.now())
        if (remaining <= 0) {
          scope.add({ failureKind: 'timeout' })
          throw new DOMException('Decision deadline exceeded', 'TimeoutError')
        }
        const signal = AbortSignal.any([
          overallSignal,
          AbortSignal.timeout(attempt === 1 ? Math.ceil(remaining / 2) : remaining),
        ])
        let response: Response | undefined, providerStatus: number | undefined
        let readingBody = false
        try {
          response = await (input.fetcher ?? fetch)('https://openrouter.ai/api/alpha/decisions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
            signal,
            body,
          })
          annotate({
            httpStatus: response.status,
            stage: 'response',
            providerRequestId: response.headers.get('x-request-id'),
            generationId: response.headers.get('x-generation-id'),
            cfRay: response.headers.get('cf-ray'),
            retryAfter: response.headers.get('retry-after'),
            responseContentType: response.headers.get('content-type'),
          })
          readingBody = true
          const text = await response.text()
          readingBody = false
          signal.throwIfAborted()
          annotate({ responseBytes: Buffer.byteLength(text) })
          let data: unknown
          try {
            data = JSON.parse(text)
            annotate({ responseIsJson: true })
          } catch {
            annotate({ responseIsJson: false })
            if (response.ok) throw new Error(`${input.errorPrefix} returned invalid JSON`)
          }
          const error = object(object(data).error),
            metadata = object(error.metadata)
          let raw = metadata.raw
          if (typeof raw === 'string') {
            try {
              raw = JSON.parse(raw)
            } catch {
              /* Plain provider message. */
            }
          }
          const upstream = object(raw),
            upstreamError = object(upstream.error)
          annotate(
            scope.safeFields({
              providerErrorMessage: error.message,
              providerErrorCode: error.code,
              providerErrorType: metadata.error_type,
              providerName: metadata.provider_name,
              providerCode: metadata.provider_code,
              upstreamErrorMessage:
                upstreamError.message ??
                upstream.message ??
                upstream.detail ??
                (typeof raw === 'string' ? raw : undefined),
              upstreamErrorCode: upstreamError.code ?? upstream.code,
            }),
          )
          if (
            typeof error.message === 'string' &&
            /\brefused to answer question\b/i.test(error.message)
          )
            throw new DecisionRefusedError(`${input.errorPrefix} refused to answer`)
          if (!response.ok) throw new Error(`${input.errorPrefix} returned HTTP ${response.status}`)
          if (object(data).error != null) {
            providerStatus = Number(error.code)
            throw new Error(`${input.errorPrefix} returned a provider error`)
          }
          const answers = object(object(data).answers)
          annotate(
            scope.safeFields({
              answerTypes: Object.fromEntries(
                Object.keys(object(input.payload.questions)).map((name) => [
                  name,
                  object(answers[name]).type ?? 'missing',
                ]),
              ),
            }),
          )
          annotate({ stage: 'complete' })
          signal.throwIfAborted()
          return data
        } catch (error) {
          const failureKind =
            error instanceof DecisionRefusedError
              ? 'refused'
              : signal.aborted
                ? 'timeout'
                : !response || readingBody
                  ? 'network'
                  : !response.ok
                    ? 'http'
                    : providerStatus !== undefined
                      ? 'provider'
                      : 'response'
          annotate({ failureKind, networkCode: object(object(error).cause).code })
          const wait = retryDelay(response?.headers.get('retry-after') ?? null)
          const retryable =
            failureKind === 'timeout' ||
            failureKind === 'network' ||
            transientStatus(response?.status) ||
            transientStatus(providerStatus)
          if (
            attempt === 2 ||
            failureKind === 'refused' ||
            !retryable ||
            overallSignal.aborted ||
            deadline - performance.now() <= wait + 1
          )
            throw error
          failures.push({ attempt, failureKind, httpStatus: response?.status })
          scope.add({ retryFailures: failures })
          try {
            await delay(wait, undefined, { signal: overallSignal })
          } catch (error) {
            annotate({ failureKind: 'timeout' })
            throw error
          }
        } finally {
          for (const field of previousFields) delete scope.fields[field]
          scope.add(fields)
          previousFields = Object.keys(fields)
        }
      }
      throw new Error('Decision attempts exhausted')
    },
  )
}
