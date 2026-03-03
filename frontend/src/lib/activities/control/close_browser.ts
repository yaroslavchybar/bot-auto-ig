import type { ActivityDefinition } from '../types';

export const closeBrowser: ActivityDefinition = {
    id: 'close_browser',
    name: 'Close Browser',
    description: 'Closes the current browser profile session. Usually placed at the end of a workflow.',
    category: 'control',
    icon: 'LogOut',
    color: '#E74C3C',
    inputs: [],
    outputs: ['next'],
    pythonHandler: 'control.close_browser',
};
