import type { ActivityDefinition } from '../types';

/**
 * Browse Reels Activity
 * 
 * Scrolls through Instagram reels.
 * Settings mirror: ReelsSettingsDialog
 */
export const browseReels: ActivityDefinition = {
	id: 'browse_reels',
	name: 'Reels Scroll',
	description: 'Scroll through reels',
	category: 'browsing',
	icon: 'Film',
	color: '#3b82f6',
	
	inputs: [
		// Duration (Min Time / Max Time)
		{
			name: 'reels_min_time_minutes',
			type: 'number',
			label: 'Min Time (min)',
			default: 1,
			min: 1,
			group: 'Duration',
		},
		{
			name: 'reels_max_time_minutes',
			type: 'number',
			label: 'Max Time (min)',
			default: 3,
			min: 1,
			group: 'Duration',
		},
		
		// Like Chance
		{
			name: 'reels_like_chance',
			type: 'range',
			label: 'Like Chance (%)',
			default: 10,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Follow Chance
		{
			name: 'reels_follow_chance',
			type: 'range',
			label: 'Follow Chance (%)',
			default: 0,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Skip Chance
		{
			name: 'reels_skip_chance',
			type: 'range',
			label: 'Skip Chance (%)',
			default: 30,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Skip Timing (seconds)
		{
			name: 'reels_skip_min_time',
			type: 'number',
			label: 'Min',
			default: 0.8,
			min: 0,
			step: 0.1,
			unit: 'sec',
			group: 'Skip Timing',
		},
		{
			name: 'reels_skip_max_time',
			type: 'number',
			label: 'Max',
			default: 2.0,
			min: 0,
			step: 0.1,
			unit: 'sec',
			group: 'Skip Timing',
		},
		
		// Normal Watch Timing (seconds)
		{
			name: 'reels_normal_min_time',
			type: 'number',
			label: 'Min',
			default: 5.0,
			min: 0,
			step: 0.1,
			unit: 'sec',
			group: 'Normal Watch Timing',
		},
		{
			name: 'reels_normal_max_time',
			type: 'number',
			label: 'Max',
			default: 20.0,
			min: 0,
			step: 0.1,
			unit: 'sec',
			group: 'Normal Watch Timing',
		},
	],
	
	outputs: ['success', 'failure'],
	pythonHandler: 'instagram_actions.browsing.reels_scrolling',
};
