import { httpRouter } from 'convex/server';
import { registerInstagramAccountRoutes } from './httpRoutes/instagramAccounts';
import { registerListRoutes } from './httpRoutes/lists';
import { registerMessageTemplateRoutes } from './httpRoutes/messageTemplates';
import { registerProfileRoutes } from './httpRoutes/profiles';
import { registerScrapingAccountRoutes } from './httpRoutes/scrapingAccounts';

import { registerWorkflowArtifactRoutes } from './httpRoutes/workflowArtifacts';
import { registerWorkflowRoutes } from './httpRoutes/workflows';

const http = httpRouter();

// Register all domain route groups
registerProfileRoutes(http);
registerListRoutes(http);
registerMessageTemplateRoutes(http);
registerInstagramAccountRoutes(http);
registerScrapingAccountRoutes(http);
registerWorkflowRoutes(http);
registerWorkflowArtifactRoutes(http);

export default http;
