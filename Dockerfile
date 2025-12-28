FROM python:3.10-bookworm

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Install system dependencies for Playwright/Camoufox
RUN pip install playwright && \
    playwright install-deps

WORKDIR /app

# Copy python requirements and install
COPY python/requirements.txt .
RUN pip install -r requirements.txt
RUN playwright install firefox

# Copy CLI dependencies first for caching
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Copy the rest of the app
WORKDIR /app
COPY . .

# Build CLI
RUN npm run build

# Go back to root
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV TERM=xterm-256color

# Entrypoint: Start the TUI
CMD ["npm", "start"]
