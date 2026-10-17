import { httpRouter } from 'convex/server';
import { registerModelRoutes } from './httpRoutes/models';
import { registerProfileRoutes } from './httpRoutes/profiles';

import { registerAutomationRoutes } from './httpRoutes/automations';
import { registerWarmupRoutes } from './httpRoutes/warmup';
import { registerRoutineRoutes } from './httpRoutes/routines';
import { registerScraperRoutes } from './httpRoutes/scraper';
import { registerLeadListRoutes } from './httpRoutes/leadLists';
import { registerIgAccountRoutes } from './httpRoutes/igAccounts';

const http = httpRouter();

// Register all domain route groups
registerProfileRoutes(http);
registerModelRoutes(http);
registerAutomationRoutes(http);
registerWarmupRoutes(http);
registerRoutineRoutes(http);
registerScraperRoutes(http);
registerLeadListRoutes(http);
registerIgAccountRoutes(http);

export default http;
