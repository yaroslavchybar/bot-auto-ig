import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/use-theme'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const label = `Switch to ${nextTheme} mode`

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="border-line-soft bg-panel/80 text-muted-copy hover:bg-panel-hover hover:text-ink h-8 w-8 rounded-full border shadow-none transition-colors"
      aria-label={label}
      title={label}
      onClick={() => setTheme(nextTheme)}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}


