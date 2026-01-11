import type { ActivityDefinition } from '../types';

/**
 * Unfollow Activity
 * 
 * Unfollows users.
 * Settings mirror: UnfollowSettingsDialog
 */
export const unfollowUser: ActivityDefinition = {
	id: 'unfollow_user',
	name: 'Unfollow',
	description: 'Unfollow users',
	category: 'engagement',
	icon: 'UserMinus',
	color: '#22c55e',
	
	inputs: [
		// Delay
		{
			name: 'min_delay',
			type: 'number',
			label: 'Delay Min (sec)',
			default: 10,
			min: 1,
			unit: 'sec',
			group: 'Delay',
		},
		{
			name: 'max_delay',
			type: 'number',
			label: 'Delay Max (sec)',
			default: 30,
			min: 1,
			unit: 'sec',
			group: 'Delay',
		},
		
		// Unfollow Count per Session
		{
			name: 'unfollow_min_count',
			type: 'number',
			label: 'Min',
			default: 5,
			min: 1,
			group: 'Unfollow Count per Session',
		},
		{
			name: 'unfollow_max_count',
			type: 'number',
			label: 'Max',
			default: 15,
			min: 1,
			group: 'Unfollow Count per Session',
		},
	],
	
	outputs: ['success', 'failure'],
	pythonHandler: 'instagram_actions.engagement.unfollow_users',
};
