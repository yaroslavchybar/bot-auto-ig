import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  profileName: string
  credentials: string
  onCredentialsChange: (value: string) => void
  connecting: boolean
  onSubmit: (event: FormEvent) => void
}

export function ConnectDialog({
  open,
  onOpenChange,
  profileName,
  credentials,
  onCredentialsChange,
  connecting,
  onSubmit,
}: ConnectDialogProps) {
  const [visible, setVisible] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-panel border-line text-ink sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="page-title-gradient flex items-center gap-2">
            <KeyRound className="text-copy size-5" />
            Connect Instagram Chat
          </DialogTitle>
          <DialogDescription>
            Sign in as{' '}
            <span className="font-medium">{profileName || 'this profile'}</span>{' '}
            to load its DM inbox. Sessions persist until you log out.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chat-credentials">Credentials</Label>
            <div className="relative">
              <Input
                id="chat-credentials"
                autoComplete="off"
                spellCheck={false}
                type={visible ? 'text' : 'password'}
                value={credentials}
                onChange={(event) => onCredentialsChange(event.target.value)}
                placeholder="username:password:authenticator key"
                maxLength={1200}
                required
                disabled={connecting}
                className="bg-field brand-focus pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setVisible((value) => !value)}
                aria-label={visible ? 'Hide credentials' : 'Show credentials'}
                className="text-subtle-copy hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
              >
                {visible ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <p className="text-muted-copy text-xs">
              Format: Instagram username, password and authenticator key,
              separated by colons.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={connecting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={connecting || !credentials.trim()}
              className="brand-button"
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
