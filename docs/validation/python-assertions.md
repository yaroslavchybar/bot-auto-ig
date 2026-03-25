# Python Refactoring – Validation Assertions

> Scope: `python/` directory (163 files, ~18,710 lines as of baseline).
> Pre-existing test failure: 1 (to be ignored throughout).

---

## VAL-PY-001 — No `print()` Calls in Production Code

**Title:** All `print()` statements replaced with `logging` module calls

**Description:**
Every `print()` call in non-test Python source files under `python/` must be replaced with an equivalent call through the `logging` module (e.g., `logger.info()`, `logger.warning()`, `logger.error()`). The baseline has 76 `print()` calls, predominantly in `browser/runtime.py` (28 calls) and scattered across runner entry points.

**Pass condition:**
A recursive scan of `python/**/*.py` (excluding `python/tests/`) finds **zero** lines matching the regex `\bprint\s*\(` outside of comments and string literals.

**Fail condition:**
Any `print()` call remains in production source.

**Evidence:**
- Output of: `rg -n "print\(" --type py python/ --glob "!python/tests/**"` returns no matches.
- Alternatively, AST-based scan confirming zero `ast.Call` nodes targeting `print`.

---

## VAL-PY-002 — No Russian / Cyrillic in Log Messages or UI Strings

**Title:** All Cyrillic text translated to English

**Description:**
The baseline contains ~285 lines with Cyrillic characters across log messages, error strings, status outputs, and level-detection heuristics (e.g., `ошибка`, `внимание`). All human-readable strings emitted at runtime (log messages, error descriptions, status strings, and string-matching conditions) must use English.

**Pass condition:**
A recursive scan of `python/**/*.py` (excluding `python/tests/`) finds **zero** lines containing characters in the Unicode range `[а-яА-ЯёЁ]` outside of comments. One narrow exception: Cyrillic may appear inside raw data fixtures or test files, but **not** in any string that is logged, raised, or emitted.

**Fail condition:**
Any Cyrillic character remains in a log message, exception message, status string, or level-detection heuristic.

**Evidence:**
- Output of: `rg -n "[а-яА-ЯёЁ]" --type py python/ --glob "!python/tests/**"` returns no matches (or only matches in inline comments with explicit justification).

---

## VAL-PY-003 — Unified Logging Configuration

**Title:** Single logging configuration entry point; no competing channels

**Description:**
The baseline has 3 competing logging channels: (1) `core/logging.py` with `setup_logging()` and `JsonFormatter`, (2) a standalone `_logger = logging.getLogger('workflow_runner')` channel in `runners/workflow/io.py`, and (3) a standalone `_logger = logging.getLogger('instagram_automation')` channel in `runners/run_multiple_accounts.py`. After refactoring, all modules must obtain their logger via `logging.getLogger(__name__)` and the sole logging configuration must live in `core/logging.py` (or a single, clearly designated module). No module should create its own handlers or formatters inline.

**Pass condition:**
1. All `getLogger()` calls in production code use `__name__` (no hardcoded logger name strings like `'workflow_runner'` or `'instagram_automation'`).
2. Only `core/logging.py` (or its replacement) attaches handlers to the root logger or configures formatters.
3. `setup_logging()` (or equivalent) is called exactly once per process entry point (runners).

**Fail condition:**
Any production module creates its own `StreamHandler`, `FileHandler`, or `Formatter` outside the central logging module, or uses a hardcoded logger name.

**Evidence:**
- `rg "getLogger\(" --type py python/ --glob "!python/tests/**"` shows only `__name__` arguments (plus the root-logger silencing in setup).
- `rg "StreamHandler\|FileHandler\|Formatter" --type py python/ --glob "!python/tests/**"` matches only inside `core/logging.py`.

---

## VAL-PY-004 — Sentry SDK Initialized and Capturing Errors

**Title:** Sentry SDK integrated and active for error capture

**Description:**
The baseline has zero Sentry references. After refactoring, `sentry_sdk` must be initialized during startup with a DSN sourced from environment variables (never hardcoded). The integration must capture unhandled exceptions and any `logger.error()` / `logger.exception()` calls.

**Pass condition:**
1. `sentry_sdk.init(dsn=...)` is called in the application startup path (e.g., inside `core/logging.py` or a dedicated `core/sentry.py`).
2. The DSN is read from `os.environ` (e.g., `SENTRY_DSN`) — never a literal string.
3. `sentry_sdk` appears in `requirements.txt` or equivalent dependency file.
4. At least one integration (e.g., `LoggingIntegration`) is configured.

**Fail condition:**
- `sentry_sdk` is not imported or initialized in any startup path.
- DSN is hardcoded.
- The package is missing from dependency declarations.

**Evidence:**
- `rg "sentry_sdk" --type py python/` shows `init()` call with env-var DSN.
- `rg "SENTRY_DSN" python/` confirms environment variable usage.
- Dependency file includes `sentry-sdk`.

---

## VAL-PY-005 — Sentry Flush-on-Exit Pattern

**Title:** Sentry events flushed before process termination

**Description:**
Sentry's transport is asynchronous; without an explicit flush, events captured near process exit may be lost. Every runner entry point that calls `sentry_sdk.init()` (directly or transitively) must call `sentry_sdk.flush(timeout=...)` in a `finally` block or `atexit` handler before the process terminates.

**Pass condition:**
1. `sentry_sdk.flush()` (or `sentry_sdk.get_client().flush()`) is called in every runner's exit path — either via `atexit.register`, a `try/finally` in `main()`, or a context manager.
2. A non-zero `timeout` argument is supplied (≥ 2 seconds recommended).

**Fail condition:**
Any runner entry point (e.g., `run_workflow.py`, `run_multiple_accounts.py`, `launcher.py`) exits without flushing Sentry.

**Evidence:**
- `rg "sentry_sdk.flush\|sentry.*flush" --type py python/runners/` shows flush calls in each entry point.
- Code review confirms the flush is in a `finally` or `atexit` path that cannot be skipped.

---

## VAL-PY-006 — All Files Under 800 Lines

**Title:** No Python source file exceeds 800 lines

**Description:**
The baseline has files exceeding this threshold: `runners/workflow/scrape_relationships.py` (878 lines), `tests/test_workflow_scrape_relationships.py` (1,428 lines), `tests/test_runner_regressions.py` (848 lines). After refactoring, every `.py` file under `python/` must be at most 800 lines (including blanks and comments). Test files are included in this constraint.

**Pass condition:**
No `.py` file under `python/` has more than 800 lines (counted by `wc -l` or equivalent).

**Fail condition:**
Any file exceeds 800 lines.

**Evidence:**
- Script output listing all files with line counts; none exceeds 800.
- Example check: `find python -name "*.py" -exec wc -l {} + | awk '$1 > 800'` returns empty.

---

## VAL-PY-007 — All Functions Under 80 Lines

**Title:** No function or method body exceeds 80 lines

**Description:**
The baseline has 8 functions exceeding 60 lines (largest: 74 lines in `filter.py::get_following_count`). After refactoring, every `def` and `async def` body must span at most 80 lines (from `def` line to last line of the body, inclusive). Decorators are excluded from the count.

**Pass condition:**
An AST-based scan of every `.py` file under `python/` reports **zero** functions where `(end_lineno - lineno + 1) > 80`.

**Fail condition:**
Any function or method body exceeds 80 lines.

**Evidence:**
- AST scan script output listing all functions with their line counts; max ≤ 80.
- Script: parse each file with `ast.parse`, walk for `FunctionDef`/`AsyncFunctionDef`, compute `node.end_lineno - node.lineno + 1`.

---

## VAL-PY-008 — Compat God-Object Eliminated

**Title:** `compat` module-proxy pattern replaced with explicit imports

**Description:**
The baseline uses a `compat()` function in three locations (`browser/compat.py`, `runners/workflow/compat.py`, `runners/multi_account/compat.py`) that returns an entire module as a god-object — callers then access arbitrary attributes (e.g., `compat.log(...)`, `compat.Camoufox(...)`, `compat.emit_event(...)`). This pattern defeats static analysis, hides dependencies, and creates implicit coupling. After refactoring, these compat modules must be removed and all call sites must use direct, explicit imports from the actual source modules.

**Pass condition:**
1. Files `browser/compat.py`, `runners/workflow/compat.py`, and `runners/multi_account/compat.py` are deleted or contain only backward-compatible re-exports (no dynamic `importlib` module-return pattern).
2. `rg "compat\(\)" --type py python/ --glob "!python/tests/**"` returns no matches.
3. `rg "compat\.log\|compat\.Camoufox\|compat\.emit_event" --type py python/` returns no matches.

**Fail condition:**
Any production module still calls `compat()` to obtain a module proxy, or accesses attributes on the returned module object.

**Evidence:**
- The three `compat.py` files are deleted (or emptied to stubs).
- Grep confirms zero `compat()` invocations and zero `compat.<attr>` attribute accesses.

---

## VAL-PY-009 — All 221 Tests Still Pass

**Title:** Full test suite green (221 pass, 1 pre-existing xfail/skip)

**Description:**
The refactoring must not introduce any test regressions. The baseline has 221 passing tests and 1 pre-existing failure (to be ignored). After refactoring, the same 221 tests must pass.

**Pass condition:**
`python -m pytest python/tests -q` reports ≥ 221 passed, 0 new failures. The 1 pre-existing failure may appear as failed/xfail/skipped but must not increase.

**Fail condition:**
Any previously-passing test now fails, or the total pass count drops below 221.

**Evidence:**
- Full pytest output showing pass/fail counts.
- Comparison with baseline: 221 passed, ≤ 1 failed (same pre-existing one).

---

## VAL-PY-010 — Modern Playwright Locator Patterns

**Title:** Legacy `query_selector` / `query_selector_all` replaced with locator API

**Description:**
The baseline uses ~30+ calls to `page.query_selector()`, `page.query_selector_all()`, and `element.query_selector()` — these are Playwright's deprecated ElementHandle-based API. After refactoring, all element interactions must use the modern locator API: `page.locator()`, `page.get_by_role()`, `page.get_by_text()`, `page.get_by_label()`, or `locator.filter()`. The `.click()` calls must originate from `Locator` objects, not `ElementHandle` objects.

**Pass condition:**
`rg "query_selector\b|query_selector_all\b" --type py python/ --glob "!python/tests/**"` returns **zero** matches.

**Fail condition:**
Any production code still uses `query_selector` or `query_selector_all`.

**Evidence:**
- Grep output confirming zero matches for the legacy API.
- Spot-check of refactored files (e.g., `actions/stories/session.py`, `actions/messaging/ui.py`) shows locator-based equivalents.

---

## VAL-PY-011 — AsyncCamoufox Context Manager Usage

**Title:** Camoufox browser launch uses `async with AsyncCamoufox(...)` pattern

**Description:**
The baseline in `browser/context.py` manually enters a Camoufox context (`cm = compat.Camoufox(geoip=True, **launch_kwargs)`) via the compat god-object. After refactoring, browser context creation must use the modern `AsyncCamoufox` async context manager pattern: `async with AsyncCamoufox(...) as browser:`. This ensures proper cleanup on errors and aligns with the library's documented API.

**Pass condition:**
1. `from camoufox import AsyncCamoufox` (or `from camoufox.async_api import AsyncCamoufox`) appears in `browser/context.py` or its replacement.
2. All Camoufox instantiation uses `async with AsyncCamoufox(...)` — no manual `__enter__`/`__exit__` calls.
3. `rg "compat\.Camoufox\|compat()\.Camoufox" --type py python/` returns zero matches.

**Fail condition:**
Camoufox is still instantiated via the compat proxy or via synchronous / manual context entry.

**Evidence:**
- Code review of `browser/context.py` (or replacement) showing `async with AsyncCamoufox(...)`.
- Grep confirms no `compat.Camoufox` references remain.

---

## VAL-PY-012 — Clean Module Organization (DDD Grouping)

**Title:** Module structure follows domain-driven grouping with no circular imports

**Description:**
After refactoring, the `python/` directory must maintain clear domain boundaries:
- `actions/` — Instagram domain actions only (no infra, no DB clients)
- `browser/` — browser lifecycle only (launch, context, cookies, fingerprints)
- `database/` — Convex client adapters only
- `core/` — cross-cutting infrastructure (logging, config, errors, process management, selectors, storage)
- `runners/` — entry points and orchestration only

No circular imports may exist. No module outside `runners/` should import from `runners/`. No module in `actions/` should directly import from `database/` (use dependency injection or pass clients).

**Pass condition:**
1. `python -c "import python"` (or each subpackage) succeeds with no `ImportError` or `CircularImportError`.
2. `rg "from python\.runners" --type py python/actions/ python/browser/ python/core/ python/database/` returns zero matches.
3. Spot-check: `actions/` files do not import from `database/` directly (confirmed by grep).

**Fail condition:**
- Circular import detected at import time.
- Cross-boundary imports violate the DDD grouping rules above.

**Evidence:**
- Import smoke test passes.
- Grep-based boundary checks return no violations.
- Optional: dependency graph tool (e.g., `pydeps` or `import-linter`) confirms no cycles.
