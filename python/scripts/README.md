# Scripts

This folder contains the Python entrypoints that the Node server/TUI spawns to:

- Run a full Instagram automation cycle across multiple profiles.
- Log in a single profile (including optional TOTP/2FA).

Both scripts inject the repository root into `sys.path`, so they must be run from inside this repository.

## Prerequisites

- Python 3.10+
- Dependencies installed:

  ```bash
  pip install -r python/requirements.txt
  ```

- Playwright browser installed:

  ```bash
  playwright install firefox
  ```

## Environment variables

`python/scripts/instagram_automation.py` talks to Convex over HTTP to fetch profiles/lists and update state.

Set these (usually in a root `.env`, which `python/convex/config.py` loads automatically):

```env
CONVEX_URL=https://your-project.convex.cloud
CONVEX_API_KEY=your-api-key
```

Notes:

- The Python layer converts `.convex.cloud` to `.convex.site` for HTTP Actions.
- If `CONVEX_URL` is missing, list/profile fetching becomes a no-op and automation will exit because no profiles are found.

## python/scripts/login_automation.py

Logs into Instagram for a single browser profile. This is the script used by the server route `POST /automation/login`.

### Arguments

- `--profile <name>` (required): browser profile directory name.
- `--proxy <proxy>` (optional): proxy string for the browser context.
- `--headless` (optional flag): run browser headless.

### stdin JSON (credentials)

The script reads credentials from stdin (so they don’t appear in the process list):

```json
{
  "username": "your_ig_username",
  "password": "your_ig_password",
  "two_factor_secret": "BASE32_TOTP_SECRET" 
}
```

`two_factor_secret` is optional. If omitted and Instagram requires 2FA, the script waits briefly for manual intervention.

### Output

- Regular human-readable log lines.
- On success, it prints the literal marker `__LOGIN_SUCCESS__` (the server listens for this to auto-mark the profile as logged in).

### Run manually

PowerShell:

```powershell
$creds = @{ username = "user"; password = "pass"; two_factor_secret = $null } | ConvertTo-Json
$creds | python .\python\scripts\login_automation.py --profile "MyProfile" --headless
```

Bash:

```bash
printf '{"username":"user","password":"pass","two_factor_secret":null}' \
  | python python/scripts/login_automation.py --profile "MyProfile" --headless
```

## python/scripts/instagram_automation.py

Runs an automation loop for multiple profiles in parallel. It:

- Reads a settings payload from stdin.
- Fetches profiles from Convex using `source_list_ids`.
- For each selected profile, opens a browser context and executes enabled actions in an ordered sequence.
- Enforces session limits and cooldown rules using profile state stored in Convex.

This is the script used by the server route `POST /automation/start`.

### How it is started by the server

The Node server spawns the script like:

```ts
spawn('python', ['python/scripts/instagram_automation.py'], { stdio: ['pipe','pipe','pipe'] })
```

and writes JSON to stdin:

```json
{ "settings": { /* ... */ } }
```

### stdin JSON schema

Top-level payload must be a JSON object with a `settings` object:

```json
{
  "settings": {
    "source_list_ids": ["listId1", "listId2"],
    "enable_feed": true,
    "headless": false
  }
}
```

Required behavior constraints enforced by the script:

- At least one activity flag must be enabled:
  - `enable_feed`, `enable_reels`, `watch_stories`, `enable_follow`, `do_unfollow`, `do_approve`, `do_message`
- `source_list_ids` must be a non-empty list. The script fetches profiles by these list IDs.

### Settings reference (common keys)

The script is tolerant to missing keys and applies defaults.

- Profile selection
  - `source_list_ids` (array of strings, required): list IDs used to fetch profiles from Convex.
  - `parallel_profiles` (int, default `1`): max number of profiles to run concurrently.
  - `max_sessions` (int, default `5`): per-profile max sessions per day (uses `sessions_today` from Convex profile).
  - `profile_reopen_cooldown_enabled` (bool, default `true`)
  - `profile_reopen_cooldown_minutes` (int, default `30`)

- Browser
  - `headless` (bool, default `false`)

- Action enabling
  - `enable_feed` (bool)
  - `enable_reels` (bool)
  - `watch_stories` (bool)
  - `enable_follow` (bool)
  - `do_unfollow` (bool)
  - `do_approve` (bool)
  - `do_message` (bool)

- Action order
  - `action_order` (array of strings): overrides default order.

    Valid action names:

    - `Feed Scroll`
    - `Reels Scroll`
    - `Watch Stories`
    - `Follow`
    - `Unfollow`
    - `Approve Requests`
    - `Send Messages`

    If `watch_stories` is enabled but `Watch Stories` is missing from the list, it is appended automatically.

- Feed / Reels timing
  - `feed_min_time_minutes` (int, default `1`)
  - `feed_max_time_minutes` (int, default `3`)
  - `reels_min_time_minutes` (int, default `1`)
  - `reels_max_time_minutes` (int, default `3`)

- Interaction probabilities and behavior
  - `like_chance` (int, default `10`)
  - `follow_chance` (int, default `50`)
  - `reels_like_chance` (int, default `10`)
  - `reels_follow_chance` (int, default `50`)
  - `reels_skip_chance` (int, default `30`)
  - `reels_skip_min_time` (float, default `0.8`)
  - `reels_skip_max_time` (float, default `2.0`)
  - `reels_normal_min_time` (float, default `5.0`)
  - `reels_normal_max_time` (float, default `20.0`)
  - `carousel_watch_chance` (int, default `0`)
  - `carousel_max_slides` (int, default `3`)
  - `stories_max` (int, default `3`)

- Follow (limits per session)
  - `follow_min_count` (int, default `5`)
  - `follow_max_count` (int, default `15`)
  - `highlights_min` (int, default `2`)
  - `highlights_max` (int, default `4`)
  - `likes_percentage` (int, default `0`)
  - `scroll_percentage` (int, default `0`)
  - `following_limit` (int, default `3000`)

- Unfollow (limits per session)
  - `unfollow_min_count` (int, default `5`)
  - `unfollow_max_count` (int, default `15`)
  - `min_delay` (int, default `10`)
  - `max_delay` (int, default `30`)

- Messaging
  - `messaging_cooldown_enabled` (bool, default `true`)
  - `messaging_cooldown_hours` (int, default `2`)

Message text selection:

- When `do_message=true`, the script tries to load message templates from Convex.
- If none are available, it falls back to `"Hi!"`.

### Output and events

The script prints two kinds of stdout lines:

- Plain log lines (timestamped).
- Structured events, wrapped like:

  ```text
  __EVENT__{"type":"session_started","ts":"...","total_accounts":3}__EVENT__
  ```

Event types currently emitted:

- `session_started`
- `profile_started`
- `task_started`
- `profile_completed`
- `session_ended`

### Exit codes

- `0`: completed normally
- `2`: validation error / no work to do (missing input, no enabled actions, missing list IDs, no profiles)

### Run manually

PowerShell:

```powershell
$payload = @{
  settings = @{
    source_list_ids = @("listId1")
    enable_feed = $true
    feed_min_time_minutes = 1
    feed_max_time_minutes = 2
    parallel_profiles = 1
    max_sessions = 5
    headless = $false
  }
} | ConvertTo-Json -Depth 10

$payload | python .\python\scripts\instagram_automation.py
```

Bash:

```bash
printf '%s' '{"settings":{"source_list_ids":["listId1"],"enable_feed":true,"feed_min_time_minutes":1,"feed_max_time_minutes":2,"parallel_profiles":1,"max_sessions":5,"headless":false}}' \
  | python python/scripts/instagram_automation.py
```

## Troubleshooting

- “settings должен быть объектом.”: stdin payload must be JSON with `settings` as an object.
- “Выберите список профилей!”: provide `source_list_ids`.
- “В выбранном списке нет профилей!”: Convex returned no profiles for those list IDs.
- Login succeeds but server doesn’t mark it logged in: ensure `__LOGIN_SUCCESS__` is present in stdout.
- Playwright errors on first run: ensure `playwright install firefox` has been executed.
