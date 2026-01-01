import pytest
from unittest.mock import MagicMock, patch
from python.core.automation.selectors import SemanticSelector

def test_semantic_selector_role_success():
    mock_page = MagicMock()
    # Setup successful role match
    found_locator = MagicMock()
    found_locator.count.return_value = 1
    found_locator.first = "found_element"
    
    mock_page.get_by_role.return_value = found_locator
    
    selector = SemanticSelector(element_name="Test", role="button")
    result = selector.find(mock_page)
    
    assert result == "found_element"
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
    css_locator.first = "css_element"
    mock_page.locator.return_value = css_locator
    
    selector = SemanticSelector(element_name="Test", role="button", css_fallback=".btn")
    result = selector.find(mock_page)
    
    assert result == "css_element"
    mock_page.locator.assert_called_with(".btn")

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
