# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.2-slim AS frontend-build

WORKDIR /app

COPY --from=repo_root package.json bun.lock ./
COPY --from=repo_root server/package.json ./server/package.json
COPY --from=repo_root frontend/package.json ./frontend/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --filter frontend

COPY . ./frontend/
COPY --from=convex_src . /app/convex/

ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_DATAUPLOADER_URL
ENV VITE_DATAUPLOADER_URL=$VITE_DATAUPLOADER_URL

RUN bun run --filter frontend build

FROM oven/bun:1.4.2-slim AS frontend-runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80

COPY --from=frontend-build /app/package.json ./package.json
COPY --from=frontend-build /app/bun.lock ./bun.lock
COPY --from=frontend-build /app/frontend/package.json ./frontend/package.json
COPY --from=frontend-build /app/server/package.json ./server/package.json
COPY --from=frontend-build /app/node_modules ./node_modules
COPY --from=frontend-build /app/frontend/build ./frontend/build

EXPOSE 80

CMD ["bun", "run", "--filter", "frontend", "start", "--", "--host", "0.0.0.0", "--port", "80"]
