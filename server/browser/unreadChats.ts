import type { BrowserContext, Page } from 'playwright-core'
import { profilesSaveUnreadChats } from '../shared/convexClient.js'
import logger from '../shared/logger.js'

/** Read only Instagram's message badges, never conversation contents or notification counts. */
export function unreadChatsFromDocument(doc: Document): number | null {
  const view = doc.defaultView!
  const visible = (node: Element) => {
    const box = node.getBoundingClientRect()
    const style = view.getComputedStyle(node)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const count = (label: string, pattern: RegExp) => {
    const match = pattern.exec(label)
    if (!match) return null
    const value = Number(match[1]!.replace(/[,\s]/g, ''))
    return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null
  }
  const unique = (values: number[]) => new Set(values).size === 1 ? values[0]! : null
  const controls = [...doc.querySelectorAll('a[href^="/direct/"]:has(svg[aria-label="Messages"]), [aria-label^="Messages -"]')].filter(visible)
  const labels = controls.flatMap(node => [node, ...node.querySelectorAll('[aria-label]')]).filter(visible)
  const chats = labels.flatMap(node => {
    const value = count(node.getAttribute('aria-label')!, /^(\d[\d,\s]*) unread chats?$/i)
    return value === null ? [] : [value]
  })
  if (chats.length) return unique(chats)
  const badges = labels.filter(node => /^(?:Direct messaging -|Messages -)/i.test(node.getAttribute('aria-label')!))
  const values = badges.flatMap(node => {
    const value = count(node.getAttribute('aria-label')!, /^(?:Direct messaging|Messages) - (\d[\d,\s]*) new notifications?(?: link)?$/i)
    return value === null ? [] : [value]
  })
  if (badges.length) return values.length === badges.length ? unique(values) : null
  // A loaded Messages navigation control without a badge means zero. Missing UI is unknown.
  return [...doc.querySelectorAll('a[href^="/direct/"]')]
    .some(node => visible(node) && node.querySelector('svg[aria-label="Messages"]')) ? 0 : null
}

/** Best effort and bounded: failures must never block browser cleanup or erase the last count. */
export async function saveUnreadChatsAtClose(context: BrowserContext, profileId: string,
  deps = { save: profilesSaveUnreadChats }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const task = async () => {
    for (const page of context.pages().filter((page: Page) => !page.isClosed()).reverse()) {
      const url = new URL(page.url())
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname)
        || /^\/(?:accounts|challenge|checkpoint)(?:\/|$)/.test(url.pathname)) continue
      // Playwright serializes the reader together with its document argument.
      const checkedAt = Date.now()
      const count = await page.evaluate(`(${unreadChatsFromDocument.toString()})(document)`) as number | null
      if (count === null) continue
      await deps.save(profileId, count, checkedAt)
      return
    }
  }
  try {
    await Promise.race([task(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Unread badge check timed out')), 4000)
    })])
  } catch (error) {
    logger.info({ event: 'browser.unread_chats_save', profileId, outcome: 'skipped', error })
  } finally { clearTimeout(timer) }
}
