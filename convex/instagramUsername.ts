/** Accept an Instagram profile link, @handle, or username. */
export function normalizeUsername(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (/^(https?:\/\/)?(www\.)?instagram\.com\//.test(value)) {
    try {
      const url = new URL(
        value.startsWith("http") ? value : `https://${value}`,
      );
      if (!["instagram.com", "www.instagram.com"].includes(url.hostname))
        return null;
      value = url.pathname.replace(/^\/|\/$/g, "");
    } catch {
      return null;
    }
  }
  value = value.replace(/^@/, "");
  return /^[a-z0-9._]{1,30}$/.test(value) &&
    !["explore", "reels", "direct", "accounts", "stories", "p"].includes(value)
    ? value
    : null;
}
