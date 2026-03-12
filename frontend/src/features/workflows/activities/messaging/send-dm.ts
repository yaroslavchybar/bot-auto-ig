import type { ActivityDefinition } from '../types'

/**
 * Send Messages Activity
 *
 * Sends direct messages to users.
 * Settings mirror: MessageSettingsDialog
 */
export const sendDm: ActivityDefinition = {
  id: 'send_dm',
  name: 'Send Messages',
  description: 'Send direct messages to assigned accounts',
  category: 'messaging',
  icon: 'MessageCircle',
  color: '#a855f7',

  inputs: [
    {
      name: 'template_kind',
      type: 'select',
      label: 'Template Bank',
      default: 'message',
      options: [
        { label: 'Standard', value: 'message' },
        { label: 'Alternative', value: 'message_2' },
      ],
      group: 'Templates',
    },
    {
      name: 'templates_preview',
      type: 'template',
      label: 'Message Templates',
      templateKindField: 'template_kind',
      helpText: 'Templates that will be randomly selected for messages',
      group: 'Templates',
    },
    {
      name: 'follow_if_no_message_button',
      type: 'boolean',
      label: 'Follow If Message Missing',
      default: true,
      helpText: 'Try to follow the user before retrying the Message button.',
    },
    {
      name: 'navigation_delay_min_seconds',
      type: 'number',
      label: 'Min',
      default: 2,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Navigation Delay',
    },
    {
      name: 'navigation_delay_max_seconds',
      type: 'number',
      label: 'Max',
      default: 3,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Navigation Delay',
    },
    {
      name: 'composer_delay_min_seconds',
      type: 'number',
      label: 'Min',
      default: 1,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Composer Delay',
    },
    {
      name: 'composer_delay_max_seconds',
      type: 'number',
      label: 'Max',
      default: 2,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Composer Delay',
    },
    {
      name: 'typing_delay_min_ms',
      type: 'number',
      label: 'Min',
      default: 100,
      min: 0,
      max: 1000,
      unit: 'ms',
      group: 'Typing Delay',
    },
    {
      name: 'typing_delay_max_ms',
      type: 'number',
      label: 'Max',
      default: 200,
      min: 0,
      max: 1000,
      unit: 'ms',
      group: 'Typing Delay',
    },
    {
      name: 'between_targets_min_seconds',
      type: 'number',
      label: 'Min',
      default: 3,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Between Targets',
    },
    {
      name: 'between_targets_max_seconds',
      type: 'number',
      label: 'Max',
      default: 5,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Between Targets',
    },
  ],

  outputs: ['success', 'failure'],
  pythonHandler: 'instagram_actions.messaging.send_dm',
}


