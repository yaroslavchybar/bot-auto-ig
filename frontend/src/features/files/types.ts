export type FileRootKind = 'general' | 'profiles'

export type FileRoot = { id: string; label: string; kind: FileRootKind }

export type FileEntry = {
  name: string
  isDir: boolean
  size: number
  mtime: number
  kind: string
}

export type FilesUsage = {
  total: number
  free: number
  used: number
  usedPercent: number
  uploadsCount: number
  uploadsBytes: number
}

export type FilesLocation = { root: string; path: string }

export type FilesSortKey = 'name' | 'size' | 'mtime' | 'kind'
export type FilesView = 'list' | 'grid'
