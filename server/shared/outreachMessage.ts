type Part = string | { options: Part[][] } | { newMessage: true }

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
      } else if (character === '\\') {
        flush()
        options[options.length - 1].push({ newMessage: true })
        position++
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
  const empty = () => new Error('Message variations and separators must not produce an empty message')
  // At most two states per branch: the current message has text, or it does not.
  const ends = (items: Part[], states: Set<boolean>): Set<boolean> => {
    for (const part of items) {
      if (typeof part === 'string') {
        if (part.trim()) states = new Set([true])
      } else if ('options' in part) {
        states = new Set(part.options.flatMap(option => [...ends(option, new Set(states))]))
      } else {
        if (states.has(false)) throw empty()
        states = new Set([false])
      }
    }
    return states
  }
  if (ends(parts, new Set([false])).has(false) && template.trim()) throw empty()
}

/** Resolve the whole sequence once, then insert recipient data so names cannot become syntax. */
export function renderOutreachMessages(
  template: string,
  recipient: { username: string; fullName?: string },
  random: () => number = Math.random,
): string[] {
  validateOutreachMessage(template)
  const messages = ['']
  const render = (parts: Part[]): void => {
    for (const part of parts) {
      if (typeof part === 'string') messages[messages.length - 1] += part
      else if ('options' in part) render(part.options[Math.floor(random() * part.options.length)])
      else messages.push('')
    }
  }
  render(parseTemplate(template))
  const name = recipient.fullName?.trim().split(/\s+/)[0] || recipient.username
  return messages.map(text => {
    const message = text.trim().replace(
      /\[username\]|\[name\]|\{\{username\}\}|\{\{name\}\}|\{name\}/g,
      (placeholder) =>
        placeholder === '[username]' || placeholder === '{{username}}' ? recipient.username : name,
    )
    if (!message.trim()) throw new Error('Message variation is empty')
    if (message.length > 1000) throw new Error('Rendered message must be at most 1,000 characters')
    return message
  })
}
