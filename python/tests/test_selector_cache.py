import pytest
from unittest.mock import MagicMock, patch
import json
from pathlib import Path
from python.core.persistence.selector_cache import (
    load_cache, save_cache, record_success, get_preferred_strategy
)
from python.core.automation.selectors import SemanticSelector

# --- Selector Cache Tests ---

@pytest.fixture
def mock_cache_file(tmp_path):
    cache_file = tmp_path / "selector_cache.json"
    with patch("python.core.persistence.selector_cache.CACHE_FILE", cache_file):
        yield cache_file

def test_save_and_load_cache(mock_cache_file):
    data = {"element1": {"strategy": "role", "timestamp": 12345}}
    save_cache(data)
    loaded = load_cache()
    assert loaded == data

def test_load_cache_empty(mock_cache_file):
    assert load_cache() == {}

def test_record_success_and_get_preferred(mock_cache_file):
    record_success("element1", "css")
    strategy = get_preferred_strategy("element1")
    assert strategy == "css"
    
    # Verify timestamp exists
    cache = load_cache()
    assert "timestamp" in cache["element1"]

# --- Semantic Selector Integration Tests ---

@pytest.fixture
def mock_page():
    page = MagicMock()
    return page

@pytest.fixture
def mock_locator():
    locator = MagicMock()
    locator.count.return_value = 1
    locator.first = MagicMock()
    return locator

def test_find_uses_preferred_strategy(mock_cache_file, mock_page, mock_locator):
    # Setup cache
    record_success("Test Element", "css")
    
    selector = SemanticSelector(
        element_name="Test Element",
        role="button",
        css_fallback=".btn"
    )
    
    # Mock locators
    # CSS should be called first because it's preferred
    mock_page.locator.return_value = mock_locator
    
    result = selector.find(mock_page)
    
    assert result == mock_locator.first
    mock_page.locator.assert_called_with(".btn")
    mock_page.get_by_role.assert_not_called()

def test_find_records_success_on_fallback(mock_cache_file, mock_page, mock_locator):
    selector = SemanticSelector(
        element_name="Test Element",
        role="button",
        css_fallback=".btn"
    )
    
    # Mock role failure, css success
    empty_locator = MagicMock()
    empty_locator.count.return_value = 0
    
    mock_page.get_by_role.return_value = empty_locator
    mock_page.locator.return_value = mock_locator
    
    result = selector.find(mock_page)
    
    assert result == mock_locator.first
    
    # Verify css was recorded as success
    assert get_preferred_strategy("Test Element") == "css"

def test_find_text_fallback(mock_cache_file, mock_page, mock_locator):
    selector = SemanticSelector(
        element_name="Test Element",
        text="Click Me"
    )
    
    # All standard strategies fail
    empty_locator = MagicMock()
    empty_locator.count.return_value = 0
    mock_page.get_by_text.return_value = empty_locator
    
    # Text fallback succeeds
    fallback_locator = MagicMock()
    fallback_locator.is_visible.return_value = True
    fallback_locator.is_enabled.return_value = True
    
    mock_page.locator.return_value.all.return_value = [fallback_locator]
    
    result = selector.find(mock_page)
    
    assert result == fallback_locator
    mock_page.locator.assert_called_with("*:has-text('Click Me')")
