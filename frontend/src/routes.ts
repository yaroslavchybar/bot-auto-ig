import { index, layout, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('./routes/index.tsx'),
  layout('./routes/auth-layout.tsx', [
    route('sign-in/*', './routes/sign-in.tsx'),
    route('sign-up/*', './routes/sign-up.tsx'),
  ]),
  layout('./routes/protected-layout.tsx', [
    route('profiles', './routes/profiles.tsx'),
    route('workflows', './routes/workflows.tsx'),
    route('workflows/:workflowId/editor', './routes/workflow-editor.tsx'),
    route('scraped-data', './routes/scraped-data.tsx'),
    route('lists', './routes/lists.tsx'),
    route('accounts', './routes/accounts.tsx'),
    route('logs', './routes/logs.tsx'),
    route('vnc', './routes/vnc.tsx'),
    route('vnc/session/:workflowId/:profileName', './routes/vnc-session.tsx'),
    route('monitoring', './routes/monitoring.tsx'),
  ]),
] satisfies RouteConfig
