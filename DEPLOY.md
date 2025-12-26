# Deployment Guide

This guide explains how to deploy the application to a VPS using Docker and run it 24/7 with TUI control.

## Prerequisites

- A VPS with Docker and Docker Compose installed.
- Your `.env` file configured with Supabase credentials.

## 1. Setup

1.  **Clone the repository** (or copy your files) to the VPS.
2.  Ensure your `.env` file is present in the root directory.
3.  Ensure `profiles` and `logs` directories exist (optional, Docker will create them if missing, but good to be aware).

## 2. Build and Run

Run the following command to build the image and start the container in detached mode:

```bash
docker-compose up -d --build
```

This will start the application in the background. It is configured to restart automatically unless explicitly stopped (`restart: unless-stopped`).

## 3. Controlling the App (TUI)

To access the Terminal User Interface (TUI):

```bash
docker attach anti-instagram
```

You can now interact with the TUI as if it were running locally.

### Important: Detaching

**DO NOT** press `Ctrl+C` to exit the TUI, as this will kill the container (and the automation).

To detach and leave the app running in the background:
**Press `Ctrl+P`, followed by `Ctrl+Q`.**

## 4. Viewing Logs

Since the TUI takes over the main output, if you want to see raw logs (if configured to file) or check container status:

```bash
docker-compose logs -f
```

## 5. Stopping the App

To stop the application completely:

```bash
docker-compose down
```

## Troubleshooting

-   **"The input device is not a TTY"**: Ensure you are running `docker attach` from a terminal that supports TTY (like your SSH session).
-   **App exits immediately**: Check logs with `docker-compose logs`. It might be a missing `.env` variable or dependency error.
