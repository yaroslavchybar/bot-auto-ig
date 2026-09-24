import { createPortal } from 'react-dom'
import { KeyRound, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChatHeaderControls } from './components/ChatHeaderControls'
import { ConnectDialog } from './components/ConnectDialog'
import { ConversationView } from './components/ConversationView'
import { ThreadList } from './components/ThreadList'
import { useChatPage } from './hooks/useChatPage'
import { useHeaderSlot } from './hooks/useHeaderSlot'

export function ChatPage() {
  const chat = useChatPage()
  const hasThread = chat.selectedThreadId !== ''
  const disconnected =
    chat.activeProfileId !== 'all' && chat.connected === false
  // Desktop: controls live in the app header. Mobile: inline below it.
  const headerSlot = useHeaderSlot('chat-header-slot')

  return (
    <div className="bg-shell text-ink animate-in fade-in relative flex h-full flex-col duration-300">
      {headerSlot
        ? createPortal(
            <ChatHeaderControls chat={chat} className="w-full flex-nowrap" />,
            headerSlot,
          )
        : null}
      <div className="relative z-10 flex-none px-4 pt-2 pb-2 md:hidden md:px-6 md:pt-3 md:pb-3">
        <ChatHeaderControls chat={chat} />
      </div>

      {chat.error && (
        <div className="flex-none px-4 md:px-6">
          <div
            role="alert"
            className="status-banner-danger mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
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
        <div className="text-muted-copy px-6 py-1 text-xs">
          Could not load: {chat.inboxErrors.join(', ')}
        </div>
      )}

      <div className="min-h-0 flex-1 px-4 pt-2 pb-4 md:px-6 md:pb-6">
        <div className="mx-auto flex h-full min-h-0 max-w-[2000px]">
          <div className="bg-panel border-line flex min-h-0 flex-1 overflow-hidden rounded-xl border shadow-xs">
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
                  conversation={chat.conversation}
                  selectedThread={chat.selectedThread}
                  selectedThreadId={chat.selectedThreadId}
                  viewerId={
                    chat.selectedThread?.viewerId ?? chat.inbox?.viewerId ?? ''
                  }
                  loading={chat.loadingThread}
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
      <span className="bg-panel-subtle flex size-12 items-center justify-center rounded-full">
        <KeyRound className="text-muted-copy size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">Chat is disconnected</p>
        <p className="text-muted-copy max-w-xs text-xs">
          Connect{' '}
          {profileName ? (
            <span className="font-medium">{profileName}</span>
          ) : (
            'this profile'
          )}{' '}
          to Instagram Chat to load conversations and send replies.
        </p>
      </div>
      <Button onClick={onConnect} className="brand-button h-8">
        <KeyRound /> Connect Chat
      </Button>
    </div>
  )
}
