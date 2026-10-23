# syntax=docker/dockerfile:1.7
FROM node:24.21.0-bookworm-slim AS frontend-build

COPY --from=oven/bun:1.4.4-slim /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY --from=repo_root package.json bun.lock ./
COPY --from=repo_root server/package.json ./server/package.json
COPY --from=repo_root frontend/package.json ./frontend/package.json
# Full workspace install: the build typechecks ../convex (needs the root
# convex deps) and test files (needs root vitest). Scripts are skipped for a
# fast hermetic build. The build stage is discarded, so dev deps never reach
# the nginx runtime image.
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --ignore-scripts

COPY . ./frontend/
COPY --from=convex_src . /app/convex/
# convex/tsconfig.json extends this config when Vite bundles shared modules.
COPY --from=repo_root tsconfig.json ./tsconfig.json
COPY --from=repo_root vite.config.ts ./vite.config.ts
COPY --from=repo_root .node-version ./.node-version
# Frontend and Convex import shared modules. Copy the folder so new imports
# remain available without maintaining a separate file list for this build.
COPY --from=repo_root server/shared ./server/shared

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
