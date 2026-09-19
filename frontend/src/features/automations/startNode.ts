import type { ActivityInput } from './activities/types'

// Setup inputs merged from the old Start Browser + Select List blocks.
// The Start node owns the browser session, so it configures it directly.
export const START_NODE_INPUTS: ActivityInput[] = [
  {
    name: 'sourceLists',
    type: 'list_select',
    label: 'Source Lists',
    default: [],
    required: true,
    helpText: 'Select lists to pull target accounts from.',
  },
  {
    name: 'headlessMode',
    type: 'boolean',
    label: 'Headless Mode',
    default: false,
    helpText: 'Run browser without a visible window.',
    group: 'Execution',
  },
  {
    name: 'repeatWhileActive',
    type: 'boolean',
    label: 'Repeat While Active',
    default: false,
    helpText: 'Repeat warm-up sessions after their rest period, up to each profile’s daily budget. Continue on future UTC days.',
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
]

export function getDefaultStartConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const input of START_NODE_INPUTS) {
    if (input.default !== undefined) {
      config[input.name] = input.default
    }
  }
  return config
}

export function normalizeStartConfig(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...getDefaultStartConfig(), ...(config ?? {}) }
}
