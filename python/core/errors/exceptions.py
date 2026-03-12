class BotException(Exception):
    """Base exception for all bot errors."""
    pass

class RecoverableError(BotException):
    """Errors that can be retried or recovered from."""
    pass

class FatalError(BotException):
    """Errors that require stopping the current session."""
    pass

# Specific exceptions
class ElementNotFoundError(RecoverableError):
    """Raised when an expected element is not found."""
    pass

class SelectorTimeoutError(RecoverableError):
    """Raised when a selector times out."""
    pass

class NetworkError(RecoverableError):
    """Raised when a network operation fails."""
    pass

class ProxyError(RecoverableError):
    """Raised when proxy connection fails."""
    pass

class AccountBannedException(FatalError):
    """Raised when the account appears to be banned."""
    pass

class LoginRequiredException(FatalError):
    """Raised when login is required but not handled."""
    pass

class RateLimitException(RecoverableError):
    """Raised when rate limit is encountered."""
    pass

class TransientError(RecoverableError):
    """Network timeout, temporary selector miss - RETRY with backoff."""
    pass

class StaleStateError(RecoverableError):
    """Browser froze, page unresponsive - RESTART BROWSER."""
    pass
