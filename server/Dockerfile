# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS system-base

WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/opt/venv/bin:$PATH"

# Stable system dependencies for the browser + VNC runtime.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update \
  && apt-get install -y --no-install-recommends \
  python3 \
  python3-venv \
  python3-pip \
  python-is-python3 \
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

RUN python3 -m venv /opt/venv

RUN mkdir -p /root/.fluxbox && \
  echo "session.screen0.toolbar.visible: false" > /root/.fluxbox/init && \
  echo "[app] (name=.*)" > /root/.fluxbox/apps && \
  echo "  [Deco] {NONE}" >> /root/.fluxbox/apps && \
  echo "[end]" >> /root/.fluxbox/apps

FROM system-base AS python-deps
COPY --from=python_src requirements.txt /tmp/python/requirements.txt
RUN --mount=type=cache,target=/root/.cache \
  pip install -r /tmp/python/requirements.txt

FROM python-deps AS browser-deps
RUN --mount=type=cache,target=/root/.cache \
  python -m camoufox fetch \
  && python -m playwright install --with-deps firefox

FROM browser-deps AS node-build-deps
WORKDIR /app/server
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

FROM browser-deps AS node-runtime-deps
WORKDIR /app/server
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci --omit=dev

FROM node-build-deps AS app-build
COPY . ./
RUN npm run build

FROM browser-deps AS server-runtime
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --from=node-runtime-deps /app/server/node_modules /app/server/node_modules
COPY --from=app-build /app/server/dist /app/server/dist
COPY --from=app-build /app/server/package.json /app/server/package.json
COPY --from=python_src . /app/python

WORKDIR /app/server
ENV NODE_ENV=production
ENV DISPLAY=:99

EXPOSE 3001
EXPOSE 6080
EXPOSE 6081-6130

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
