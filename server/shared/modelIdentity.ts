/** Pure model input rules shared by the forms and authoritative backend validation. */
export function normalizeModelUsername(name: string): string {
  return name.trim().replace(/^@/, '').toLowerCase()
}

export function isValidModelUsername(name: string): boolean {
  return /^[a-z0-9._]{1,30}$/.test(name)
}

export function isValidModelFullName(name: string): boolean {
  return /^[\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Component} .'-]{3,80}$/u.test(name)
}

function parsedList(all: string[]) {
  const items = [...new Set(all)]
  return { items, duplicates: all.length - items.length }
}

export function parseModelUsernames(text: string) {
  return parsedList(
    text
      .split(/[\s,]+/)
      .map(normalizeModelUsername)
      .filter(Boolean),
  )
}

export function parseModelFullNames(text: string) {
  return parsedList(
    text
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean),
  )
}
