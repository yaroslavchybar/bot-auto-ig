import type { ProfileRecord } from '../shared/contracts.js'
import { runtimeUrl, runtimeHeaders, runtimeRequest } from '../shared/runtime.js'
export class InstagramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number,
    name = 'InstagramError',
  ) {
    super(message)
    this.name = name
  }
}
async function mobile<T>(
  action: string,
  profileId: string,
  args: unknown = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${runtimeUrl()}/instagram/${action}`, {
    method: 'POST',
    headers: runtimeHeaders(),
    body: JSON.stringify({ profileId, args, token }),
    signal: AbortSignal.timeout(360_000),
  })
  const body = (await response.json().catch((error: unknown) => {
    if (response.ok) throw error
    return {}
  })) as {
    error?: { message: string; name: string; status: number; retryAfterMs: number }
  }
  if (!response.ok) {
    const error = body?.error
    throw new InstagramError(
      error?.message || 'Instagram request failed',
      error?.status || response.status,
      error?.retryAfterMs || 0,
      error?.name,
    )
  }
  return body as T
}

/** Typed bridge to the custom Rust mobile client. Session state stays in Rust. */
export class InstagramChat {
  private constructor(
    private readonly profileId: string,
    readonly cacheToken: string,
  ) {}
  static async hasSession(profileId: string): Promise<boolean> {
    return (await mobile<{ connected: boolean }>('has', profileId)).connected
  }
  static async load(profile: ProfileRecord): Promise<InstagramChat> {
    const session = await mobile<{ token: string; viewerId: string }>('load', profile.id)
    return new InstagramChat(profile.id, session.token)
  }
  static async login(
    profile: ProfileRecord,
    username: string,
    password: string,
    authenticatorKey: string,
  ): Promise<void> {
    await mobile('login', profile.id, {
      username,
      password,
      authenticatorKey,
    })
    await runtimeRequest('/chat/clear', {
      method: 'POST',
      body: JSON.stringify({ profileId: profile.id }),
    })
  }
  static async logout(profileId: string): Promise<void> {
    await mobile('logout', profileId)
    await runtimeRequest('/chat/clear', { method: 'POST', body: JSON.stringify({ profileId }) })
  }
  private request<T>(action: string, args: unknown = {}): Promise<T> {
    return mobile(action, this.profileId, args, this.cacheToken)
  }
  async updateUsername(username: string): Promise<void> {
    await this.request('username', { username })
  }
  async updateFullName(fullName: string): Promise<void> {
    await this.request('fullName', { fullName })
  }
  async changeProfilePicture(image: Buffer): Promise<void> {
    await this.request('avatar', { image: image.toString('base64') })
  }
}
