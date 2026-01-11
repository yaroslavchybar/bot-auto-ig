import type { ActivityDefinition } from '../types';

/**
 * Watch Stories Activity
 * 
 * Views stories from the feed.
 * Settings mirror: StoriesSettingsDialog
 */
export const watchStories: ActivityDefinition = {
	id: 'watch_stories',
	name: 'Watch Stories',
	description: 'View stories from feed',
	category: 'stories',
	icon: 'CircleDot',
	color: '#f97316',
	
	inputs: [
		{
			name: 'stories_max',
			type: 'number',
			label: 'Max Stories to Watch',
			default: 3,
			min: 1,
			max: 50,
			helpText: 'Maximum number of stories to watch per profile',
		},
	],
	
	outputs: ['success', 'failure'],
	pythonHandler: 'instagram_actions.stories.watch',
};
