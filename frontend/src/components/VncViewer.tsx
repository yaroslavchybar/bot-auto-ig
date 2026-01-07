import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Monitor, Maximize2, Minimize2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VncViewerProps {
  url?: string
  className?: string
}

const DEFAULT_VNC_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:6080/vnc.html`
    : 'http://localhost:6080/vnc.html'

export function VncViewer({ url = DEFAULT_VNC_URL, className }: VncViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const handleOpenExternal = () => {
    window.open(url + '?autoconnect=true&resize=scale', '_blank')
  }

  return (
    <Card
      className={cn(
        'flex flex-col transition-all duration-300',
        isExpanded ? 'fixed inset-4 z-50' : 'h-full min-h-[400px]',
        className,
      )}
    >
      <CardHeader className="p-3 pb-1 flex-none">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Browser View
            <span className="h-2 w-2 rounded-full bg-green-500" />
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleOpenExternal}
              title="Open in new window"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? 'Minimize' : 'Maximize'}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <iframe
          src={url + '?autoconnect=true&resize=scale&reconnect=true'}
          className="w-full h-full border-0"
          title="VNC Viewer"
          allow="fullscreen"
        />
      </CardContent>
    </Card>
  )
}
