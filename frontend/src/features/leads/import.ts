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
