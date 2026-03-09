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
    route('scraping', './routes/scraping.tsx'),
    route('lists', './routes/lists.tsx'),
    route('accounts', './routes/accounts.tsx'),
    route('logs', './routes/logs.tsx'),
    route('vnc', './routes/vnc.tsx'),
    route('monitoring', './routes/monitoring.tsx'),
  ]),
] satisfies RouteConfig
