# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS frontend-build

WORKDIR /app

COPY --from=repo_root package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev

WORKDIR /app/frontend

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

COPY . ./
COPY --from=convex_src . /app/convex/

ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

ARG VITE_DATAUPLOADER_URL
ENV VITE_DATAUPLOADER_URL=$VITE_DATAUPLOADER_URL

RUN npm run build

FROM node:20-bookworm-slim AS frontend-runtime

WORKDIR /app/frontend

ENV NODE_ENV=production
ENV PORT=80

COPY --from=frontend-build /app/frontend/package.json ./package.json
COPY --from=frontend-build /app/frontend/package-lock.json ./package-lock.json
COPY --from=frontend-build /app/frontend/node_modules ./node_modules
COPY --from=frontend-build /app/frontend/build ./build

EXPOSE 80

CMD ["npm", "run", "start", "--", "--host", "0.0.0.0", "--port", "80"]
