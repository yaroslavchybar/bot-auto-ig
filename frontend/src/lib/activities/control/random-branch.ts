import type { ActivityDefinition } from '../types';

/**
 * Random Branch Activity
 * 
 * Randomly selects one of multiple paths based on weights.
 * Useful for varying behavior between workflow runs.
 */
export const randomBranch: ActivityDefinition = {
	id: 'random_branch',
	name: 'Random Branch',
	description: 'Randomly choose a path',
	category: 'control',
	icon: 'GitBranch',
	color: '#6b7280',
	
	inputs: [
		{
			name: 'weights',
			type: 'string',
			label: 'Weights (comma-separated)',
			default: '50,50',
			placeholder: 'e.g. 50,30,20',
		},
	],
	
	outputs: ['path_a', 'path_b', 'path_c'],
	pythonHandler: '__builtin__.random_branch',
};
