const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
};

export function validPictureUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return undefined;
    if (!['fbcdn.net', 'cdninstagram.com', 'instagram.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)))
      return undefined;
    return url.toString();
  } catch { return undefined; }
}

/** Describe a public profile picture with regular GPT-6 Luna, without reasoning. */
export async function describePicture(url: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('OPENROUTER_API_KEY is missing from the server environment');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-6-luna', reasoning_effort: 'none', max_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Describe this Instagram profile picture in one factual sentence. Mention visible people, text, logos or objects. Do not guess identity, age or gender.' },
        { type: 'image_url', image_url: { url, detail: 'low' } },
      ] }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`OpenRouter picture description HTTP ${response.status}`);
  const result = await response.json() as ChatResponse;
  const content = result.choices?.[0]?.message?.content;
  const description = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(part => part.type === 'text').map(part => part.text ?? '').join(' ') : '';
  if (!description.trim()) throw new Error('Luna returned no picture description');
  return description.trim().slice(0, 500);
}
