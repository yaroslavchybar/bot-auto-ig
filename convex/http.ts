import { httpRouter } from 'convex/server';
import { registerInstagramAccountRoutes } from './httpRoutes/instagramAccounts';
import { registerListRoutes } from './httpRoutes/lists';
import { registerMessageTemplateRoutes } from './httpRoutes/messageTemplates';
import { registerProfileRoutes } from './httpRoutes/profiles';
import { registerScrapeJobRoutes } from './httpRoutes/scrapeJobs';

import { registerWorkflowRoutes } from './httpRoutes/workflows';

const http = httpRouter();

// Register all domain route groups
registerProfileRoutes(http);
registerListRoutes(http);
registerMessageTemplateRoutes(http);
registerInstagramAccountRoutes(http);
registerScrapeJobRoutes(http);
registerWorkflowRoutes(http);

export default http;
