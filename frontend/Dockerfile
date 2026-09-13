# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.2-slim AS frontend-build

WORKDIR /app

COPY --from=repo_root package.json bun.lock ./
COPY --from=repo_root server/package.json ./server/package.json
COPY --from=repo_root frontend/package.json ./frontend/package.json
# Full workspace install: the build typechecks ../convex (needs the root
# convex deps) and test files (needs root vitest). Scripts are skipped:
# better-sqlite3's install script (camoufox-js dep) can't build without
# node-gyp, and nothing in a frontend build loads native modules. The build
# stage is discarded, so dev deps never reach the nginx runtime image.
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts

COPY . ./frontend/
COPY --from=convex_src . /app/convex/
# Frontend typechecks shared wire types from the server package
# (frontend/src/hooks/useWebSocket.ts, frontend/src/features/workflows/activities/types.ts).
# Both are `import type`, erased from the bundle. Keep this in sync if the
# frontend imports more files from outside frontend/ and convex/.
COPY --from=repo_root server/shared/contracts.ts ./server/shared/contracts.ts

ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN bun run --filter frontend build

FROM nginx:alpine AS frontend-runtime

COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
