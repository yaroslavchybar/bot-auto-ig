import type { InstagramPost } from './instagram.js';

type PostRow = {
  id?: unknown;
  pk?: unknown;
  shortCode?: unknown;
  shortcode?: unknown;
  code?: unknown;
  timestamp?: unknown;
  error?: unknown;
  requestErrorMessages?: unknown;
};

const actorUrl = 'https://api.apify.com/v2/actors/apify~instagram-post-scraper/run-sync-get-dataset-items';

/** Fetch only post IDs and shortcodes; Instagram liker requests stay on our accounts. */
export async function recentPosts(username: string, sinceDate: number, postLimit: number): Promise<InstagramPost[]> {
  const token = process.env.APIFY_API_KEY?.trim();
  if (!token) throw new Error('APIFY_API_KEY is missing from the server environment');
  const response = await fetch(actorUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: [`https://www.instagram.com/${username}/`],
      resultsLimit: postLimit,
      onlyPostsNewerThan: new Date(sinceDate).toISOString(),
      dataDetailLevel: 'basicData',
    }),
    signal: AbortSignal.timeout(310_000),
  });
  if (!response.ok) throw new Error(`Apify post scraper HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('Apify returned an invalid post dataset');

  const posts: InstagramPost[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    if (!value || typeof value !== 'object') throw new Error('Apify returned an invalid post row');
    const row = value as PostRow;
    if (row.error) {
      const messages = Array.isArray(row.requestErrorMessages) ? row.requestErrorMessages.join(' ') : '';
      if (/blocked|rate.?limit|429/i.test(messages))
        throw new Error(`Apify was blocked by Instagram while scraping @${username}; retry later`);
      throw new Error(`Apify could not find public posts for @${username}: ${String(row.error)}`);
    }
    const id = String(row.id ?? row.pk ?? '').split('_')[0]!;
    const code = String(row.shortCode ?? row.shortcode ?? row.code ?? '');
    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    if (!/^\d+$/.test(id) || !/^[\w-]+$/.test(code) || !Number.isFinite(timestamp))
      throw new Error('Apify returned a post without an ID, shortcode, or date');
    if (timestamp < sinceDate || seen.has(id)) continue;
    seen.add(id);
    posts.push({ id, code });
  }
  return posts;
}
