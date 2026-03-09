import type { ActivityDefinition } from '../types'

export const startBrowser: ActivityDefinition = {
  id: 'start_browser',
  name: 'Start Browser',
  description:
    'Initializes a new browser profile session with global settings.',
  category: 'control',
  icon: 'Play',
  color: '#2ECC71',
  inputs: [
    {
      name: 'headlessMode',
      type: 'boolean',
      label: 'Headless Mode',
      default: false,
      helpText: 'Run browser without a visible window.',
    },
    {
      name: 'profileReopenCooldown',
      type: 'number',
      label: 'Profile Reopen Cooldown',
      default: 30,
      min: 0,
      unit: 'min',
      helpText: 'Wait time before reopening the same profile.',
    },
    {
      name: 'messagingCooldown',
      type: 'number',
      label: 'Messaging Cooldown',
      default: 24,
      min: 0,
      unit: 'h',
      helpText: 'Wait time before messaging the same user again.',
    },
  ],
  outputs: ['next'],
  pythonHandler: 'control.start_browser',
}


