def test_recoverable_is_bot_exception():
    from python.core.resilience.exceptions import RecoverableError, BotException
    assert issubclass(RecoverableError, BotException)

def test_fatal_is_bot_exception():
    from python.core.resilience.exceptions import FatalError, BotException
    assert issubclass(FatalError, BotException)

def test_exception_imports():
    from python.automation.browser import AccountBannedException
    from python.automation.scrolling.feed.scroll import BotException, ElementNotFoundError
    from python.automation.scrolling.feed.likes import ElementNotFoundError as LikesElementNotFoundError
    assert AccountBannedException
    assert BotException
    assert ElementNotFoundError
    assert LikesElementNotFoundError
