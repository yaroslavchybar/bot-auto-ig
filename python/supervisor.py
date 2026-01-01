import subprocess
import sys
import time
import logging
from python.core.config import config
from python.core.logging_config import setup_logging

setup_logging()
logger = logging.getLogger("Supervisor")

def run_with_supervision(args):
    """Run launcher.py with restart logic."""
    cmd = [sys.executable, "python/launcher.py"] + args
    
    for retry in range(config.MAX_RETRIES):
        try:
            logger.info(f"Starting session (Attempt {retry + 1}/{config.MAX_RETRIES})...")
            
            result = subprocess.run(cmd)
            
            if result.returncode == 0:
                logger.info("Session completed successfully.")
                return 0
                
            logger.warning(f"Session crashed with exit code {result.returncode}")
            
        except KeyboardInterrupt:
            logger.info("Supervisor stopped by user.")
            return 0
        except Exception as e:
            logger.error(f"Supervisor error: {e}")
            
        # Backoff before restart
        if retry < config.MAX_RETRIES - 1:
            delay = config.BACKOFF_BASE * (2 ** retry)
            logger.info(f"Restarting in {delay} seconds...")
            time.sleep(delay)
            
    logger.error("Max retries exceeded. Giving up.")
    return 1

if __name__ == "__main__":
    # Pass all arguments to launcher.py
    sys.exit(run_with_supervision(sys.argv[1:]))
