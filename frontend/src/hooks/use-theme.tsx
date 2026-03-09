import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type ThemePreference = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'anti-theme'

const DEFAULT_THEME: ThemePreference = 'dark'

type ThemeContextValue = {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function applyTheme(theme: ThemePreference) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' ? 'light' : DEFAULT_THEME
  } catch {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark')
        ? 'dark'
        : DEFAULT_THEME
    }
    return DEFAULT_THEME
  }
}

function persistTheme(theme: ThemePreference) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Ignore storage failures and keep the in-memory theme.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>(() => readStoredTheme())

  useEffect(() => {
    applyTheme(theme)
    persistTheme(theme)
  }, [theme])

  const value = {
    theme,
    setTheme,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider.')
  }

  return context
}


