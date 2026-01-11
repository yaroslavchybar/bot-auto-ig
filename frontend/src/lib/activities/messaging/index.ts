/**
 * Messaging Activities
 * 
 * Activities for sending direct messages.
 * Includes templates hook and settings dialog.
 */

// Activity definitions
export { sendDm } from './send-dm';

// Hooks
export { useMessageTemplates } from './useMessageTemplates';
export type { MessageTemplateKind } from './useMessageTemplates';

// Components
export { MessageSettingsDialog } from './MessageSettingsDialog';

import { sendDm } from './send-dm';

export const messagingActivities = [sendDm];
