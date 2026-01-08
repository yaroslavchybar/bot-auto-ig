def test_recoverable_is_bot_exception():
    from python.internal_systems.error_handling.exceptions import RecoverableError, BotException
    assert issubclass(RecoverableError, BotException)

def test_fatal_is_bot_exception():
    from python.internal_systems.error_handling.exceptions import FatalError, BotException
    assert issubclass(FatalError, BotException)

def test_exception_imports():
    from python.browser_control.browser_setup import AccountBannedException
    from python.instagram_actions.browsing.feed_scrolling.scroll import BotException, ElementNotFoundError
    from python.instagram_actions.browsing.feed_scrolling.likes import ElementNotFoundError as LikesElementNotFoundError
    assert AccountBannedException
    assert BotException
    assert ElementNotFoundError
    assert LikesElementNotFoundError
