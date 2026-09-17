import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, apiDownload, apiFetch, apiUploadFile } from '@/lib/api'
import type {
  FileEntry,
  FileRoot,
  FilesLocation,
  FilesSortKey,
  FilesUsage,
  FilesView,
} from '../types'

type ListResponse = { root: string; path: string; entries: FileEntry[] }

const VIEW_KEY = 'files-view'
const SORT_KEY = 'files-sort'

function readView(): FilesView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function readSort(): { key: FilesSortKey; dir: 1 | -1 } {
  try {
    const raw = localStorage.getItem(SORT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { key: FilesSortKey; dir: 1 | -1 }
      if (['name', 'size', 'mtime', 'kind'].includes(parsed.key)) return parsed
    }
  } catch {
    // fall through to default
  }
  return { key: 'name', dir: 1 }
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    try {
      const parsed = JSON.parse(e.message) as { error?: { message?: unknown } }
      const message = parsed?.error?.message
      if (typeof message === 'string' && message.trim()) return message
    } catch {
      // raw message below
    }
    const raw = e.message.trim()
    if (raw && raw.length < 200 && !raw.startsWith('<')) return raw
  }
  return fallback
}

// Finder-style browser over the VPS upload folders (General Uploads,
// Profile Uploads). Location history gives native back/forward behavior.
export function useFiles() {
  const [roots, setRoots] = useState<FileRoot[]>([])
  const [loc, setLoc] = useState<FilesLocation>({ root: 'general', path: '' })
  const [past, setPast] = useState<FilesLocation[]>([])
  const [future, setFuture] = useState<FilesLocation[]>([])
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [view, setViewState] = useState<FilesView>(readView)
  const [sort, setSortState] = useState(readSort)
  const [selected, setSelectedState] = useState<string[]>([])
  const anchorRef = useRef<string | null>(null)
  const [usage, setUsage] = useState<FilesUsage | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const requestId = useRef(0)

  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await apiFetch<FilesUsage>('/api/files/usage'))
    } catch {
      // Storage meter is best-effort.
    }
  }, [])

  const load = useCallback(
    async (target: FilesLocation) => {
      const id = ++requestId.current
      setLoading(true)
      setError(null)
      try {
        const [list] = await Promise.all([
          apiFetch<ListResponse>(
            `/api/files/list?root=${encodeURIComponent(target.root)}&path=${encodeURIComponent(target.path)}`,
          ),
        ])
        if (requestId.current !== id) return
        setEntries(list.entries)
        setSelectedState([])
        anchorRef.current = null
      } catch (e) {
        if (requestId.current !== id) return
        setEntries([])
        setError(errorMessage(e, 'Could not load folder'))
      } finally {
        if (requestId.current === id) setLoading(false)
      }
    },
    [],
  )

  // Initial roots + first listing.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await apiFetch<FileRoot[]>('/api/files/roots')
        if (cancelled) return
        setRoots(data)
        const first = data[0]
        const initial: FilesLocation = data.some((r) => r.id === 'general')
          ? { root: 'general', path: '' }
          : first
            ? { root: first.id, path: '' }
            : { root: 'general', path: '' }
        setLoc(initial)
        await load(initial)
      } catch {
        if (!cancelled) {
          setRoots([
            { id: 'general', label: 'General Uploads', kind: 'general' },
            { id: 'profiles', label: 'Profile Uploads', kind: 'profiles' },
          ])
          await load({ root: 'general', path: '' })
        }
      }
      void refreshUsage()
    })()
    return () => {
      cancelled = true
    }
  }, [load, refreshUsage])

  const navigate = useCallback(
    (next: FilesLocation, opts?: { replace?: boolean }) => {
      setLoc((current) => {
        if (current.root === next.root && current.path === next.path) return current
        if (!opts?.replace) {
          setPast((p) => [...p.slice(-49), current])
          setFuture([])
        }
        return next
      })
      void load(next)
    },
    [load],
  )

  const openRoot = useCallback(
    (root: string) => navigate({ root, path: '' }),
    [navigate],
  )

  const openFolder = useCallback(
    (name: string) => {
      const nextPath = loc.path ? `${loc.path}/${name}` : name
      navigate({ root: loc.root, path: nextPath })
    },
    [loc, navigate],
  )

  const openPathIndex = useCallback(
    (index: number) => {
      // index -1 = root, otherwise segment index.
      if (index < 0) {
        navigate({ root: loc.root, path: '' })
        return
      }
      const parts = loc.path.split('/').filter(Boolean)
      navigate({ root: loc.root, path: parts.slice(0, index + 1).join('/') })
    },
    [loc, navigate],
  )

  const goUp = useCallback(() => {
    if (!loc.path) return
    const parts = loc.path.split('/').filter(Boolean)
    parts.pop()
    navigate({ root: loc.root, path: parts.join('/') })
  }, [loc, navigate])

  const goBack = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const prev = p[p.length - 1]
      if (!prev) return p
      setLoc((current) => {
        setFuture((f) => [current, ...f].slice(0, 50))
        return prev
      })
      void load(prev)
      return p.slice(0, -1)
    })
  }, [load])

  const goForward = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const [next, ...rest] = f
      if (!next) return f
      setLoc((current) => {
        setPast((p) => [...p.slice(-49), current])
        return next
      })
      void load(next)
      return rest
    })
  }, [load])

  const refresh = useCallback(() => {
    void load(loc)
    void refreshUsage()
  }, [load, loc, refreshUsage])

  const setView = useCallback((next: FilesView) => {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // persistence is best-effort
    }
  }, [])

  const toggleSort = useCallback((key: FilesSortKey) => {
    setSortState((current) => {
      const next =
        current.key === key
          ? { key, dir: (current.dir === 1 ? -1 : 1) as 1 | -1 }
          : { key, dir: 1 as const }
      try {
        localStorage.setItem(SORT_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = query
      ? entries.filter((e) => e.name.toLowerCase().includes(query))
      : entries
    const dir = sort.dir
    return [...filtered].sort((a, b) => {
      // Folders first, like Finder — then the chosen sort.
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      switch (sort.key) {
        case 'size':
          return (a.size - b.size) * dir
        case 'mtime':
          return (a.mtime - b.mtime) * dir
        case 'kind':
          return a.kind.localeCompare(b.kind) * dir || a.name.localeCompare(b.name) * dir
        case 'name':
        default:
          return a.name.localeCompare(b.name) * dir
      }
    })
  }, [entries, search, sort])

  // Multi-select like Finder: plain click selects one, Cmd/Ctrl-click
  // toggles, Shift-click extends from the anchor.
  const selectOne = useCallback((name: string) => {
    anchorRef.current = name
    setSelectedState([name])
  }, [])

  const toggleOne = useCallback((name: string) => {
    anchorRef.current = name
    setSelectedState((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    )
  }, [])

  const selectRange = useCallback(
    (name: string) => {
      const order = visible.map((e) => e.name)
      const anchor = anchorRef.current
      if (!anchor || !order.includes(anchor) || !order.includes(name)) {
        anchorRef.current = name
        setSelectedState([name])
        return
      }
      const a = order.indexOf(anchor)
      const b = order.indexOf(name)
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      setSelectedState(order.slice(lo, hi + 1))
    },
    [visible],
  )

  const selectAll = useCallback(() => {
    setSelectedState(visible.map((e) => e.name))
  }, [visible])

  const clearSelection = useCallback(() => {
    anchorRef.current = null
    setSelectedState([])
  }, [])

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.includes(e.name)),
    [entries, selected],
  )

  const selectedSize = useMemo(
    () => selectedEntries.reduce((sum, e) => sum + (e.isDir ? 0 : e.size), 0),
    [selectedEntries],
  )

  const mkdir = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Name is required')
      setSaving(true)
      try {
        await apiFetch('/api/files/mkdir', {
          method: 'POST',
          body: { root: loc.root, path: loc.path, name: trimmed },
        })
        toast.success('Folder created')
        await load(loc)
      } catch (e) {
        throw new Error(errorMessage(e, 'Could not create folder'))
      } finally {
        setSaving(false)
      }
    },
    [load, loc],
  )

  const renameEntry = useCallback(
    async (from: string, to: string) => {
      const trimmed = to.trim()
      if (!trimmed || trimmed === from) return
      setSaving(true)
      try {
        await apiFetch('/api/files/rename', {
          method: 'POST',
          body: { root: loc.root, path: loc.path, from, to: trimmed },
        })
        toast.success('Renamed')
        setSelectedState([trimmed])
        await load(loc)
      } catch (e) {
        throw new Error(errorMessage(e, 'Could not rename'))
      } finally {
        setSaving(false)
      }
    },
    [load, loc],
  )

  const removeEntries = useCallback(
    async (names: string[]) => {
      const unique = [...new Set(names)]
      if (unique.length === 0) return
      setSaving(true)
      try {
        let done = 0
        for (const name of unique) {
          try {
            await apiFetch(
              `/api/files?root=${encodeURIComponent(loc.root)}&path=${encodeURIComponent(loc.path)}&name=${encodeURIComponent(name)}`,
              { method: 'DELETE' },
            )
            done += 1
          } catch (e) {
            toast.error(errorMessage(e, `Could not delete ${name}`))
          }
        }
        if (done > 0) {
          toast.success(done === 1 ? 'Deleted' : `${done} items deleted`)
          setSelectedState((prev) => prev.filter((n) => !unique.includes(n)))
          await load(loc)
          void refreshUsage()
        }
      } finally {
        setSaving(false)
      }
    },
    [load, loc, refreshUsage],
  )

  const removeEntry = useCallback(
    async (name: string) => {
      try {
        await removeEntries([name])
      } catch (e) {
        throw new Error(errorMessage(e, 'Could not delete'))
      }
    },
    [removeEntries],
  )

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      setUploading(true)
      let done = 0
      let failed = 0
      for (const file of list) {
        try {
          await apiUploadFile(
            `/api/files/upload?root=${encodeURIComponent(loc.root)}&path=${encodeURIComponent(loc.path)}`,
            file,
          )
          done += 1
        } catch (e) {
          failed += 1
          toast.error(errorMessage(e, `Could not upload ${file.name}`))
        }
      }
      setUploading(false)
      if (done > 0) {
        toast.success(done === 1 ? 'File uploaded' : `${done} files uploaded`)
        await load(loc)
        void refreshUsage()
      } else if (failed === 0) {
        toast.error('Nothing uploaded')
      }
    },
    [load, loc, refreshUsage],
  )

  const downloadEntries = useCallback(
    async (names: string[]) => {
      const unique = [...new Set(names)]
      if (unique.length === 0) return
      let failed = 0
      for (const name of unique) {
        try {
          await apiDownload(
            `/api/files/download?root=${encodeURIComponent(loc.root)}&path=${encodeURIComponent(loc.path)}&name=${encodeURIComponent(name)}`,
            name,
          )
        } catch {
          failed += 1
          toast.error(`Could not download ${name}`)
        }
      }
      if (failed === 0 && unique.length > 1) {
        toast.success(`${unique.length} files downloading`)
      }
    },
    [loc],
  )

  const downloadEntry = useCallback(
    async (name: string) => {
      await downloadEntries([name])
    },
    [downloadEntries],
  )

  return {
    roots,
    loc,
    entries: visible,
    totalCount: entries.length,
    loading,
    error,
    search,
    setSearch,
    view,
    setView,
    sort,
    toggleSort,
    selected,
    selectedEntries,
    selectedSize,
    selectOne,
    toggleOne,
    selectRange,
    selectAll,
    clearSelection,
    usage,
    uploading,
    saving,
    canBack: past.length > 0,
    canForward: future.length > 0,
    canUp: loc.path !== '',
    segments: loc.path.split('/').filter(Boolean),
    openRoot,
    openFolder,
    openPathIndex,
    goUp,
    goBack,
    goForward,
    refresh,
    mkdir,
    renameEntry,
    removeEntry,
    removeEntries,
    uploadFiles,
    downloadEntry,
    downloadEntries,
  }
}

export type FilesState = ReturnType<typeof useFiles>
