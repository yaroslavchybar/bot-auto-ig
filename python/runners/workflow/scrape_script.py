RELATIONSHIP_CHUNK_SCRIPT = """
async ({ targetUsername, kind, cursor, chunkLimit, maxPages }) => {
  const APP_ID = '936619743392459'
  const ASBD_ID = '129477'
  const batchSize = Math.max(1, Math.min(200, Number(chunkLimit) || 25))
  const csrfToken = document.cookie
    .split('; ')
    .find((part) => part.startsWith('csrftoken='))
    ?.split('=')
    .slice(1)
    .join('=') || ''

  const baseHeaders = {
    accept: '*/*',
    'x-ig-app-id': APP_ID,
    'x-asbd-id': ASBD_ID,
    'x-requested-with': 'XMLHttpRequest',
  }
  if (csrfToken) {
    baseHeaders['x-csrftoken'] = decodeURIComponent(csrfToken)
  }

  const classifyFailure = async (response, fallbackMessage, partialUsers = [], nextCursor = cursor || null) => {
    let text = ''
    try {
      text = await response.text()
    } catch {
      text = ''
    }

    let detail = text || fallbackMessage || `HTTP ${response.status}`
    try {
      const parsed = text ? JSON.parse(text) : null
      if (parsed && typeof parsed === 'object') {
        detail = parsed.detail || parsed.message || parsed.error || detail
      }
    } catch {
    }

    let outcome = 'fatal_error'
    if (response.status === 401 || response.status === 403) outcome = 'auth_failed'
    else if (response.status === 429) outcome = 'rate_limited'
    else if (response.status === 404) outcome = 'fatal_error'
    else if (response.status >= 500) outcome = 'retryable_error'

    return {
      outcome,
      users: partialUsers,
      nextCursor,
      hasMore: Boolean(nextCursor),
      total: null,
      statusCode: response.status,
      errorCode: `http_${response.status}`,
      errorMessage: String(detail || fallbackMessage || 'Request failed').slice(0, 500),
    }
  }

  try {
    const usernameFromPath = String(window.location.pathname || '')
      .split('/')
      .filter(Boolean)[0] || ''
    const username = String(usernameFromPath || targetUsername || '').trim()
    if (!username) {
      return {
        outcome: 'fatal_error',
        users: [],
        nextCursor: cursor || null,
        hasMore: Boolean(cursor),
        total: null,
        statusCode: null,
        errorCode: 'target_not_found',
        errorMessage: 'Could not resolve username from current page',
        debug: {
          stage: 'resolve_username',
          targetUsername,
          cursor: cursor || null,
        },
      }
    }

    const profileResp = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        credentials: 'include',
        headers: baseHeaders,
      },
    )
    if (!profileResp.ok) {
      const failure = await classifyFailure(profileResp, 'Failed to load profile metadata')
      return {
        ...failure,
        debug: {
          stage: 'profile_info',
          username,
          targetUsername,
          cursor: cursor || null,
        },
      }
    }

    const profileData = await profileResp.json()
    const user = profileData?.data?.user
    const userId = String(user?.id || user?.pk || '').trim()
    if (!userId) {
      return {
        outcome: 'fatal_error',
        users: [],
        nextCursor: cursor || null,
        hasMore: Boolean(cursor),
        total: null,
        statusCode: 404,
        errorCode: 'target_not_found',
        errorMessage: 'Target profile not found',
        debug: {
          stage: 'profile_info_parse',
          username,
          targetUsername,
          cursor: cursor || null,
        },
      }
    }

    const total =
      kind === 'followers'
        ? user?.edge_followed_by?.count ?? user?.follower_count ?? null
        : user?.edge_follow?.count ?? user?.following_count ?? null

    let nextCursor = cursor || null
    let hasMore = true
    const users = []
    let pagesFetched = 0
    const endpoint = kind === 'followers' ? 'followers' : 'following'
    const requestHeaders = {
      ...baseHeaders,
      referer: `https://www.instagram.com/${username}/${endpoint}/`,
    }

    while (hasMore && pagesFetched < maxPages) {
      const params = new URLSearchParams({ count: String(batchSize) })
      if (nextCursor) {
        params.set('max_id', nextCursor)
      }

      const response = await fetch(
        `https://www.instagram.com/api/v1/friendships/${userId}/${endpoint}/?${params.toString()}`,
        {
          credentials: 'include',
          headers: requestHeaders,
        },
      )

      if (!response.ok) {
        const failure = await classifyFailure(
          response,
          `Failed to load ${kind} chunk`,
          users,
          nextCursor,
        )
        return {
          ...failure,
          debug: {
            stage: 'friendships_fetch',
            username,
            targetUsername,
            userId,
            endpoint,
            pagesFetched,
            cursor: cursor || null,
            nextCursor: nextCursor || null,
            batchSize,
          },
        }
      }

      const payload = await response.json()
      const chunkUsers = Array.isArray(payload?.users)
        ? payload.users
        : Array.isArray(payload?.profiles)
          ? payload.profiles
          : []

      users.push(...chunkUsers)
      const rawNextMaxId = payload?.next_max_id
      nextCursor =
        rawNextMaxId === null || rawNextMaxId === undefined
          ? null
          : String(rawNextMaxId).trim() || null
      hasMore = Boolean(nextCursor && (payload?.big_list ?? true))
      pagesFetched += 1

      if (hasMore && pagesFetched < maxPages) {
        const delay = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    return {
      outcome: 'success',
      users,
      nextCursor,
      hasMore,
      total,
      statusCode: 200,
      errorCode: null,
      errorMessage: null,
      debug: {
        stage: 'completed',
        username,
        targetUsername,
        userId,
        endpoint,
        pagesFetched,
        batchSize,
        cursor: cursor || null,
        nextCursor: nextCursor || null,
        totalUsers: users.length,
        total,
        hasMore,
      },
    }
  } catch (error) {
    return {
      outcome: 'retryable_error',
      users: [],
      nextCursor: cursor || null,
      hasMore: Boolean(cursor),
      total: null,
      statusCode: null,
      errorCode: 'network_error',
      errorMessage: String(error?.message || error || 'Unknown browser fetch failure').slice(0, 500),
      debug: {
        stage: 'exception',
        targetUsername,
        kind,
        cursor: cursor || null,
        chunkLimit,
        maxPages,
      },
    }
  }
}
"""
