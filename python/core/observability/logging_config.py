import logging
import json
from datetime import datetime
import os
from logging.handlers import RotatingFileHandler

class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_obj = {
            "timestamp": datetime.utcnow().isoformat(),
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

def setup_logging(log_file: str = "logs/bot.log"):
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
    
    # Also log to console for development visibility, but maybe in simpler format or just keep it file-based
    # For this task, we prioritize file logging as per requirement. 
    # But user might want to see output. Let's keep existing print() calls for UI, and use logger for structured data.
    # Or replace print with logger.info.
    # The requirement says: "Replace print() with logger.info()". 
    # If we do that, we should also have a console handler so user sees what's happening.
    
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))

    # Configure root logger
    logging.root.setLevel(logging.INFO)
    logging.root.addHandler(handler)
    logging.root.addHandler(console_handler)
    
    # Quiet down some noisy libraries if needed
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("playwright").setLevel(logging.WARNING)
