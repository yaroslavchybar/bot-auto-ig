export type Model = {
  id: string
  name: string
  baseFullName?: string
  fullNameVariations?: string[]
  usernames?: string[]
}

export type ModelContentItem = {
  id: string
  kind: 'posts' | 'avatars'
  name: string
  variantCount: number
  usedCount: number
}
