// Token getter function - set by useAuthenticatedFetch hook
let tokenGetter: (() => Promise<string | null>) | null = null

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter
}

export async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  // Add auth token if available
  if (tokenGetter) {
    try {
      const token = await tokenGetter()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    } catch {
      // Continue without token
    }
  }

  const resp = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(text || `HTTP ${resp.status}`)
  }

  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
}