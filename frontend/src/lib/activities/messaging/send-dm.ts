import type { ActivityDefinition } from '../types';

/**
 * Send Messages Activity
 * 
 * Sends direct messages to users.
 * Settings mirror: MessageSettingsDialog
 */
export const sendDm: ActivityDefinition = {
	id: 'send_dm',
	name: 'Send Messages',
	description: 'Send direct messages',
	category: 'messaging',
	icon: 'MessageCircle',
	color: '#a855f7',
	
	inputs: [
		// Template Kind selection
		{
			name: 'template_kind',
			type: 'select',
			label: 'Message Template',
			default: 'message',
			options: [
				{ label: 'Standard Messages', value: 'message' },
				{ label: 'Alternative Messages', value: 'message_2' },
			],
		},
		// Template preview and management
		{
			name: 'templates_preview',
			type: 'template',
			label: 'Message Templates',
			helpText: 'Templates that will be randomly selected for messages',
		},
	],
	
	outputs: ['success', 'failure'],
	pythonHandler: 'instagram_actions.messaging.send_dm',
};
