import type { ActivityDefinition } from '../types';

/**
 * Follow Activity
 * 
 * Follows users from the queue.
 * Settings mirror: FollowSettingsDialog
 */
export const followUser: ActivityDefinition = {
	id: 'follow_user',
	name: 'Follow',
	description: 'Follow users from queue',
	category: 'engagement',
	icon: 'UserPlus',
	color: '#22c55e',
	
	inputs: [
		// Highlights
		{
			name: 'highlights_min',
			type: 'number',
			label: 'Highlights Min',
			default: 0,
			min: 0,
			group: 'Highlights',
		},
		{
			name: 'highlights_max',
			type: 'number',
			label: 'Highlights Max',
			default: 2,
			min: 0,
			group: 'Highlights',
		},
		
		// Likes percentage
		{
			name: 'likes_percentage',
			type: 'range',
			label: 'Likes (% of posts)',
			default: 0,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Scroll percentage
		{
			name: 'scroll_percentage',
			type: 'range',
			label: 'Scroll (% of posts)',
			default: 0,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Following limit
		{
			name: 'following_limit',
			type: 'number',
			label: 'Target Following Limit',
			default: 3000,
			min: 0,
			helpText: 'Skip profiles following more than this amount',
		},
		
		// Follow Count per Session
		{
			name: 'follow_min_count',
			type: 'number',
			label: 'Min',
			default: 5,
			min: 1,
			group: 'Follow Count per Session',
		},
		{
			name: 'follow_max_count',
			type: 'number',
			label: 'Max',
			default: 15,
			min: 1,
			group: 'Follow Count per Session',
		},
	],
	
	outputs: ['success', 'failure'],
	pythonHandler: 'instagram_actions.engagement.follow_users',
};
