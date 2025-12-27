# Deployment Guide (Docker Hub)

This guide explains how to deploy the application to a VPS by pulling the pre-built image from Docker Hub.

## Prerequisites

- A VPS with Docker and Docker Compose installed.
- Your `.env` file configured with Supabase credentials.

## 1. Setup on VPS

1.  **Create a directory** for the app (e.g., `~/anti`).
2.  **Copy the following files** to that directory:
    -   `docker-compose.yml`
    -   `.env`
3.  Ensure `profiles` and `logs` directories exist (optional, Docker will create them).

## 2. Pull and Run

Run the following command to pull the latest image and start the container:

```bash
docker-compose pull
docker-compose up -d
```

## 3. Controlling the App (TUI)

To access the Terminal User Interface (TUI):

```bash
docker attach anti-instagram
```

**Important**: To detach without stopping, press **`Ctrl+P` then `Ctrl+Q`**.

## 4. Maintenance

To update the app to the latest version:

```bash
docker-compose pull
docker-compose up -d
```
