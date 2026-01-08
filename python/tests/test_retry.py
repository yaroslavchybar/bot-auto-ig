def test_retry_succeeds_after_failures():
    from python.internal_systems.error_handling.retry import retry_with_backoff
    
    call_count = 0
    
    @retry_with_backoff(max_retries=2, initial_delay=0.01)
    def flaky_function():
        nonlocal call_count
        call_count += 1
        if call_count < 2:
            raise TimeoutError("Simulated timeout")
        return "success"
    
    result = flaky_function()
    assert result == "success"
    assert call_count == 2

def test_jitter_adds_variance():
    from python.internal_systems.error_handling.retry import jitter
    results = [jitter(1000) for _ in range(100)]
    assert min(results) < 1000
    assert max(results) > 1000
