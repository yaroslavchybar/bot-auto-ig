import { httpRouter } from 'convex/server';
import { registerListRoutes } from './httpRoutes/lists';
import { registerMessageTemplateRoutes } from './httpRoutes/messageTemplates';
import { registerProfileRoutes } from './httpRoutes/profiles';

import { registerAutomationRoutes } from './httpRoutes/automations';
import { registerWarmupRoutes } from './httpRoutes/warmup';
import { registerRoutineRoutes } from './httpRoutes/routines';
import { registerScraperRoutes } from './httpRoutes/scraper';
import { registerLeadListRoutes } from './httpRoutes/leadLists';

const http = httpRouter();

// Register all domain route groups
registerProfileRoutes(http);
registerListRoutes(http);
registerMessageTemplateRoutes(http);
registerAutomationRoutes(http);
registerWarmupRoutes(http);
registerRoutineRoutes(http);
registerScraperRoutes(http);
registerLeadListRoutes(http);

export default http;
