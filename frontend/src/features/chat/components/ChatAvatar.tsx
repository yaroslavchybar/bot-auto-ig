import { useEffect, useRef, useState } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useAppUser } from '@/lib/auth'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useDocumentVisibility } from '@/hooks/use-document-visibility'
import { cn } from '@/lib/utils'
import type { ChatThread } from '../types'
import { initials } from '../utils/chat'
import { loadChatAvatar } from '../avatar'

export function ChatAvatar({
  profileId,
  users,
  viewerId,
  title,
  className,
}: {
  profileId: string
  users: ChatThread['users']
  viewerId: string
  title: string
  className?: string
}) {
  const userId = useAppUser()?.id ?? ''
  const container = useRef<HTMLSpanElement>(null)
  const nearScreen = useNearViewport(container)
  const visible = useDocumentVisibility()
  const otherUsers = users.filter((user) => user.id !== viewerId)
  // Group conversations retain their initials instead of showing an arbitrary participant.
  const person = otherUsers.length === 1 ? otherUsers[0] : undefined
  return (
    <Avatar ref={container} className={cn('size-8 shrink-0 border brand-avatar', className)}>
      {nearScreen && visible && userId && profileId && person?.profilePicUrl && (
        <Picture
          key={JSON.stringify([userId, profileId, person.id])}
          userId={userId}
          profileId={profileId}
          person={person}
        />
      )}
      <AvatarFallback className="bg-panel-strong text-[11px] font-semibold text-copy">
        {initials(title)}
      </AvatarFallback>
    </Avatar>
  )
}

function Picture({
  userId,
  profileId,
  person,
}: {
  userId: string
  profileId: string
  person: ChatThread['users'][number]
}) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    let shown: Blob | undefined
    const show = (blob: Blob) => {
      if (controller.signal.aborted || blob === shown) return
      shown = blob
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }
    void loadChatAvatar(userId, profileId, person.id, controller.signal, show)
      .then(show)
      .catch(() => {
        /* Initials remain visible if the picture is unavailable. */
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [userId, profileId, person.id])
  return url ? <AvatarImage src={url} alt={person.username} className="object-cover" /> : null
}
