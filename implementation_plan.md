# Performance Improvements Implementation Plan

A detailed plan to implement 9 performance optimizations for the Anti-CLI Instagram automation project.

---

## Phase 1: Connection & Query Infrastructure

### 1.1 Create Shared Session Module

#### [NEW] [shared_session.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/shared_session.py)

Create a singleton HTTP session with proper connection pooling:

```python
"""Shared HTTP session for all Supabase clients."""
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from threading import Lock

_session = None
_lock = Lock()

def get_shared_session() -> requests.Session:
    global _session
    if _session is None:
        with _lock:
            if _session is None:
                _session = requests.Session()
                retries = Retry(
                    total=3,
                    backoff_factor=1.5,
                    status_forcelist=[429, 500, 502, 503, 504],
                    allowed_methods=["GET", "POST", "PATCH", "DELETE"],
                )
                adapter = HTTPAdapter(
                    max_retries=retries,
                    pool_connections=20,
                    pool_maxsize=20,
                )
                _session.mount("https://", adapter)
                _session.mount("http://", adapter)
    return _session
```

---

### 1.2 Refactor Supabase Clients

#### [MODIFY] [profiles_client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py)

- Remove per-instance session creation in [__init__](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py#14-38)
- Import and use `get_shared_session()`

```diff
+from .shared_session import get_shared_session

 class SupabaseProfilesClient:
     def __init__(self):
-        self.session = requests.Session()
-        retries = Retry(...)
-        adapter = HTTPAdapter(max_retries=retries)
-        self.session.mount("https://", adapter)
+        self.session = get_shared_session()
         self.timeout = (10, 60)
```

#### [MODIFY] [instagram_accounts_client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/instagram_accounts_client.py)

Same pattern - use shared session instead of creating new `requests.Session()`.

---

### 1.3 Batch Profile Fetching

#### [MODIFY] [instagram_automation.py](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py)

Replace sequential loop with batch query:

```diff
 def _fetch_profiles_for_lists(list_ids: List[str]) -> List[Dict[str, Any]]:
-    result: List[Dict[str, Any]] = []
-    try:
-        for lid in list_ids:
-            r = requests.get(
-                f"{PROJECT_URL}/rest/v1/profiles",
-                params={
-                    "select": "profile_id,name,proxy,user_agent,list_id,created_at",
-                    "list_id": f"eq.{lid}",
-                    "order": "created_at.asc",
-                },
+    if not list_ids:
+        return []
+    try:
+        # Single batch query using IN filter
+        list_filter = ",".join(list_ids)
+        r = requests.get(
+            f"{PROJECT_URL}/rest/v1/profiles",
+            params={
+                "select": "profile_id,name,proxy,user_agent,list_id,created_at",
+                "list_id": f"in.({list_filter})",
+                "order": "created_at.asc",
+            },
+            headers={...},
+            timeout=30,
+        )
+        data = r.json() if r.status_code < 400 else []
```

---

## Phase 2: Caching Layer

### 2.1 Profile Data Caching

#### [MODIFY] [instagram_automation.py](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py)

Add profile cache to [InstagramAutomationRunner](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py#137-531):

```diff
 class InstagramAutomationRunner:
     def __init__(self, config: ScrollingConfig, accounts: List[ThreadsAccount]):
         self.config = config
         self.accounts = accounts
         self.running = True
         self.accounts_client = InstagramAccountsClient()
         self.profiles_client = SupabaseProfilesClient()
+        self._profile_cache: Dict[str, Dict] = {}  # Cache profile data by name
```

Then modify [process_account](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py#195-332) to cache and pass profile data:

```python
def process_account(self, account: ThreadsAccount) -> bool:
    profile_name = account.username
    
    # Check cache first
    profile_data = self._profile_cache.get(profile_name)
    if not profile_data:
        profile_data = self.profiles_client.get_profile_by_name(profile_name)
        if profile_data:
            self._profile_cache[profile_name] = profile_data
    
    # Pass cached data to action methods
    self._run_follow(page, account, profile_data)  # etc.
```

---

### 2.2 Eliminate Redundant Eligibility Checks

Cache eligible message targets from the pre-launch check and pass to [_run_message_only()](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py#481-531):

```diff
 def process_account(self, account: ThreadsAccount) -> bool:
+    eligible_message_targets = None  # Cache from early check
     
     # In the early check block (lines 238-269):
     if only_messages:
         ...
         eligible = [...]  # existing eligibility logic
+        eligible_message_targets = eligible  # Store for later use
         if not eligible:
             log(f"@{profile_name}: все цели недавно получили сообщение")
             return False
     
     # Later, pass to action method:
-    "Send Messages": lambda: self._run_message_only(page, account),
+    "Send Messages": lambda: self._run_message_only(page, account, eligible_message_targets),
```

Update [_run_message_only](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py#481-531) signature:

```diff
-def _run_message_only(self, page, account: ThreadsAccount) -> None:
+def _run_message_only(self, page, account: ThreadsAccount, cached_targets: Optional[List] = None) -> None:
+    if cached_targets is not None:
+        eligible = cached_targets  # Use cached targets
+    else:
+        # Fallback to fetching (original logic)
```

---

### 2.3 SQL-Level Cooldown Filtering

#### [MODIFY] [profiles_client.py](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py)

Add new method for filtered profile fetching:

```python
def get_available_profiles(
    self, 
    list_ids: List[str],
    max_sessions: int,
    cooldown_minutes: int
) -> List[Dict]:
    """Fetch profiles that are not on cooldown and under session limit."""
    list_filter = ",".join(list_ids)
    params = {
        "select": "profile_id,name,proxy,user_agent,list_id,sessions_today,last_opened_at",
        "list_id": f"in.({list_filter})",
        "sessions_today": f"lt.{max_sessions}",
        "or": f"(last_opened_at.is.null,last_opened_at.lt.{cooldown_cutoff_iso})",
        "order": "created_at.asc",
    }
    return self._make_request("GET", params=params) or []
```

---

## Phase 3: Async & Parallel Optimizations

### 3.1 TUI Promise.all() Optimization

#### [MODIFY] [supabase.ts](file:///c:/Users/yaros/Downloads/anti/source/lib/supabase.ts)

No changes needed to this file directly, but components using multiple queries should be updated.

#### [MODIFY] Components that call multiple Supabase functions

Example pattern for any component fetching profiles and lists:

```typescript
// Before (sequential):
const profiles = await profilesList();
const lists = await listsList();

// After (parallel):
const [profiles, lists] = await Promise.all([
  profilesList(),
  listsList(),
]);
```

---

### 3.2 ThreadPoolExecutor Lifecycle

#### [MODIFY] [instagram_automation.py](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py)

Create executor once in [__init__](file:///c:/Users/yaros/Downloads/anti/python/supabase/profiles_client.py#14-38) instead of per-cycle:

```diff
 class InstagramAutomationRunner:
     def __init__(self, config: ScrollingConfig, accounts: List[ThreadsAccount]):
         ...
+        configured = int(getattr(self.config, "parallel_profiles", 1) or 1)
+        self._max_workers = max(1, min(len(accounts), configured))
+        self._executor = ThreadPoolExecutor(max_workers=self._max_workers)

     def run(self) -> int:
         while self.running:
-            with ThreadPoolExecutor(max_workers=max_workers) as executor:
-                ...
+            futures = [self._executor.submit(self.process_account, acc) for acc in self.accounts]
+            ...
+        
+        self._executor.shutdown(wait=True)
```

---

## Phase 4: I/O & Background Processing

### 4.1 Buffered Logging

#### [MODIFY] [instagram_automation.py](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py)

Replace custom [log()](file:///c:/Users/yaros/Downloads/anti/scripts/instagram_automation.py#62-76) with Python's logging module:

```python
import logging
from logging.handlers import MemoryHandler

# Configure at startup
_log_handler = logging.StreamHandler(sys.stdout)
_memory_handler = MemoryHandler(
    capacity=10,  # Buffer 10 messages before flushing
    flushLevel=logging.ERROR,  # Immediately flush on errors
    target=_log_handler,
)

logger = logging.getLogger("instagram_automation")
logger.addHandler(_memory_handler)
logger.setLevel(logging.INFO)

def log(message: str) -> None:
    logger.info(f"[{_now_iso()}] {message}")
```

---

### 4.2 Background Cache Cleanup

#### [MODIFY] [browser.py](file:///c:/Users/yaros/Downloads/anti/python/automation/browser.py)

Run cache cleanup in a background thread:

```diff
+from threading import Thread

 @contextmanager
 def create_browser_context(...):
     profile_path = ensure_profile_path(profile_name, base_dir=base_dir)
-    if _should_clean_today(profile_path):
-        _clean_cache2(profile_path)
+    # Run cache cleanup in background (non-blocking)
+    if _should_clean_today(profile_path):
+        Thread(target=_clean_cache2, args=(profile_path,), daemon=True).start()
     ...
```

---

## Verification Plan

### Automated Tests

The project has existing tests in `source/tests/`. Run them after changes:

```bash
npm test
```

This runs all TypeScript tests via Node.js built-in test runner.

### Manual Verification

After implementing each phase, verify:

1. **Phase 1** (Connection Pooling):
   - Run `npm start` → Navigate to Profiles tab
   - Create/edit/delete a profile
   - Check no errors in console

2. **Phase 2** (Caching):
   - Start automation with 2+ profiles
   - Monitor logs for reduced "Fetching profile..." messages
   - Verify all actions complete successfully

3. **Phase 3** (Async/Parallel):
   - Open TUI and measure initial load time (should be faster)
   - Run automation with `parallel_profiles > 1`
   - Verify profiles process concurrently

4. **Phase 4** (I/O):
   - Start automation and observe log output
   - Verify logs still appear (with slight buffering delay)
   - Check browser starts quickly (cache cleanup non-blocking)

### Performance Metrics (Optional)

Add timing to measure improvements:

```python
import time
start = time.perf_counter()
# ... operation ...
elapsed = time.perf_counter() - start
log(f"Operation took {elapsed:.2f}s")
```

---

## Files Changed Summary

| Phase | File | Change Type |
|-------|------|-------------|
| 1 | `python/supabase/shared_session.py` | NEW |
| 1 | `python/supabase/profiles_client.py` | MODIFY |
| 1 | `python/supabase/instagram_accounts_client.py` | MODIFY |
| 1 | `scripts/instagram_automation.py` | MODIFY |
| 2 | `scripts/instagram_automation.py` | MODIFY |
| 2 | `python/supabase/profiles_client.py` | MODIFY |
| 3 | TUI components using multiple Supabase calls | MODIFY |
| 3 | `scripts/instagram_automation.py` | MODIFY |
| 4 | `scripts/instagram_automation.py` | MODIFY |
| 4 | `python/automation/browser.py` | MODIFY |

---

## Implementation Order

1. **Start with Phase 1** - Low risk, foundational changes
2. **Phase 2** - Builds on Phase 1 infrastructure
3. **Phase 3** - Independent of other phases
4. **Phase 4** - Final polish, can be done last

> [!IMPORTANT]
> Run `npm test` after each phase to catch regressions early.
