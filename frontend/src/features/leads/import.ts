/** CSV including quoted commas/newlines, or one username/profile URL per line. */
export function parseLeadImport(text: string): string[] {
  const rows: string[][] = [],
    row: string[] = []
  let field = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.trim())
      field = ''
      if (c === '\n') {
        rows.push([...row])
        row.length = 0
      }
    } else field += c
  }
  if (quoted) throw new Error('CSV contains an unclosed quote')
  row.push(field.trim())
  rows.push(row)
  const header = rows[0].map((s) => s.replace(/^\uFEFF/, '').toLowerCase())
  const column = header.findIndex((s) =>
    ['username', 'profile_url', 'instagram', 'url'].includes(s),
  )
  return (column >= 0 ? rows.slice(1) : rows)
    .map((r) => r[column >= 0 ? column : 0]?.trim() ?? '')
    .filter(Boolean)
}

export interface CsvTable {
  headers: string[]
  /** Data rows (header stripped when hasHeader). */
  rows: string[][]
  hasHeader: boolean
}

const USERNAME_HEADER_NAMES = new Set([
  'username',
  'user',
  'handle',
  'instagram',
  'instagramusername',
  'profile',
  'profileurl',
  'url',
  'link',
  'account',
])

function headerKey(cell: string): string {
  return cell
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

/** Split raw text into a column table, detecting a header row by known names. */
export function parseCsvTable(text: string): CsvTable {
  const rows: string[][] = [],
    row: string[] = []
  let field = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.trim())
      field = ''
      if (c === '\n') {
        rows.push([...row])
        row.length = 0
      }
    } else field += c
  }
  if (quoted) throw new Error('CSV contains an unclosed quote')
  row.push(field.trim())
  rows.push(row)
  const nonEmpty = rows.filter((r) => r.some((c) => c !== ''))
  if (!nonEmpty.length) return { headers: [], rows: [], hasHeader: false }
  const width = Math.max(...nonEmpty.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')]
  const [first, ...rest] = nonEmpty
  const hasHeader = first.some((c) => USERNAME_HEADER_NAMES.has(headerKey(c)))
  return {
    headers: hasHeader
      ? pad(first.map((c) => c.replace(/^\uFEFF/, '')))
      : Array.from({ length: width }, (_, i) => `Column ${i + 1}`),
    rows: (hasHeader ? rest : nonEmpty).map(pad),
    hasHeader,
  }
}

/** Index of the header cell naming the username column, or -1. */
export function findUsernameColumn(headers: string[]): number {
  return headers.findIndex((h) => USERNAME_HEADER_NAMES.has(headerKey(h)))
}
