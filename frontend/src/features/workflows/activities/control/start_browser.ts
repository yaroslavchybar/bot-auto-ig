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
      group: 'Execution',
    },
    {
      name: 'parallelProfiles',
      type: 'number',
      label: 'Parallel Profiles',
      default: 1,
      min: 1,
      max: 10,
      helpText: 'How many profiles this workflow may run in parallel.',
      group: 'Execution',
    },
    {
      name: 'profileReopenCooldownEnabled',
      type: 'boolean',
      label: 'Profile Reopen Cooldown',
      default: false,
      helpText: 'Skip profiles opened recently within the configured window.',
      group: 'Profile Cooldown',
    },
    {
      name: 'profileReopenCooldownMinutes',
      type: 'number',
      label: 'Cooldown Minutes',
      default: 30,
      min: 0,
      max: 10080,
      unit: 'min',
      group: 'Profile Cooldown',
    },
    {
      name: 'messagingCooldownEnabled',
      type: 'boolean',
      label: 'Messaging Cooldown',
      default: false,
      helpText: 'Skip accounts that were messaged recently.',
      group: 'Messaging Cooldown',
    },
    {
      name: 'messagingCooldownHours',
      type: 'number',
      label: 'Cooldown Hours',
      default: 2,
      min: 0,
      max: 168,
      unit: 'h',
      group: 'Messaging Cooldown',
    },
  ],
  outputs: ['next'],
  pythonHandler: 'control.start_browser',
}


