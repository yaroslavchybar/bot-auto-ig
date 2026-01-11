import type { ActivityDefinition } from '../types';

/**
 * Loop Activity
 * 
 * Repeats connected nodes a specified number of times.
 * Outputs 'loop' while iterating and 'done' when complete.
 */
export const loop: ActivityDefinition = {
	id: 'loop',
	name: 'Loop',
	description: 'Repeat connected nodes N times',
	category: 'control',
	icon: 'Repeat',
	color: '#6b7280',
	
	inputs: [
		{
			name: 'iterations',
			type: 'number',
			label: 'Iterations',
			default: 3,
			min: 1,
			max: 100,
		},
	],
	
	outputs: ['loop', 'done'],
	pythonHandler: '__builtin__.loop',
};
