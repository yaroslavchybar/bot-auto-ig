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

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN bun run --filter frontend build

FROM nginx:alpine AS frontend-runtime

COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
