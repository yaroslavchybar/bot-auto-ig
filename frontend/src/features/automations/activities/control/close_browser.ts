import type { ActivityDefinition } from '../types'

export const closeBrowser: ActivityDefinition = {
  id: 'close_browser',
  keywords: ['stop browser', 'close'],
  pickerGroup: 'setup',
  quickAdd: false,
  name: 'Close Browser',
  description:
    'Closes the current browser profile session. Usually placed at the end of an automation.',
  category: 'control',
  icon: 'LogOut',
  color: '#E74C3C',
  inputs: [],
  outputs: ['next'],
}


