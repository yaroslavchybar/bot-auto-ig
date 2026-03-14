import logging
import json
from datetime import datetime, timezone
import os
from logging.handlers import RotatingFileHandler

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
DEFAULT_LOG_FILE = os.path.join(_PROJECT_ROOT, "data", "logs", "bot.log")

_setup_done = False


class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_obj = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno
        }

        # Include any extra fields passed via logger.info(..., extra={...})
        if hasattr(record, '__dict__'):
            for key, value in record.__dict__.items():
                if key not in ('name', 'msg', 'args', 'created', 'filename',
                              'funcName', 'levelname', 'levelno', 'lineno',
                              'module', 'msecs', 'pathname', 'process',
                              'processName', 'relativeCreated', 'stack_info',
                              'exc_info', 'exc_text', 'thread', 'threadName',
                              'message', 'taskName'):
                    log_obj[key] = value

        return json.dumps(log_obj)


def setup_logging(log_file: str = DEFAULT_LOG_FILE):
    global _setup_done
    if _setup_done:
        return
    _setup_done = True

    # Ensure logs directory exists
    log_dir = os.path.dirname(log_file)
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)

    handler = RotatingFileHandler(
        log_file,
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    handler.setFormatter(JsonFormatter())

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))

    # Configure root logger
    logging.root.setLevel(logging.INFO)
    logging.root.addHandler(handler)
    logging.root.addHandler(console_handler)

    # Quiet down some noisy libraries
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("playwright").setLevel(logging.WARNING)
