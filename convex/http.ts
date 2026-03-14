import { httpRouter } from 'convex/server';
import { registerInstagramAccountRoutes } from './httpRoutes/instagramAccounts';
import { registerKeywordRoutes } from './httpRoutes/keywords';
import { registerListRoutes } from './httpRoutes/lists';
import { registerMessageTemplateRoutes } from './httpRoutes/messageTemplates';
import { registerProfileRoutes } from './httpRoutes/profiles';
import { registerPreflight } from './httpRoutes/shared';
import { registerWorkflowArtifactRoutes } from './httpRoutes/workflowArtifacts';
import { registerWorkflowRoutes } from './httpRoutes/workflows';

const http = httpRouter();

// Register OPTIONS preflight for paths that only have OPTIONS handlers
registerPreflight(http, ['/api/instagram-settings']);

// Register all domain route groups
registerProfileRoutes(http);
registerListRoutes(http);
registerKeywordRoutes(http);
registerMessageTemplateRoutes(http);
registerInstagramAccountRoutes(http);
registerWorkflowRoutes(http);
registerWorkflowArtifactRoutes(http);

export default http;
