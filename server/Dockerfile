FROM node:20-bookworm-slim

WORKDIR /app

# Layer 1: System dependencies (cached unless apt packages change)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  python3 \
  python3-venv \
  python3-pip \
  python-is-python3 \
  ca-certificates \
  # Virtual display for headless=false
  xvfb \
  x11vnc \
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
  && rm -rf /var/lib/apt/lists/*

# Layer 2: Python venv (rarely changes)
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Layer 3: Python requirements (only rebuilds when requirements.txt changes)
COPY python/requirements.txt ./python/requirements.txt
RUN pip install --no-cache-dir -r python/requirements.txt

# Layer 4: Browser downloads (only rebuilds when requirements.txt changes)
RUN python -m camoufox fetch \
  && python -m playwright install --with-deps firefox

# Layer 5: Node dependencies (only rebuilds when package.json changes)
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

# Layer 6: Application code (rebuilds on every code change - fast)
COPY server ./server
COPY python ./python
RUN cd server && npm run build

# Layer 7: Config files
COPY server/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

WORKDIR /app/server
ENV NODE_ENV=production
ENV DISPLAY=:99

EXPOSE 3001
EXPOSE 6080

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
