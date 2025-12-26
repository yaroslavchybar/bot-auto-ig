FROM python:3.10-bookworm

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs

# Install system dependencies for Playwright/Camoufox
# We install playwright first to use its install-deps command
RUN pip install playwright && \
    playwright install-deps

# Set working directory
WORKDIR /app

# Copy python requirements and install
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN playwright install firefox

# Copy the rest of the app
COPY . .

# Build CLI
WORKDIR /app/cli
RUN npm install
RUN npm run build

# Go back to root
WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV TERM=xterm-256color

# Entrypoint: Start the TUI
# We use npm start inside the cli directory
CMD ["npm", "start", "--prefix", "cli"]
