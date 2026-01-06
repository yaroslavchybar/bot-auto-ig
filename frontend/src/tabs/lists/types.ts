export type List = {
  id: string
  name: string
}

export type ProfileRow = {
  profile_id: string
  name: string
  selected: boolean
  initialSelected: boolean
}

export type ListMode = 'list' | 'create' | 'edit' | 'delete'
