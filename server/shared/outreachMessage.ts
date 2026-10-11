type Part = string | { options: Part[][] }

/** Parse variations without expanding every possible combination. Double braces are placeholders. */
function parseTemplate(template: string): Part[] {
  if (template.length > 1000) throw new Error('Message must be at most 1,000 characters')
  let position = 0
  function read(group: boolean): Part[][] {
    const options: Part[][] = [[]]
    let text = ''
    const flush = () => {
      if (text) options[options.length - 1].push(text)
      text = ''
    }
    while (position < template.length) {
      const character = template[position]
      const placeholder = template.startsWith('{{', position)
        ? template.slice(position).match(/^\{\{[^{}|]*\}\}/)?.[0]
        : undefined
      if (placeholder) {
        text += placeholder
        position += placeholder.length
      } else if (character === '{') {
        flush()
        position++
        const nested = read(true)
        const current = options[options.length - 1]
        if (nested.length > 1) current.push({ options: nested })
        else current.push('{', ...nested[0], '}')
      } else if (character === '}') {
        if (!group) throw new Error('Message has an unexpected closing brace')
        position++
        flush()
        return options
      } else if (character === '|' && group) {
        position++
        flush()
        options.push([])
      } else {
        text += character
        position++
      }
    }
    if (group) throw new Error('Message has an unclosed variation')
    flush()
    return options
  }
  return read(false)[0]
}

export function validateOutreachMessage(template: string) {
  const parts = parseTemplate(template)
  const minimumText = (items: Part[]): number =>
    items.reduce(
      (sum, part) =>
        sum +
        (typeof part === 'string'
          ? part.trim().length
          : Math.min(...part.options.map(minimumText))),
      0,
    )
  if (template.trim() && minimumText(parts) === 0)
    throw new Error('Message variations must not produce an empty message')
}

/** Resolve choices once per DM, then insert recipient data so names cannot become variations. */
export function renderOutreachMessage(
  template: string,
  recipient: { username: string; fullName?: string },
  random: () => number = Math.random,
): string {
  const render = (parts: Part[]): string =>
    parts
      .map((part) =>
        typeof part === 'string'
          ? part
          : render(part.options[Math.floor(random() * part.options.length)]),
      )
      .join('')
  const name = recipient.fullName?.trim().split(/\s+/)[0] || recipient.username
  const message = render(parseTemplate(template)).replace(
    /\[username\]|\[name\]|\{\{username\}\}|\{\{name\}\}|\{name\}/g,
    (placeholder) =>
      placeholder === '[username]' || placeholder === '{{username}}' ? recipient.username : name,
  )
  if (!message.trim()) throw new Error('Message variation is empty')
  if (message.length > 1000) throw new Error('Rendered message must be at most 1,000 characters')
  return message
}
