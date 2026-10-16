/** Read the visible badge beside one Reel action, without using captions or neighboring actions. */
export function reelEngagementCount(post: Element, kind: 'likes' | 'comments'): number | null {
  const view = post.ownerDocument.defaultView!
  const visible = (node: Element) => {
    const rect = node.getBoundingClientRect(), style = view.getComputedStyle(node)
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < view.innerHeight &&
      rect.right > 0 && rect.left < view.innerWidth && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const selector = kind === 'likes' ? 'svg[aria-label="Like"], svg[aria-label="Unlike"]' : 'svg[aria-label="Comment"]'
  for (const icon of post.querySelectorAll(selector)) {
    if (!visible(icon)) continue
    for (let group = icon.closest('button, [role="button"]'); group && post.contains(group); group = group.parentElement) {
      // The next ancestor is the full action rail or media, rather than this badge.
      if (group.querySelector('video') || Array.from(group.querySelectorAll('svg[aria-label]')).some(other => other !== icon)) break
      for (const label of group.querySelectorAll('span, div')) {
        if (label.children.length || !visible(label)) continue
        const count = label.textContent?.replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)([KMB])?$/i)
        if (!count) continue
        const value = Number(count[1]) * ({ K: 1000, M: 1e6, B: 1e9 }[count[2]?.toUpperCase() ?? ''] ?? 1)
        if (Number.isFinite(value)) return value
      }
    }
  }
  return null
}
