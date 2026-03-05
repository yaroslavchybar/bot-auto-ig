# Python Components Reference

## Getting Started Layer

- `python/getting_started/launcher.py`: primary session launcher with action/proxy/timing controls.
- `python/getting_started/run_multiple_accounts.py`: multi-account runner.
- `python/getting_started/run_workflow.py`: workflow graph executor with event emission.

## Browser Control Layer

- `python/browser_control/browser_setup.py`
- `python/browser_control/fingerprint_generator.py`
- `python/browser_control/display_manager.py`

Use this layer for browser lifecycle, anti-detection strategy, and display allocation.

## Database Sync Layer

- `python/database_sync/config.py`
- `python/database_sync/client.py`
- `python/database_sync/profiles_client.py`
- `python/database_sync/accounts_client.py`
- `python/database_sync/settings_client.py`
- `python/database_sync/messages_client.py`
- `python/database_sync/shared_session.py`

## Instagram Actions Layer

- `python/instagram_actions/browsing/*`
- `python/instagram_actions/engagement/*`
- `python/instagram_actions/stories/*`
- `python/instagram_actions/messaging/*`
- `python/instagram_actions/login/*`
- `python/instagram_actions/actions.py`

## Internal Systems Layer

Core infrastructure under `python/internal_systems/`:
- `error_handling/`
- `logging/`
- `process_management/`
- `data_models/`
- `storage/`
- `shared_utilities/`

## Verified Against

- Directory listings for `python/*`
- `python/getting_started/launcher.py`
- `python/getting_started/run_workflow.py`
- `python/database_sync/*.py`
- `python/internal_systems/*`
