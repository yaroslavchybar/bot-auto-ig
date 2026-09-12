# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.2-slim AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY datauploader/package.json ./datauploader/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --filter anti-uploader

COPY datauploader ./datauploader
RUN bun run --filter anti-uploader build

FROM oven/bun:1.4.2-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3002
ENV UPLOAD_DIR=/app/uploads

RUN mkdir -p /app/uploads

COPY --from=build /app/package.json /app/bun.lock /app/
COPY --from=build /app/datauploader/package.json /app/datauploader/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/datauploader/dist /app/datauploader/dist

WORKDIR /app/datauploader

EXPOSE 3002

CMD ["bun", "dist/index.js"]
