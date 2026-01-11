import type { ActivityDefinition } from '../types';

/**
 * Browse Feed Activity
 * 
 * Scrolls through the Instagram home feed.
 * Settings mirror: FeedSettingsDialog
 */
export const browseFeed: ActivityDefinition = {
	id: 'browse_feed',
	name: 'Feed Scroll',
	description: 'Scroll through home feed',
	category: 'browsing',
	icon: 'Scroll',
	color: '#3b82f6',
	
	inputs: [
		// Duration (Min Time / Max Time)
		{
			name: 'feed_min_time_minutes',
			type: 'number',
			label: 'Min Time (min)',
			default: 1,
			min: 1,
			group: 'Duration',
		},
		{
			name: 'feed_max_time_minutes',
			type: 'number',
			label: 'Max Time (min)',
			default: 3,
			min: 1,
			group: 'Duration',
		},
		
		// Like Chance
		{
			name: 'like_chance',
			type: 'range',
			label: 'Like Chance (%)',
			default: 10,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Follow Chance
		{
			name: 'follow_chance',
			type: 'range',
			label: 'Follow Chance (%)',
			default: 0,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Carousel Watch Chance
		{
			name: 'carousel_watch_chance',
			type: 'range',
			label: 'Carousel Watch Chance (%)',
			default: 0,
			min: 0,
			max: 100,
			unit: '%',
		},
		
		// Carousel Max Slides
		{
			name: 'carousel_max_slides',
			type: 'number',
			label: 'Carousel Max Slides',
			default: 3,
			min: 1,
			max: 10,
		},
	],
	
	outputs: ['success', 'failure'],
	pythonHandler: 'instagram_actions.browsing.feed_scrolling',
};
