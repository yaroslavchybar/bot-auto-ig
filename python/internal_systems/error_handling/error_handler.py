import logging
from enum import Enum
import time
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError
from python.internal_systems.error_handling.exceptions import (
    TransientError, 
    StaleStateError, 
    RateLimitException, 
    FatalError, 
    RecoverableError,
    AccountBannedException,
    LoginRequiredException,
    NetworkError,
    ProxyError,
    ElementNotFoundError,
    SelectorTimeoutError
)

logger = logging.getLogger(__name__)

class ErrorDecision(Enum):
    RETRY = "retry"               # TransientError
    RESTART_BROWSER = "restart"   # StaleStateError  
    BACKOFF_AND_SLOW = "backoff"  # RateLimitException
    ABORT = "abort"               # FatalError

def classify_exception(exc: Exception) -> ErrorDecision:
    """Route exceptions to appropriate recovery strategy."""
    
    decision = ErrorDecision.ABORT

    # 1. Fatal Errors -> ABORT
    if isinstance(exc, (AccountBannedException, LoginRequiredException, FatalError)):
        decision = ErrorDecision.ABORT

    # 1.5 Target Closed (Browser Crash) -> RESTART
    elif isinstance(exc, PlaywrightError) and "Target closed" in str(exc):
        decision = ErrorDecision.RESTART_BROWSER
        
    # 2. Rate Limits -> BACKOFF
    elif isinstance(exc, RateLimitException):
        decision = ErrorDecision.BACKOFF_AND_SLOW
        
    # 3. Transient Errors -> RETRY
    elif isinstance(exc, (TransientError, NetworkError, ProxyError, PlaywrightTimeoutError)):
        decision = ErrorDecision.RETRY
        
    # 4. State Errors -> RESTART
    elif isinstance(exc, StaleStateError):
        decision = ErrorDecision.RESTART_BROWSER

    # 5. Element/Selector Errors -> RETRY
    elif isinstance(exc, (ElementNotFoundError, SelectorTimeoutError)):
        decision = ErrorDecision.RETRY
        
    # 5. Unknown Errors
    # If it's a generic Exception, we should probably RESTART to be safe, 
    # but verify it's not a syntax error or something permanent.
    # For now, treat unknown as ABORT to avoid infinite loops on bugs, 
    # OR treat as RESTART if we trust our stability. 
    # Given "Resilience", RESTART is often safer than crashing, provided we have retry limits.
    # However, standard practice is to abort on unknown code errors.
    # Let's stick to ABORT for unknown exceptions to force visibility of bugs.
    else:
        decision = ErrorDecision.ABORT

    logger.warning(
        "Exception classified",
        extra={
            "decision": decision.name,
            "exception_type": type(exc).__name__,
            "exception_msg": str(exc)[:200]
        }
    )
    return decision
