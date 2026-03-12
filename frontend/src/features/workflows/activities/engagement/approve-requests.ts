import type { ActivityDefinition } from '../types'

/**
 * Approve Requests Activity
 *
 * Approves pending follow requests.
 */
export const approveRequests: ActivityDefinition = {
  id: 'approve_requests',
  name: 'Approve Requests',
  description: 'Approve pending follow requests',
  category: 'engagement',
  icon: 'UserCheck',
  color: '#22c55e',

  inputs: [
    {
      name: 'approve_min_delay_seconds',
      type: 'number',
      label: 'Min',
      default: 1,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Between Approvals',
    },
    {
      name: 'approve_max_delay_seconds',
      type: 'number',
      label: 'Max',
      default: 2,
      min: 0,
      step: 0.1,
      unit: 'sec',
      group: 'Between Approvals',
    },
    {
      name: 'approve_finish_delay_seconds',
      type: 'number',
      label: 'Finish Delay',
      default: 3,
      min: 0,
      step: 0.1,
      unit: 'sec',
      helpText: 'Wait after processing notifications before closing.',
    },
  ],

  outputs: ['success', 'failure'],
  pythonHandler: 'instagram_actions.engagement.approve_follow_requests',
}


