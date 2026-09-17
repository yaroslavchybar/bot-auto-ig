import fs from 'node:fs'
import path from 'node:path'

export type ProfileFileAccess = {
  uploadsDir: string
  xdgConfigDir: string
  env: { XDG_CONFIG_HOME: string }
}

// GTK file-chooser scoping for one profile's remote browser.
//
// The browser inherits this process env, so pointing XDG_CONFIG_HOME at a
// per-profile directory lets us control exactly what its file dialog
// offers — without touching the shared $HOME (fonts, dbus, ...):
//   - gtk-3.0/bookmarks puts the profile's own uploads folder one click
//     away in the dialog sidebar (and nothing else of ours).
//   - Chromium's remembered dialog folder (selectfile.last_directory,
//     already per-profile via the user-data-dir) is preseeded to the
//     profile folder, so e.g. an IG profile-photo picker opens there.
//
// Everything is best-effort except creating the uploads dir: a broken
// dialog setup must never break a browser launch.
export function setupProfileFileAccess(options: {
  profileDir: string
  uploadsDir: string
  legacyDirs?: string[]
}): ProfileFileAccess {
  const { profileDir, uploadsDir } = options
  const legacyDirs = options.legacyDirs ?? []
  fs.mkdirSync(uploadsDir, { recursive: true })

  const xdgConfigDir = path.join(profileDir, 'xdg')
  const gtkDir = path.join(xdgConfigDir, 'gtk-3.0')
  try {
    fs.mkdirSync(gtkDir, { recursive: true })
    writeBookmarksFile(path.join(gtkDir, 'bookmarks'), uploadsDir)
  } catch {
    // Dialog falls back to the shared locations — launch goes on.
  }

  try {
    preseedDialogFolder(profileDir, uploadsDir, legacyDirs)
  } catch {
    // Last-used folder stays whatever Chromium remembers.
  }

  return { uploadsDir, xdgConfigDir, env: { XDG_CONFIG_HOME: xdgConfigDir } }
}

function fileUrl(dir: string): string {
  const segments = path.resolve(dir).split(path.sep).filter(Boolean)
  return `file:///${segments.map((s) => encodeURIComponent(s)).join('/')}`
}

// Our bookmark first, then any bookmarks the user added themselves
// (never wipe those, and never duplicate ours across launches).
function writeBookmarksFile(bookmarksPath: string, uploadsDir: string): void {
  const url = fileUrl(uploadsDir)
  const label = path.basename(path.resolve(uploadsDir))
  let existing: string[] = []
  try {
    existing = fs.readFileSync(bookmarksPath, 'utf8').split('\n')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const rest = existing.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return false
    return trimmed.split(/\s+/)[0] !== url
  })
  const next = [`${url} ${label}`, ...rest].join('\n') + '\n'
  try {
    if (fs.readFileSync(bookmarksPath, 'utf8') === next) return
  } catch {
    // Missing or unreadable — write below.
  }
  fs.writeFileSync(bookmarksPath, next)
}

function sameDir(a: string, b: string): boolean {
  try {
    if (path.resolve(a) === path.resolve(b)) return true
  } catch {
    // Fall through to the realpath comparison.
  }
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return false
  }
}

function preseedDialogFolder(profileDir: string, uploadsDir: string, legacyDirs: string[]): void {
  const prefsDir = path.join(profileDir, 'Default')
  const prefsPath = path.join(prefsDir, 'Preferences')
  let prefs: Record<string, any> | undefined
  try {
    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'))
    if (!prefs || typeof prefs !== 'object') return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return
    prefs = undefined
  }
  if (!prefs) {
    fs.mkdirSync(prefsDir, { recursive: true })
    fs.writeFileSync(prefsPath, JSON.stringify({ selectfile: { last_directory: uploadsDir } }))
    return
  }
  const selectfile = prefs.selectfile
  const current = typeof selectfile?.last_directory === 'string' ? selectfile.last_directory : ''
  if (current === uploadsDir) return
  const isLegacy = !current || legacyDirs.some((dir) => sameDir(current, dir))
  if (!isLegacy) return
  prefs.selectfile = { ...(typeof selectfile === 'object' && selectfile ? selectfile : {}), last_directory: uploadsDir }
  fs.writeFileSync(prefsPath, JSON.stringify(prefs))
}
