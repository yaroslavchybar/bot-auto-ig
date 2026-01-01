# Complete Project Structure: Anti-CLI Instagram Automation Tool

## **Root Level Files**
```
anti/
├── .env                          # Environment variables for Supabase, proxy settings
├── .gitignore                    # Git ignore patterns for Python, Node, build artifacts
├── .dockerignore                 # Docker build ignore patterns (node_modules, data)
├── README.md                     # Comprehensive project documentation with setup guide
├── DEPLOY.md                     # Docker deployment instructions and VPS setup
├── structure.md                  # Architecture restructuring plan for clean architecture
├── package.json                  # Node.js project config with scripts and dependencies
├── package-lock.json             # NPM lock file for reproducible builds
├── tsconfig.json                 # TypeScript compiler configuration
├── Dockerfile                    # Multi-stage Docker build for production deployment
├── docker-compose.yml            # Local development Docker setup
├── .github/
│   └── workflows/
│       └── docker-publish.yml    # GitHub Actions for automated Docker publishing
├── scripts/                      # Execution scripts for automation tasks
│   ├── instagram_automation.py  # Main multi-thread automation runner
│   ├── login_automation.py      # Login automation for account authentication
│   └── __pycache__/              # Python bytecode cache directory
├── python/                       # Python backend automation engine
├── source/                       # React TUI frontend interface
├── supabase/                     # Database schema and configuration
├── data/                         # Local browser profiles and session logs
└── dist/                         # Compiled JavaScript output from TypeScript
    ├── app.js                    # Compiled TUI application entry point
    ├── app.js.map                # Source map for debugging compiled app
    ├── cli.js                    # Compiled CLI interface
    └── cli.js.map                # Source map for debugging CLI
```

## **Python Backend (`/python`)**
```
python/
├── __init__.py                   # Python package initialization file
├── requirements.txt              # Python dependencies (camoufox, playwright, etc.)
├── launcher.py                   # CLI entry point for running automation tasks
├── supervisor.py                 # Process supervisor for managing browser instances
├── data/
│   └── selector_cache.json       # Cached CSS selectors for faster element location
├── automation/                   # Core automation logic modules
│   ├── __init__.py               # Automation package initialization
│   ├── actions.py                # Action orchestrator coordinating different automation tasks
│   ├── browser.py                # Camoufox/Playwright wrapper with antidetect features
│   ├── Follow/                   # Follow automation feature module
│   │   ├── __init__.py           # Follow feature package initialization
│   │   ├── common.py             # Common utilities for follow operations
│   │   ├── controls.py           # UI controls and interaction handlers
│   │   ├── filter.py             # Profile filtering and target selection
│   │   ├── highlights.py         # Instagram highlights viewing automation
│   │   ├── interactions.py       # User interaction simulation
│   │   ├── posts.py              # Post interaction and engagement
│   │   ├── session.py            # Follow session management
│   │   └── utils.py              # Helper utilities for follow operations
│   ├── approvefollow/
│   │   └── session.py            # Follow request approval automation
│   ├── login/
│   │   └── session.py            # Instagram login automation with 2FA support
│   ├── messaging/
│   │   └── session.py            # Direct messaging automation with templates
│   ├── scrolling/
│   │   ├── __init__.py           # Scrolling feature package initialization
│   │   ├── utils.py              # Scrolling utilities and helpers
│   │   ├── feed/                 # Feed scrolling operations
│   │   │   ├── __init__.py       # Feed scrolling package initialization
│   │   │   ├── carousel.py       # Carousel/album viewing automation
│   │   │   ├── following.py       # Follow operations during feed scrolling
│   │   │   ├── likes.py           # Like interactions during feed scrolling
│   │   │   └── scroll.py          # Main feed scrolling logic
│   │   └── reels/                # Reels scrolling operations
│   │       ├── __init__.py       # Reels scrolling package initialization
│   │       ├── likes.py           # Like interactions during reels viewing
│   │       └── scroll.py          # Main reels scrolling logic
│   ├── stories/
│   │   ├── __init__.py           # Stories feature package initialization
│   │   └── stories.py            # Story viewing automation with limits
│   └── unfollow/
│       └── session.py            # Smart unfollowing strategies
├── core/                         # Domain models and infrastructure components
│   ├── __init__.py               # Core package initialization
│   ├── automation/
│   │   ├── __init__.py           # Automation core package initialization
│   │   ├── semantic_selectors.py  # Multi-strategy element locator with fallbacks
│   │   └── __pycache__/           # Compiled Python bytecode
│   ├── domain/
│   │   ├── __init__.py           # Domain package initialization
│   │   ├── config.py             # Configuration schemas and validation
│   │   ├── models.py             # Domain models and data structures
│   │   └── __pycache__/           # Compiled Python bytecode
│   ├── observability/
│   │   ├── __init__.py           # Observability package initialization
│   │   ├── logging_config.py     # Structured JSON logging setup
│   │   ├── selector_cache.py     # CSS selector caching for performance
│   │   ├── snapshot_debugger.py  # DOM snapshot debugging for failures
│   │   └── __pycache__/           # Compiled Python bytecode
│   ├── persistence/
│   │   ├── __init__.py           # Persistence package initialization
│   │   ├── profile_manager.py    # Browser profile lifecycle management
│   │   ├── state_persistence.py  # State sync between local and cloud
│   │   └── __pycache__/           # Compiled Python bytecode
│   ├── resilience/
│   │   ├── __init__.py           # Resilience package initialization
│   │   ├── config.py             # Resilience patterns configuration
│   │   ├── error_handler.py      # Centralized error handling
│   │   ├── exceptions.py         # Custom exception classes
│   │   ├── http_client.py        # Circuit breaker HTTP client
│   │   ├── retry.py              # Exponential backoff retry decorator
│   │   ├── safe_action.py        # Safe action wrapper with error handling
│   │   ├── traffic_monitor.py    # Traffic monitoring and rate limiting
│   │   └── __pycache__/           # Compiled Python bytecode
│   ├── runtime/
│   │   ├── __init__.py           # Runtime package initialization
│   │   ├── healthcheck.py        # System health checking
│   │   ├── job_object.py         # Windows job objects for process control
│   │   ├── process_manager.py    # Browser process management and cleanup
│   │   └── __pycache__/           # Compiled Python bytecode
│   └── __pycache__/               # Core package compiled bytecode
├── supabase/                     # Database client wrappers and configuration
│   ├── __init__.py               # Supabase package initialization
│   ├── client.py                 # Base Supabase client with connection management
│   ├── config.py                 # Database connection configuration
│   ├── instagram_accounts_client.py  # CRUD operations for Instagram accounts
│   ├── instagram_settings_client.py   # Settings management operations
│   ├── message_templates_client.py    # Message template CRUD operations
│   ├── profiles_client.py       # Profile management database operations
│   ├── seed.sql                  # Database seed data for initial setup
│   ├── shared_session.py         # Shared session handling for connections
│   ├── .branches/                # Git branches tracking for Supabase CLI
│   ├── .temp/                    # Temporary files for Supabase CLI
│   └── __pycache__/               # Compiled Python bytecode
└── tests/                        # Python unit test suite
    ├── __init__.py               # Test package initialization
    ├── test_error_handler.py     # Tests for error handling functionality
    ├── test_exceptions.py        # Tests for custom exception classes
    ├── test_executor_lifecycle.py # Tests for automation lifecycle management
    ├── test_healthcheck.py        # Tests for health checking system
    ├── test_http_client.py        # Tests for HTTP client with circuit breaker
    ├── test_io_optimizations.py  # Tests for I/O performance optimizations
    ├── test_job_object.py        # Tests for Windows job objects
    ├── test_process_cleanup.py   # Tests for process cleanup functionality
    ├── test_profile_caching.py   # Tests for profile caching system
    ├── test_retry.py              # Tests for retry mechanisms
    ├── test_selectors.py          # Tests for semantic selectors
    ├── test_selector_cache.py    # Tests for selector caching
    ├── test_shared_session.py    # Tests for shared session handling
    ├── test_state_persistence.py # Tests for state persistence
    ├── test_traffic_monitor.py   # Tests for traffic monitoring
    └── __pycache__/               # Compiled test bytecode
```

## **React TUI Frontend (`/source`)**
```
source/
├── app.tsx                       # Main TUI application entry point with routing
├── cli.tsx                       # CLI wrapper for command-line interface
├── components/                   # React components for TUI interface
│   ├── Login.tsx                 # Authentication component for login flow
│   ├── Logs.tsx                  # Real-time logs viewer component
│   ├── instagram/                # Instagram settings management
│   │   ├── index.tsx             # Instagram settings main component
│   │   ├── hooks/
│   │   │   └── useInstagramSettings.ts # React hook for Instagram settings state
│   │   └── Views/
│   │       ├── CooldownView.tsx  # Cooldown settings configuration view
│   │       ├── ListView.tsx      # Instagram accounts list view
│   │       ├── MainView.tsx      # Main Instagram settings view
│   │       ├── MessageView.tsx   # Message template management view
│   │       ├── OrderView.tsx     # Order/sequence configuration view
│   │       └── SubSettingsView.tsx # Sub-settings configuration view
│   ├── lists/                    # Target list management
│   │   ├── index.tsx             # Lists management main component
│   │   ├── hooks/
│   │   │   └── useLists.ts       # React hook for list management state
│   │   └── Views/
│   │       ├── CreateView.tsx    # Create new list view
│   │       ├── DeleteView.tsx    # Delete list confirmation view
│   │       ├── EditView.tsx      # Edit existing list view
│   │       └── ListView.tsx      # Lists overview view
│   ├── profiles/                 # Browser profile management
│   │   ├── index.tsx             # Profile management main component
│   │   ├── hooks/
│   │   │   └── useProfiles.ts    # React hook for profile management state
│   │   └── Views/
│   │       ├── FormView.tsx      # Profile creation/editing form
│   │       ├── ListView.tsx      # Profiles list view
│   │       └── MiscViews.tsx     # Miscellaneous profile operations
│   └── ui/                       # Reusable UI components
│       ├── Checkbox.tsx          # Custom checkbox component for TUI
│       ├── NumberInput.tsx       # Number input component with validation
│       └── Row.tsx                # Layout row component for consistent spacing
├── lib/                          # Business logic and services
│   ├── automationService.ts      # Main automation orchestration service
│   ├── instagramSettings.ts      # Instagram settings management service
│   ├── listsService.ts           # List CRUD operations service
│   ├── logStore.ts               # Log storage and retrieval service
│   ├── manualAutomationService.ts # Manual automation trigger service
│   ├── messagesService.ts        # Message template management service
│   ├── profiles.ts               # Profile operations service
│   ├── shutdown.ts               # Graceful shutdown handling
│   ├── supabase.ts               # Supabase client configuration
│   ├── user_agents.ts            # User agent generation and management
│   ├── utils.ts                  # Utility functions and helpers
│   └── validation/
│       └── settingsSchema.ts      # Settings validation schemas
├── tests/                        # Frontend unit tests
│   ├── automationService.test.ts # Tests for automation service
│   ├── edgeCases.test.ts         # Edge case testing
│   ├── listsService.test.ts      # Tests for list service
│   ├── logStore.test.ts          # Tests for log storage
│   ├── messagesService.test.ts   # Tests for message service
│   ├── profilesTotp.test.ts      # Tests for profile TOTP functionality
│   ├── shutdown.test.ts          # Tests for shutdown handling
│   ├── useLists.test.ts          # Tests for lists hook
│   ├── userAgents.test.ts        # Tests for user agent generation
│   ├── utils.test.ts             # Tests for utility functions
│   └── validation.test.ts        # Tests for validation schemas
└── types/                        # TypeScript type definitions
    └── index.ts                  # Shared type definitions for frontend
```

## **Database (`/supabase`)**
```
supabase/
├── .gitignore                    # Git ignore (72 bytes)
├── config.toml                   # Supabase configuration (14KB)
├── .branches/
│   └── _current_branch           # Current branch tracking
├── .temp/                        # Temporary files
│   ├── cli-latest
│   ├── gotrue-version
│   ├── pooler-url
│   ├── postgres-version
│   ├── project-ref
│   ├── rest-version
│   ├── storage-migration
│   └── storage-version
└── migrations/
    └── 202512210001_initial_schema.sql  # Database schema (177 lines)
```

## **Data Storage (`/data`)**
```
data/
├── selector_cache.json           # CSS selector cache
├── logs/                         # Session logs
│   ├── session-2025-12-29T20-33-25-576Z.log
│   ├── session-2025-12-29T20-33-25-599Z.log
│   └── [multiple session logs...]
└── profiles/                     # Browser profiles
    └── nastya.rainy_/            # Firefox profile data
        ├── .cache2_last_cleaned
        ├── activity-stream.weather_feed.json
        ├── addonStartup.json.lz4
        ├── AlternateServices.bin
        ├── bounce-tracking-protection.sqlite
        ├── broadcast-listeners.json
        ├── cert9.db
        ├── compatibility.ini
        ├── containers.json
        ├── content-prefs.sqlite
        ├── cookies.sqlite
        ├── cookies.sqlite-shm
        ├── cookies.sqlite-wal
        ├── domain_to_categories.sqlite
        ├── extension-preferences.json
        ├── extension-settings.json
        ├── extensions.json
        ├── favicons.sqlite
        ├── favicons.sqlite-shm
        ├── favicons.sqlite-wal
        ├── handlers.json
        ├── key4.db
        ├── parent.lock
        ├── permissions.sqlite
        ├── pkcs11.txt
        ├── places.sqlite
        ├── places.sqlite-shm
        ├── places.sqlite-wal
        ├── prefs.js
        ├── protections.sqlite
        ├── serviceworker.txt
        ├── sessionCheckpoints.json
        ├── SiteSecurityServiceState.bin
        ├── storage.sqlite
        ├── Telemetry.ShutdownTime.txt
        ├── times.json
        ├── webappsstore.sqlite
        ├── webappsstore.sqlite-shm
        ├── webappsstore.sqlite-wal
        ├── xulstore.json
        ├── cache2/                 # Browser cache
        │   ├── doomed/
        │   └── entries/
        ├── datareporting/         # Telemetry data
        │   └── glean/
        ├── extension-store/       # Extension storage
        ├── extension-store-menus/
        ├── safebrowsing/          # Safe browsing data
        ├── security_state/        # Security state
        ├── sessionstore-backups/  # Session backups
        ├── startupCache/          # Startup cache
        └── storage/               # Local storage
            └── default/
                ├── https+++www.facebook.com/
                └── https+++www.instagram.com/
                    ├── cache/
                    │   └── morgue/
                    └── idb/
```

## **Build & Cache Directories**
```
├── .pytest_cache/                # Pytest cache
│   ├── .gitignore
│   ├── CACHEDIR.TAG
│   ├── README.md
│   └── v/cache/
└── node_modules/                  # NPM dependencies (gitignored)
```

## **Key File Sizes & Complexity**
- **Largest Files**: `python/automation/browser.py` (17.9KB), `package-lock.json` (53KB)
- **Most Complex**: Python automation modules with comprehensive error handling
- **Test Coverage**: 16 Python tests + 11 TypeScript tests
- **Configuration**: Multiple config files for different environments
- **Data Storage**: Active Firefox profile with complete browser state

## **Architecture Summary**

### **Technology Stack**
- **Backend**: Python 3.10+ with Camoufox/Playwright
- **Frontend**: Node.js 16+ with React + Ink (TUI)
- **Database**: Supabase (PostgreSQL) with pg_cron
- **Containerization**: Docker + Docker Compose

### **Key Features**
- **Antidetect**: Fingerprint spoofing, proxy support, GeoIP validation
- **Automation**: Human-like behavior, smart browsing, account management
- **Power Management**: Multi-threading, scheduling, memory management
- **Observability**: Structured logging, snapshot debugging, health checks

### **Code Quality**
- **Clean Architecture**: Well-separated concerns between layers
- **Type Safety**: Full TypeScript implementation
- **Resilience Patterns**: Circuit breakers, retry logic, error handling
- **Testing**: Comprehensive unit test coverage
- **Documentation**: Detailed README and structure documentation

This structure shows a well-organized, production-ready automation tool with clear separation of concerns between the Python automation engine, React TUI interface, and Supabase backend.