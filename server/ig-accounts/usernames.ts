import type { DbListRow } from '../shared/convexClient.js'

function valid(name: string): boolean { return /^[a-z0-9._]{1,30}$/.test(name) }

async function luna(prompt: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) throw new Error('OPENROUTER_API_KEY is required for username generation')
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai/gpt-6-luna', reasoning_effort: 'none', max_tokens: 250,
      messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`)
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

export async function usernameCandidates(model: DbListRow, index: number, used: string[]): Promise<string[]> {
  const supplied = (model.usernames ?? []).filter(valid)
  const seeds = supplied.slice(0, 10)
  const initial = supplied[index]
  if (initial && valid(initial) && !used.includes(initial)) return [initial]
  const prompt = `Generate 10 natural Instagram username ideas for the same person. Examples: ${JSON.stringify(seeds)}. Base full name: ${JSON.stringify(model.fullName || model.fullNames?.[0] || model.name)}. Avoid these: ${JSON.stringify(used)}. Use lowercase letters, digits, periods or underscores only, max 30 characters. Return only a JSON array of 10 strings.`
  const raw = await luna(prompt)
  let generated: string[] = []
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    const parsed = JSON.parse(match?.[0] ?? '[]') as unknown
    if (Array.isArray(parsed)) generated = parsed.filter((name): name is string => typeof name === 'string')
  } catch { /* local fallback below */ }
  const base = (initial || seeds[index % Math.max(1, seeds.length)] || model.name)
    .toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 24)
  const local = [base, `${base}.a`, `${base}_m`, `${base}7`, `${base}.l`]
  return [...new Set([...(initial ? [initial] : []), ...generated, ...local]
    .map(name => name.toLowerCase()).filter(name => valid(name) && !used.includes(name)))]
}

export async function fullNameForGroup(model: DbListRow, group: number): Promise<string> {
  const chosen = model.fullNames?.[group]?.trim()
  if (chosen) return chosen
  const base = (model.fullName || model.fullNames?.[0] || model.name).trim()
  if (group === 0) return base
  const raw = await luna(`Write one natural full-name variation for the same person as ${JSON.stringify(base)}. It will be used on several Instagram accounts. Keep the same first and last name identity, with a subtle variation such as a middle initial or familiar first-name form. Return only the full name, 2 to 4 words.`)
  const value = raw.replace(/^["'\s]+|["'\s]+$/g, '')
  return /^[\p{L} .'-]{3,80}$/u.test(value) ? value : base
}
