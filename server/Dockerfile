# syntax=docker/dockerfile:1.7
FROM oven/bun:1.4.2-debian AS system-base

WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive

# Stable system dependencies for the browser + VNC runtime.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update \
  && apt-get install -y --no-install-recommends \
  ca-certificates \
  # Virtual display and window manager for headless=false
  fluxbox \
  tigervnc-standalone-server \
  novnc \
  websockify \
  # X11 dependencies for browsers
  libx11-6 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libxrender1 \
  libxtst6 \
  libgtk-3-0 \
  libasound2 \
  libdbus-glib-1-2 \
  libpci3 \
  procps \
  supervisor \
  # Video codecs for Firefox video playback
  ffmpeg \
  libavcodec-extra \
  libva2 \
  libva-drm2 \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /root/.fluxbox && \
  echo "session.screen0.toolbar.visible: false" > /root/.fluxbox/init && \
  echo "[app] (name=.*)" > /root/.fluxbox/apps && \
  echo "  [Deco] {NONE}" >> /root/.fluxbox/apps && \
  echo "[end]" >> /root/.fluxbox/apps

FROM system-base AS browser-deps
WORKDIR /app
COPY --from=repo_root package.json bun.lock ./
COPY --from=repo_root server/package.json ./server/package.json
COPY --from=repo_root frontend/package.json ./frontend/package.json
COPY --from=repo_root datauploader/package.json ./datauploader/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production --filter anti-server
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bunx --no-install camoufox-js fetch

FROM browser-deps AS bun-build-deps
WORKDIR /app
COPY --from=repo_root package.json bun.lock ./
COPY --from=repo_root server/package.json ./server/package.json
COPY --from=repo_root frontend/package.json ./frontend/package.json
COPY --from=repo_root datauploader/package.json ./datauploader/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --filter anti-server

FROM browser-deps AS bun-runtime-deps
WORKDIR /app
COPY --from=repo_root package.json bun.lock ./
COPY --from=repo_root server/package.json ./server/package.json
COPY --from=repo_root frontend/package.json ./frontend/package.json
COPY --from=repo_root datauploader/package.json ./datauploader/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production --filter anti-server

FROM bun-build-deps AS app-build
COPY --from=repo_root server ./server
RUN bun run --filter anti-server build

FROM browser-deps AS server-runtime
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --from=bun-runtime-deps /app/node_modules /app/node_modules
COPY --from=bun-runtime-deps /app/server /app/server
COPY --from=bun-runtime-deps /app/package.json /app/package.json
COPY --from=bun-runtime-deps /app/bun.lock /app/bun.lock
COPY --from=bun-runtime-deps /app/frontend/package.json /app/frontend/package.json
COPY --from=app-build /app/server/dist /app/server/dist
COPY --from=app-build /app/server/package.json /app/server/package.json
WORKDIR /app/server
ENV NODE_ENV=production
ENV DISPLAY=:99

EXPOSE 3001
EXPOSE 6080
EXPOSE 6081-6130

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
