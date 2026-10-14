export const MAX_INTERESTS = 20
export const MAX_INTEREST_LABEL = 300
export const MAX_INTEREST_DESCRIPTION = 1000

export type Interest = { label: string; description: string }

export function validateInterests(interests: readonly Interest[]): void {
  if (interests.length > MAX_INTERESTS) throw new Error(`Use at most ${MAX_INTERESTS} interests`)
  const labels = new Set<string>()
  for (const interest of interests) {
    const label = interest.label.trim().toLowerCase()
    if (
      !label ||
      interest.label.length > MAX_INTEREST_LABEL ||
      !interest.description.trim() ||
      interest.description.length > MAX_INTEREST_DESCRIPTION
    )
      throw new Error('Invalid interest description')
    if (labels.has(label)) throw new Error('Each interest must be unique')
    labels.add(label)
  }
}
