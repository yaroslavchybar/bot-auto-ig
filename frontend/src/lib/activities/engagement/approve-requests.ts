import type { ActivityDefinition } from '../types';

/**
 * Approve Requests Activity
 * 
 * Approves pending follow requests.
 * No additional settings needed.
 */
export const approveRequests: ActivityDefinition = {
	id: 'approve_requests',
	name: 'Approve Requests',
	description: 'Approve pending follow requests',
	category: 'engagement',
	icon: 'UserCheck',
	color: '#22c55e',
	
	inputs: [],
	
	outputs: ['success', 'failure'],
	pythonHandler: 'instagram_actions.engagement.approve_follow_requests',
};
