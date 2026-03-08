import type { ActivityDefinition } from '../types'

export const selectList: ActivityDefinition = {
  id: 'select_list',
  name: 'Select List',
  description: 'Select lists to pull accounts from for processing.',
  category: 'control',
  icon: 'List',
  color: '#3498DB',
  inputs: [
    {
      name: 'sourceLists',
      type: 'list_select',
      label: 'Source Lists',
      default: [],
      helpText: 'Select lists to pull target accounts from.',
    },
  ],
  outputs: ['next'],
  pythonHandler: 'control.select_list',
}
