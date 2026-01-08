import pytest
from unittest.mock import patch, MagicMock
from python.internal_systems.process_management.healthcheck import check_internet, check_disk_space, check_proxy, run_all_checks

def test_check_internet_success():
    with patch("socket.create_connection") as mock_conn:
        assert check_internet() is True
        mock_conn.assert_called_once()

def test_check_internet_failure():
    with patch("socket.create_connection", side_effect=OSError("Unreachable")):
        assert check_internet() is False

def test_check_disk_space_success():
    with patch("shutil.disk_usage") as mock_du:
        # total, used, free (in bytes). 2GB free
        mock_du.return_value = (100, 50, 2 * 1024**3)
        assert check_disk_space(min_gb=1) is True

def test_check_disk_space_failure():
    with patch("shutil.disk_usage") as mock_du:
        # 500MB free
        mock_du.return_value = (100, 50, 500 * 1024**2)
        assert check_disk_space(min_gb=1) is False

def test_check_proxy_success():
    with patch("requests.get") as mock_get:
        mock_get.return_value.status_code = 200
        assert check_proxy({"http": "foo"}) is True

def test_check_proxy_failure():
    with patch("requests.get") as mock_get:
        mock_get.side_effect = Exception("Connection error")
        assert check_proxy({"http": "foo"}) is False

def test_run_all_checks():
    with patch("python.internal_systems.process_management.healthcheck.check_internet", return_value=True), \
         patch("python.internal_systems.process_management.healthcheck.check_disk_space", return_value=True), \
         patch("python.internal_systems.process_management.healthcheck.check_proxy", return_value=True):
        
        results = run_all_checks(proxy_config={"http": "foo"})
        assert results["internet"] is True
        assert results["disk_space"] is True
        assert results["proxy"] is True
