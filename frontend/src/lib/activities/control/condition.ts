import type { ActivityDefinition } from '../types';

/**
 * Condition Activity
 * 
 * Branches based on a condition check.
 * Supports time of day, day of week, or random percentage.
 */
export const condition: ActivityDefinition = {
	id: 'condition',
	name: 'Condition',
	description: 'Branch based on a condition',
	category: 'control',
	icon: 'GitFork',
	color: '#6b7280',
	
	inputs: [
		{
			name: 'check',
			type: 'select',
			label: 'Check',
			default: 'random',
			options: [
				{ label: 'Time of Day', value: 'time' },
				{ label: 'Day of Week', value: 'day' },
				{ label: 'Random %', value: 'random' },
			],
		},
		{
			name: 'value',
			type: 'string',
			label: 'Value',
			placeholder: 'e.g. 50 for 50%',
		},
	],
	
	outputs: ['true', 'false'],
	pythonHandler: '__builtin__.condition',
};
