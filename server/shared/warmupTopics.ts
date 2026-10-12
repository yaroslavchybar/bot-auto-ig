export function warmupTopics(value: unknown): string[] {
  return typeof value === 'string' ? [...new Set(value.slice(0, 300).split(',')
    .map(topic => topic.trim().toLowerCase()).filter(Boolean))] : []
}

/** Stop before neighboring reels or the page root; never match sidebar/background text. */
export function reelPostContext(video: Element): Pick<FeedPostContext, 'text' | 'relationship'> {
  let box = video
  while (box.parentElement && !box.parentElement.matches('main, body, html') &&
    box.parentElement.querySelectorAll('video').length === 1) box = box.parentElement
  const author = Array.from(box.querySelectorAll('a[href]')).find(link =>
    /^\/[\w.]+\/(?:reels\/)?$/.test(link.getAttribute('href') ?? '') && link.textContent?.trim())
  const followLabel = /^(?:follow|follow back|following)$/i
  let row = author?.parentElement ?? null
  // The name and Follow control share a row; stop before captions, videos or other accounts.
  while (row?.parentElement && row.parentElement !== box &&
    !row.parentElement.querySelector('video') &&
    Array.from(row.parentElement.querySelectorAll('a[href]')).every(link => link.getAttribute('href') === author?.getAttribute('href')) &&
    Array.from(row.parentElement.querySelectorAll('button, [role="button"]')).every(control => followLabel.test(control.textContent?.trim() ?? '')))
    row = row.parentElement
  let relationship: FeedPostContext['relationship'] = 'unknown'
  if (row && row !== box) {
    const controls = Array.from(row.querySelectorAll('button, [role="button"]')).filter(control => {
      const bounds = control.getBoundingClientRect()
      return bounds.width > 0 && bounds.height > 0
    })
    relationship = controls.some(control => /^(?:follow|follow back)$/i.test(control.textContent?.trim() ?? ''))
      ? 'not-followed' : 'followed'
  }
  return { relationship, text: `${(box as HTMLElement).innerText ?? box.textContent ?? ''} ${Array.from(box.querySelectorAll('a[href*="/explore/tags/"]'))
    .map(link => link.getAttribute('href')).join(' ')}` }
}

export type FeedPostContext = { text: string; relationship: 'followed' | 'not-followed' | 'unknown'; sponsored: boolean }

/** Read the author row only; Follow buttons in captions/comments belong to other people. */
export function feedPostContext(article: Element): FeedPostContext {
  const author = Array.from(article.querySelectorAll('a[href]')).find(link =>
    /^\/[\w.]+\/$/.test(link.getAttribute('href') ?? '') && link.textContent?.trim())
  let header: Element | null = author?.closest('header') ?? author?.parentElement ?? null
  while (header && header !== article && !header.matches('header') &&
    !header.querySelector('[aria-label="More options" i]')) header = header.parentElement
  let relationship: FeedPostContext['relationship'] = 'unknown'
  if (header && header !== article) {
    const controls = Array.from(header.querySelectorAll('button, [role="button"]')).filter(control => {
      const box = control.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    })
    relationship = controls.some(control => /^(?:follow|follow back)$/i.test(control.textContent?.trim() ?? ''))
      ? 'not-followed' : 'followed'
  }
  return { relationship,
    sponsored: !!header && header !== article && Array.from(header.querySelectorAll('*')).some(label =>
      !label.children.length && !label.closest('a, button, [role="button"]') && /^(?:sponsored|ad)$/i.test(label.textContent?.trim() ?? '')),
    text: `${(article as HTMLElement).innerText ?? article.textContent ?? ''} ${Array.from(article.querySelectorAll('a[href*="/explore/tags/"]'))
      .map(link => link.getAttribute('href')).join(' ')}` }
}

/** Preserve followed authors (and unknown layouts); filter recommendations by topic. */
export function feedPostMatches(context: Pick<FeedPostContext, 'text' | 'relationship'>, topics: readonly string[], related = false): boolean {
  return context.relationship !== 'not-followed' || !topics.length || related
}

/** Viewing unknown authors is safe; engagement requires a followed author or explicit topic evidence. */
export function maintenancePostMatches(context: Pick<FeedPostContext, 'text' | 'relationship'>, topics: readonly string[], related = false): boolean {
  return context.relationship === 'followed' || (topics.length > 0 && related)
}
