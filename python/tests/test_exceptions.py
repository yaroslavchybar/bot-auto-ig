def test_recoverable_is_bot_exception():
    from python.core.errors.exceptions import RecoverableError, BotException
    assert issubclass(RecoverableError, BotException)

def test_fatal_is_bot_exception():
    from python.core.errors.exceptions import FatalError, BotException
    assert issubclass(FatalError, BotException)

def test_exception_imports():
    from python.browser.setup import AccountBannedException
    from python.actions.browsing.feed_scrolling.scroll import BotException, ElementNotFoundError
    from python.actions.browsing.feed_scrolling.likes import ElementNotFoundError as LikesElementNotFoundError
    assert AccountBannedException
    assert BotException
    assert ElementNotFoundError
    assert LikesElementNotFoundError
