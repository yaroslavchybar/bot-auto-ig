# Project Restructuring Plan: Anti-CLI

## 1. Project Overview
This document outlines the plan to refactor the Anti-CLI codebase into a Clean Architecture compliant structure. The goal is to improve maintainability, separation of concerns, and developer experience by clearly distinguishing between Backend (Python), Frontend (React/Ink), and Infrastructure.

## 2. Current Structure
The current structure mixes languages and concerns at the root level.

```text
anti/
├── .github/
│   └── workflows/
├── python/                     # [Backend] Mixed source and scripts
│   ├── automation/             # Business Logic
│   │   ├── Follow/             # Feature (Non-standard capitalization)
│   │   ├── approvefollow/
│   │   ├── login/
│   │   ├── messaging/
│   │   ├── scrolling/
│   │   ├── stories/
│   │   ├── unfollow/
│   │   ├── actions.py          # Orchestrator
│   │   └── browser.py          # Infrastructure/Adapter
│   ├── core/                   # Domain & Shared Kernel
│   │   ├── automation/
│   │   ├── domain/
│   │   ├── observability/
│   │   ├── persistence/
│   │   ├── resilience/
│   │   └── runtime/
│   ├── data/                   # Local data (cache)
│   ├── supabase/               # Infrastructure (DB Clients)
│   ├── tests/                  # Tests
│   ├── launcher.py             # Entrypoint
│   ├── requirements.txt
│   └── supervisor.py           # Entrypoint
├── scripts/                    # [Scripts] Top-level scripts
│   ├── instagram_automation.py
│   └── login_automation.py
├── source/                     # [Frontend] React TUI
│   ├── components/
│   ├── lib/
│   ├── tests/
│   ├── types/
│   ├── app.tsx
│   └── cli.tsx
├── supabase/                   # [Infrastructure] DB Migrations
│   └── migrations/
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## 3. Proposed Clean Architecture
The new structure adopts a Monorepo-style layout with clear separation of Backend, Frontend, and Infrastructure.

```text
anti/
├── backend/                    # Python Backend
│   ├── src/
│   │   └── anti_cli/           # Main Package
│   │       ├── automation/     # [Layer] Application Business Rules
│   │       │   ├── features/   # Use Cases grouped by feature
│   │       │   │   ├── follow/ # (Renamed from Follow)
│   │       │   │   ├── login/
│   │       │   │   ├── messaging/
│   │       │   │   └── ...
│   │       │   ├── orchestrator.py  # (Renamed from actions.py)
│   │       │   └── browser.py       # Browser Control Interface
│   │       ├── core/           # [Layer] Enterprise Business Rules (Domain)
│   │       │   ├── domain/     # Entities
│   │       │   ├── interfaces/ # Ports (Abstract Interfaces)
│   │       │   └── resilience/ # Shared Kernel
│   │       ├── infrastructure/ # [Layer] Frameworks & Drivers
│   │       │   ├── database/   # (Renamed from supabase client)
│   │       │   ├── filesystem/ # Persistence adapters
│   │       │   └── logging/
│   │       └── entrypoints/    # Application Entry Points
│   │           ├── cli.py      # (Refactored launcher.py)
│   │           └── supervisor.py
│   ├── tests/                  # Unit & Integration Tests
│   ├── scripts/                # Utility scripts (moved from root)
│   ├── pyproject.toml          # Modern dependency management
│   └── README.md
├── frontend/                   # React TUI (Renamed from source)
│   ├── src/
│   │   ├── components/
│   │   ├── services/           # (Renamed from lib)
│   │   ├── types/
│   │   └── index.tsx
│   ├── package.json
│   └── tsconfig.json
├── infrastructure/             # DevOps & Database
│   ├── database/               # SQL Migrations
│   └── docker/                 # Docker configs
└── docs/                       # Project Documentation
```

## 4. Migration Strategy
We will execute this refactoring in phases to minimize disruption.

### Phase 1: Standardization & Prep (Low Risk)
*   **Goal**: Fix naming conventions and group files logically without moving root folders yet.
*   **Actions**:
    *   Rename `python/automation/Follow` -> `python/automation/follow`.
    *   Move root `scripts/*.py` into `python/scripts/`.

### Phase 2: Root Level Restructuring (Medium Risk)
*   **Goal**: Establish the `backend/` and `frontend/` directories.
*   **Actions**:
    *   Create `backend/src/anti_cli`.
    *   Move `python/*` contents to `backend/src/anti_cli/`.
    *   Move `tests/` to `backend/tests/`.
    *   Rename `source/` to `frontend/`.
    *   Move `supabase/` (migrations) to `infrastructure/database/`.

### Phase 3: Internal Backend Refactoring (High Risk)
*   **Goal**: Implement the internal layers (Automation, Core, Infrastructure).
*   **Actions**:
    *   Move `anti_cli/supabase` (client) to `anti_cli/infrastructure/database`.
    *   Refactor imports in all files to use absolute imports `from anti_cli...`.
    *   Create `pyproject.toml` to make `anti_cli` an installable package.

### Phase 4: Frontend & Docker Updates
*   **Goal**: Align frontend and build tools with new structure.
*   **Actions**:
    *   Update `frontend/tsconfig.json` and imports.
    *   Update `Dockerfile` and `docker-compose.yml` paths.
    *   Update `frontend` to call the new python entry points.

## 5. Detailed Migration Steps (Phase 1 & 2 Focus)

### Step 1: Python Standardization
1.  `mv python/automation/Follow python/automation/follow`
2.  Update imports in `python/automation/actions.py` (and others) from `.Follow` to `.follow`.

### Step 2: Create Directory Skeleton
1.  `mkdir -p backend/src/anti_cli`
2.  `mkdir -p backend/tests`
3.  `mkdir -p frontend`
4.  `mkdir -p infrastructure/database`

### Step 3: Move Backend Files
1.  `mv python/automation backend/src/anti_cli/`
2.  `mv python/core backend/src/anti_cli/`
3.  `mv python/supabase backend/src/anti_cli/` (Temporary location until Phase 3)
4.  `mv python/launcher.py backend/src/anti_cli/entrypoints/cli.py` (Refactor needed)
5.  `mv python/supervisor.py backend/src/anti_cli/entrypoints/`
6.  `mv python/tests/* backend/tests/`

### Step 4: Move Frontend Files
1.  `mv source/* frontend/`
2.  `mv package.json frontend/`
3.  `mv tsconfig.json frontend/`

### Step 5: Infrastructure Moves
1.  `mv supabase/migrations infrastructure/database/`
2.  `mv supabase/config.toml infrastructure/database/`

### Step 6: Fix Imports & Entry Points
*   Update `backend/src/anti_cli/entrypoints/cli.py` to use relative imports or package imports.
*   Create `backend/pyproject.toml` to define `anti_cli` package.
*   Install in editable mode: `pip install -e backend/`
