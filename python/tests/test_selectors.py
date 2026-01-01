import pytest
from unittest.mock import MagicMock, patch
from python.core.automation.selectors import SemanticSelector

def test_semantic_selector_role_success():
    mock_page = MagicMock()
    # Setup successful role match
    found_locator = MagicMock()
    found_locator.count.return_value = 1

    first = MagicMock()
    first.is_visible.return_value = True
    first.is_enabled.return_value = True
    found_locator.nth.return_value = first
    
    mock_page.get_by_role.return_value = found_locator
    
    selector = SemanticSelector(element_name="Test", role="button")
    result = selector.find(mock_page)
    
    assert result == first
    mock_page.get_by_role.assert_called_with("button")

def test_semantic_selector_fallback_to_css():
    mock_page = MagicMock()
    
    # Role fails
    empty_locator = MagicMock()
    empty_locator.count.return_value = 0
    mock_page.get_by_role.return_value = empty_locator
    
    # CSS succeeds
    css_locator = MagicMock()
    css_locator.count.return_value = 1
    css_locator.locator.return_value = css_locator

    first = MagicMock()
    first.is_visible.return_value = True
    first.is_enabled.return_value = True
    css_locator.nth.return_value = first
    mock_page.locator.return_value = css_locator
    
    selector = SemanticSelector(element_name="Test", role="button", css_fallback=".btn")
    result = selector.find(mock_page)
    
    assert result == first
    mock_page.locator.assert_called_with(".btn")

def test_semantic_selector_skips_hidden_first_match():
    mock_page = MagicMock()
    empty_locator = MagicMock()
    empty_locator.count.return_value = 0
    mock_page.get_by_role.return_value = empty_locator

    found_locator = MagicMock()
    found_locator.count.return_value = 2
    found_locator.locator.return_value = found_locator

    first = MagicMock()
    first.is_visible.return_value = False
    first.is_enabled.return_value = True

    second = MagicMock()
    second.is_visible.return_value = True
    second.is_enabled.return_value = True

    found_locator.nth.side_effect = [first, second]
    mock_page.get_by_text.return_value = found_locator

    selector = SemanticSelector(element_name="Test", role="button", text="Hello")
    result = selector.find(mock_page)
    assert result == second

@patch('python.core.automation.selectors.save_debug_snapshot')
def test_semantic_selector_snapshot_on_failure(mock_save_snapshot):
    mock_page = MagicMock()
    
    # Simulate an exception to trigger the snapshot logic
    mock_page.get_by_role.side_effect = Exception("Playwright Crash")
    
    selector = SemanticSelector(element_name="Test", role="button")
    
    result = selector.find(mock_page)
    assert result is None
    
    # Verify snapshot was called
    mock_save_snapshot.assert_called_once()
    args = mock_save_snapshot.call_args
    assert args[0][0] == mock_page
    assert "selector_fail_Test" in args[0][1]
