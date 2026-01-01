import json
import os
import threading
import time
from pathlib import Path
from unittest.mock import patch
import pytest
from python.core.persistence.state_persistence import save_state, load_state, clear_state, STATE_FILE

@pytest.fixture
def clean_state_file():
    # Cleanup before test
    if STATE_FILE.exists():
        STATE_FILE.unlink()
    if STATE_FILE.parent.exists():
        for f in STATE_FILE.parent.glob("*.tmp"):
            f.unlink()
    yield
    # Cleanup after test
    if STATE_FILE.exists():
        STATE_FILE.unlink()

def test_save_and_load_state(clean_state_file):
    profile = "test_profile"
    action = "scrolling"
    progress = 50
    
    save_state(profile, action, progress)
    
    loaded = load_state()
    assert loaded is not None
    assert loaded["profile"] == profile
    assert loaded["action"] == action
    assert loaded["progress"] == progress
    assert "timestamp" in loaded

def test_clear_state(clean_state_file):
    save_state("p", "a", 10)
    assert STATE_FILE.exists()
    
    clear_state()
    assert not STATE_FILE.exists()
    assert load_state() is None

def test_atomic_write_structure(clean_state_file):
    # This test verifies that we are indeed creating a temp file and moving it
    # We can't easily race it, but we can mock os.replace to fail and see if temp file remains (or is cleaned up)
    # Actually, the code cleans up temp file if replace fails?
    # Let's check implementation:
    # except Exception:
    #     if os.path.exists(tmp_path): ...
    
    with patch("os.replace", side_effect=OSError("Simulated failure")):
        try:
            save_state("p", "a", 10)
        except OSError:
            pass
            
    # Ensure no temp files are left over if we handle cleanup correctly
    # The current implementation catches Exception and cleans up
    temp_files = list(STATE_FILE.parent.glob("*.tmp"))
    assert len(temp_files) == 0

def test_concurrent_writes(clean_state_file):
    # Stress test with threads
    errors = []
    def writer(idx):
        try:
            for i in range(10):
                save_state(f"profile_{idx}", "action", i)
                time.sleep(0.01)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
        
    assert not errors, f"Errors occurred: {errors}"
    
    # Final state should be valid JSON
    final_state = load_state()
    assert final_state is not None
    assert isinstance(final_state, dict)
