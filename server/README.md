# Anti Server

Backend API Server for the Anti Automation System. This server acts as the control center for Instagram automation, managing Python subprocesses, handling WebSocket communication for real-time logs, and syncing data with a Convex backend.

## Features

- **REST API**: Comprehensive endpoints for controlling automation, managing profiles, and configuring settings.
- **Real-time Communication**: WebSocket server for live log streaming and status updates.
- **Process Management**: Orchestrates Python scripts for Instagram automation and profile browsing.
- **Data Persistence**: seamless integration with Convex for storing profiles, lists, and settings.
- **Docker Support**: Multi-stage Docker build for optimized production deployment.

## Prerequisites

- **Node.js**: v20 or higher
- **Python**: v3.x (with required dependencies installed)
- **Convex**: A configured Convex project

## Installation

1.  **Clone the repository** (if part of a larger repo, navigate to `server/`):
    ```bash
    cd server
    ```

2.  **Install Node.js dependencies**:
    ```bash
    npm install
    ```

3.  **Install Python dependencies** (ensure you have a virtual environment if needed):
    ```bash
    # Assuming requirements.txt is in the root or scripts folder
    pip install -r ../requirements.txt
    ```

## Configuration

Create a `.env` file in the project root (or ensure environment variables are set):

```env
# Server Configuration
SERVER_PORT=3001

# Convex Configuration
CONVEX_URL=https://your-convex-project.convex.site
CONVEX_API_KEY=your_convex_api_key
# OR
CONVEX_HTTP_BEARER_TOKEN=your_convex_token
```

## Running the Server

### Development
Starts the server with hot-reloading using `tsx`.

```bash
npm run dev
```

### Production
Builds the TypeScript code and starts the compiled server.

```bash
npm run build
npm start
```

### Docker

Build the image:
```bash
docker build -t anti-server .
```

Run the container:
```bash
docker run -p 3001:3001 --env-file .env anti-server
```

## API Reference

### Automation

-   **GET /api/automation/status**
    -   Returns the current status of the automation process.
    -   Response: `{ status: 'idle' | 'running', running: boolean }`

-   **POST /api/automation/start**
    -   Starts the Instagram automation Python script.
    -   Body: Instagram Settings object (see types).
    -   Response: `{ success: true, message: 'Automation started' }`

### Profiles

-   **GET /api/profiles**
    -   List all profiles.

-   **POST /api/profiles**
    -   Create a new profile.
    -   Body: `{ name: string, ... }`

-   **PUT /api/profiles/:name**
    -   Update an existing profile.

-   **DELETE /api/profiles/:name**
    -   Delete a profile.

-   **POST /api/profiles/:name/start**
    -   Launch a browser instance for manual control of a profile.

### Lists

-   **GET /api/lists**
    -   Get all lists.

-   **POST /api/lists**
    -   Create a new list.
    -   Body: `{ name: string }`

-   **PUT /api/lists/:id**
    -   Update a list name.

-   **DELETE /api/lists/:id**
    -   Delete a list.

### Logs

-   **GET /api/logs**
    -   Get recent logs stored in memory (max 500).

-   **GET /api/logs/files**
    -   List available log files on disk.

-   **GET /api/logs/file/:name**
    -   Get content of a specific log file.

-   **DELETE /api/logs**
    -   Clear in-memory and file logs.

### Instagram Settings

-   **GET /api/instagram/settings**
    -   Get current Instagram automation settings.
    -   Query: `?scope=global` (default)

-   **POST /api/instagram/settings**
    -   Update Instagram automation settings.
    -   Body: `{ scope: string, ...settings }`

## WebSocket API

Connect to `ws://localhost:3001/ws` for real-time updates.

### Events (Server -> Client)

-   **Status Update**
    ```json
    {
      "type": "status",
      "status": "idle" | "running"
    }
    ```

-   **Log Entry**
    ```json
    {
      "type": "log",
      "message": "Log message content",
      "level": "info" | "warn" | "error" | "success",
      "source": "server" | "python",
      "ts": 1700000000000
    }
    ```

## Project Structure

-   `index.ts`: Server entry point and Express app setup.
-   `websocket.ts`: WebSocket server implementation.
-   `store.ts`: In-memory state management (clients, logs, processes).
-   `routes/`: API route handlers.
-   `lib/`: Helper libraries (Convex client, logging, profile management).
-   `types/`: TypeScript type definitions.
-   `python/scripts/`: Python automation scripts (referenced).
