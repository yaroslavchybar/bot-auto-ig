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
	description: 'Send direct messages to assigned accounts',
	category: 'messaging',
	icon: 'MessageCircle',
	color: '#a855f7',

	inputs: [
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
