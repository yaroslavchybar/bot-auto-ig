import type { ActivityDefinition } from '../types';

/**
 * Delay Activity
 * 
 * Waits for a random duration between min and max.
 * Used to add natural pauses between actions.
 */
export const delay: ActivityDefinition = {
	id: 'delay',
	name: 'Delay',
	description: 'Wait for a random duration',
	category: 'control',
	icon: 'Clock',
	color: '#6b7280',
	
	inputs: [
		{
			name: 'minSeconds',
			type: 'number',
			label: 'Min (seconds)',
			default: 30,
			min: 1,
		},
		{
			name: 'maxSeconds',
			type: 'number',
			label: 'Max (seconds)',
			default: 120,
			min: 1,
		},
	],
	
	outputs: ['next'],
	pythonHandler: '__builtin__.delay',
};
