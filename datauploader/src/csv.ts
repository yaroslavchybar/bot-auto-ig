// Minimal CSV support: separator detection plus a small RFC 4180 parser
// (quoted fields, doubled quotes). No pandas needed — the old cleaning
// pipeline was dead code; uploads are filtered row by row.

// Detect whether a CSV uses comma or semicolon as separator.
export function detectCsvSeparator(firstLine: string): string {
    const commas = (firstLine.match(/,/g) ?? []).length
    const semicolons = (firstLine.match(/;/g) ?? []).length
    return commas > semicolons ? ',' : ';'
}

// Parse CSV text into rows of fields.
export function parseCsv(text: string, separator: string): string[][] {
    const content = text.replace(/^\uFEFF/, '')
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    let i = 0
    const pushField = () => {
        row.push(field)
        field = ''
    }
    const pushRow = () => {
        pushField()
        rows.push(row)
        row = []
    }
    while (i < content.length) {
        const ch = content[i]
        if (quoted) {
            if (ch === '"') {
                if (content[i + 1] === '"') {
                    field += '"'
                    i += 2
                } else {
                    quoted = false
                    i += 1
                }
            } else {
                field += ch
                i += 1
            }
        } else if (ch === '"') {
            quoted = true
            i += 1
        } else if (ch === separator) {
            pushField()
            i += 1
        } else if (ch === '\r' && content[i + 1] === '\n') {
            pushRow()
            i += 2
        } else if (ch === '\n' || ch === '\r') {
            pushRow()
            i += 1
        } else {
            field += ch
            i += 1
        }
    }
    pushRow()
    // A trailing newline does not add an extra row.
    if (
        rows.length > 0 &&
        rows[rows.length - 1].length === 1 &&
        rows[rows.length - 1][0] === '' &&
        (content.endsWith('\n') || content.endsWith('\r'))
    ) {
        rows.pop()
    }
    return rows
}

// Header row, trimmed once so detected fields and record keys match.
function normalizedHeader(rows: string[][]): string[] {
    return (rows[0] ?? []).map((h) => h.trim())
}

// Header fields, trimmed and non-empty.
export function detectCsvFields(text: string): string[] {
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? ''
    const separator = detectCsvSeparator(firstLine)
    const rows = parseCsv(text, separator)
    if (rows.length === 0) return []
    return normalizedHeader(rows).filter(Boolean)
}

// First non-empty data row as a string record, keyed by header.
export function detectCsvSampleRow(text: string): Record<string, string> {
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? ''
    const separator = detectCsvSeparator(firstLine)
    const rows = parseCsv(text, separator)
    if (rows.length < 2) return {}
    const header = normalizedHeader(rows)
    for (const data of rows.slice(1)) {
        if (!data.some((v) => v.trim())) continue
        const sample: Record<string, string> = {}
        for (let i = 0; i < header.length; i++) {
            const key = header[i]
            if (!key || key in sample) continue
            sample[key] = data[i] ?? ''
        }
        return sample
    }
    return {}
}

// Data row count, excluding the header.
export function countCsvRows(text: string): number {
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? ''
    const separator = detectCsvSeparator(firstLine)
    return Math.max(0, parseCsv(text, separator).length - 1)
}

// Data rows as string records keyed by header.
export function readCsvRecords(text: string): Record<string, string>[] {
    const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? ''
    const separator = detectCsvSeparator(firstLine)
    const rows = parseCsv(text, separator)
    if (rows.length < 2) return []
    const header = normalizedHeader(rows)
    return rows.slice(1).map((data) => {
        const record: Record<string, string> = {}
        for (let i = 0; i < header.length; i++) {
            const key = header[i]
            if (!key || key in record) continue
            record[key] = data[i] ?? ''
        }
        return record
    })
}
