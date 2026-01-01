import json
import tempfile
import os
import time
from typing import Any, Union
from pathlib import Path

def atomic_write_json(file_path: Union[str, Path], data: Any, max_retries: int = 5):
    """
    Atomically write data to a JSON file.
    
    Uses a temporary file and os.replace to ensure atomicity.
    Includes retry logic for Windows filesystem locking issues.
    """
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    
    # Create temp file in the same directory to ensure atomic move works
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        
        # atomic replace with retries for Windows
        for i in range(max_retries):
            try:
                os.replace(tmp_path, path)
                break
            except OSError:
                if i == max_retries - 1:
                    raise
                time.sleep(0.05)
                
    except Exception:
        # cleanup if something failed
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise
