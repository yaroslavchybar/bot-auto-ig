export type List = {
  id: string
  name: string
  fullName?: string
  fullNames?: string[]
  usernames?: string[]
}

export type ModelContentItem = {
  id: string
  kind: 'posts' | 'avatars'
  name: string
  variantCount: number
  usedCount: number
}
