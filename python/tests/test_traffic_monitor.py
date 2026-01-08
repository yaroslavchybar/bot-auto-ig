import pytest
import time
from unittest.mock import MagicMock, patch
from python.internal_systems.error_handling.traffic_monitor import TrafficMonitor
from python.internal_systems.error_handling.config import config
from python.browser_control.browser_setup import (
    mark_proxy_failure, is_proxy_healthy, ProxyCircuitBreaker, _proxy_health, proxy_circuit
)

# --- Traffic Monitor Tests ---

def test_traffic_monitor_records_errors():
    monitor = TrafficMonitor(window_secs=10, error_threshold=2)
    
    # Mock response
    bad_response = MagicMock()
    bad_response.status = 429
    
    monitor.on_response(bad_response)
    assert len(monitor.errors) == 1
    
    monitor.on_response(bad_response)
    assert len(monitor.errors) == 2
    assert monitor.should_pause()

def test_traffic_monitor_ignores_success():
    monitor = TrafficMonitor()
    
    ok_response = MagicMock()
    ok_response.status = 200
    
    monitor.on_response(ok_response)
    assert len(monitor.errors) == 0

def test_traffic_monitor_window_pruning():
    monitor = TrafficMonitor(window_secs=0.1)
    
    bad_response = MagicMock()
    bad_response.status = 500
    
    monitor.on_response(bad_response)
    assert len(monitor.errors) == 1
    
    time.sleep(0.2)
    monitor.on_response(bad_response)
    # The old error should be pruned, so count is 1
    assert len(monitor.errors) == 1

# --- Proxy Health Tests ---

def test_proxy_health_tracking():
    proxy = "http://user:pass@1.2.3.4:8080"
    
    # Clear health state
    _proxy_health.clear()
    
    # Simulate failures
    for _ in range(config.PROXY_FAILURE_THRESHOLD):
        mark_proxy_failure(proxy)
        
    assert not is_proxy_healthy(proxy)
    assert _proxy_health[proxy]["tainted_until"] > time.time()

def test_proxy_recovery():
    proxy = "http://recovery.test:8080"
    _proxy_health.clear()
    
    # Manually taint
    _proxy_health[proxy] = {
        "failures": config.PROXY_FAILURE_THRESHOLD, 
        "tainted_until": time.time() - 1 # Expired
    }
    
    assert is_proxy_healthy(proxy)

# --- Circuit Breaker Tests ---

def test_circuit_breaker_trips():
    # Reset circuit
    proxy_circuit.consecutive_failures = 0
    proxy_circuit.global_pause_until = 0
    
    for _ in range(config.CIRCUIT_THRESHOLD):
        proxy_circuit.record_failure()
        
    assert proxy_circuit.is_open()
    assert proxy_circuit.global_pause_until > time.time()

def test_circuit_breaker_resets_on_success():
    proxy_circuit.consecutive_failures = config.CIRCUIT_THRESHOLD - 1
    proxy_circuit.record_success()
    assert proxy_circuit.consecutive_failures == 0
