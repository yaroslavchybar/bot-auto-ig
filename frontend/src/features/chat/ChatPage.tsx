import { createPortal } from 'react-dom'
import { KeyRound, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  ChatHeaderControls,
  ChatProfileSelect,
  ChatStatusActions,
} from './components/ChatHeaderControls'
import { ConnectDialog } from './components/ConnectDialog'
import { ConversationView } from './components/ConversationView'
import { ThreadList } from './components/ThreadList'
import { useChatPage } from './hooks/useChatPage'
import { useHeaderSlot } from './hooks/useHeaderSlot'

export function ChatPage() {
  const chat = useChatPage()
  const hasThread = chat.selectedThreadId !== ''
  const disconnected = chat.activeProfileId !== 'all' && chat.connected === false
  // Desktop: full controls live in the app header. Mobile: only the profile
  // switch moves to the header; status and actions stay inline when a
  // profile is set, so "All profiles" needs no extra row.
  const headerSlot = useHeaderSlot('chat-header-slot')

  return (
    <div className="relative flex h-full flex-col bg-shell text-ink">
      {headerSlot
        ? createPortal(
            <>
              <div className="hidden w-full flex-nowrap md:block">
                <ChatHeaderControls chat={chat} className="w-full flex-nowrap" />
              </div>
              <div className="md:hidden">
                <ChatProfileSelect chat={chat} />
              </div>
            </>,
            headerSlot,
          )
        : null}
      {chat.activeProfileId !== 'all' && (
        <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:hidden md:px-6 md:pt-3 md:pb-3">
          <ChatStatusActions chat={chat} />
        </div>
      )}

      {chat.error && (
        <div className="flex-none px-4 md:px-6">
          <div
            role="alert"
            className="mt-2 flex items-start gap-2 rounded-lg border status-banner-danger px-3 py-2 text-sm"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 flex-1">{chat.error}</p>
            <button
              type="button"
              onClick={() => chat.setError('')}
              aria-label="Dismiss error"
              className="rounded p-0.5 opacity-70 hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
      {chat.inboxErrors.length > 0 && chat.activeProfileId === 'all' && (
        <div className="px-6 py-1 text-xs text-muted-copy">
          Could not load: {chat.inboxErrors.join(', ')}
        </div>
      )}

      <div className="min-h-0 flex-1 px-4 pt-2 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto flex h-full min-h-0 max-w-[2000px]">
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel shadow-xs">
            <div
              className={cn(
                'min-h-0 w-full flex-col md:flex md:w-[320px] md:shrink-0 lg:w-[340px]',
                hasThread ? 'hidden' : 'flex',
              )}
            >
              <ThreadList
                threads={chat.visibleThreads}
                totalCount={chat.threads.length}
                selectedThreadId={chat.selectedThreadId}
                loading={chat.loadingInbox}
                disabled={!chat.connected}
                emptyDescription={
                  chat.activeProfileId === 'all'
                    ? chat.profiles.length
                      ? 'Select a profile to connect Chat, or refresh connected inboxes.'
                      : 'Turn on Logged in for a profile first.'
                    : undefined
                }
                searchQuery={chat.searchQuery}
                onSearchChange={chat.setSearchQuery}
                onSelect={chat.selectThread}
                now={chat.now}
                tagFilter={chat.tagFilter}
                availableTags={chat.availableTags}
                tagsLoading={chat.tagsLoading}
                onTagFilterChange={chat.selectTagFilter}
              />
            </div>

            <div
              className={cn(
                'border-line-soft min-h-0 min-w-0 flex-1 flex-col md:border-l',
                hasThread ? 'flex' : 'hidden md:flex',
              )}
            >
              {disconnected ? (
                <DisconnectedState
                  profileName={chat.activeProfile?.name ?? ''}
                  onConnect={() => chat.setConnectOpen(true)}
                />
              ) : (
                <ConversationView
                  key={`${chat.activeProfileId}:${chat.selectedThreadId}`}
                  conversation={chat.conversation}
                  selectedThread={chat.selectedThread}
                  selectedThreadId={chat.selectedThreadId}
                  viewerId={chat.selectedThread?.viewerId ?? chat.inbox?.viewerId ?? ''}
                  loading={chat.loadingThread}
                  hasOlder={chat.hasOlder}
                  loadingOlder={chat.loadingOlder}
                  onLoadOlder={chat.loadOlder}
                  connected={Boolean(chat.connected)}
                  draft={chat.draft}
                  onDraftChange={chat.setDraft}
                  sending={chat.sending}
                  onSend={chat.sendReply}
                  onSendAttachment={chat.sendAttachment}
                  onReact={chat.reactToMessage}
                  reactingMessageId={chat.reactingMessageId}
                  onUnsend={chat.unsendMessage}
                  unsendingMessageId={chat.unsendingMessageId}
                  onError={chat.setError}
                  replyMaxLength={chat.replyMaxLength}
                  onBack={() => chat.selectThread('')}
                  tags={chat.selectedTags}
                  availableTags={chat.availableTags}
                  tagsLoading={chat.tagsLoading}
                  onTagChange={chat.changeTag}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <ConnectDialog
        open={chat.connectOpen}
        onOpenChange={chat.setConnectOpen}
        profileName={chat.activeProfile?.name ?? ''}
        credentials={chat.credentials}
        onCredentialsChange={chat.setCredentials}
        connecting={chat.connecting}
        onSubmit={chat.connect}
      />
    </div>
  )
}

/* ── Disconnected empty state ── */

function DisconnectedState({
  profileName,
  onConnect,
}: {
  profileName: string
  onConnect: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-panel-subtle">
        <KeyRound className="size-5 text-muted-copy" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">Chat is disconnected</p>
        <p className="max-w-xs text-xs text-muted-copy">
          Connect{' '}
          {profileName ? <span className="font-medium">{profileName}</span> : 'this profile'} to
          Instagram Chat to load conversations and send replies.
        </p>
      </div>
      <Button onClick={onConnect} className="h-8 brand-button">
        <KeyRound /> Connect Chat
      </Button>
    </div>
  )
}
