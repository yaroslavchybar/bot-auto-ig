import { httpRouter } from 'convex/server';
import { registerListRoutes } from './httpRoutes/lists';
import { registerMessageTemplateRoutes } from './httpRoutes/messageTemplates';
import { registerProfileRoutes } from './httpRoutes/profiles';

import { registerAutomationRoutes } from './httpRoutes/automations';

const http = httpRouter();

// Register all domain route groups
registerProfileRoutes(http);
registerListRoutes(http);
registerMessageTemplateRoutes(http);
registerAutomationRoutes(http);

export default http;
