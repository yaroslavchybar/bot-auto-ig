def test_cleanup_orphaned_processes_runs_without_error():
    from python.core.runtime.process_manager import ProcessManager
    import os
    import python.core.runtime.process_manager as pm_mod
    from unittest.mock import MagicMock, patch

    pm = ProcessManager()
    
    project_root = os.path.abspath(os.path.join(os.path.dirname(pm_mod.__file__), "..", "..", ".."))
    profiles_dir = os.path.join(project_root, "python", "data", "profiles")

    mock_launcher = MagicMock()
    mock_launcher.pid = 999998
    mock_launcher.info = {'cmdline': ['python', 'launcher.py']}

    mock_firefox = MagicMock()
    mock_firefox.pid = 999999
    mock_firefox.info = {'cmdline': ['firefox', '-profile', os.path.join(profiles_dir, 'p1')]}
    
    with patch('psutil.process_iter', return_value=[mock_launcher, mock_firefox]):
        count = pm.cleanup_orphaned_processes()
        assert not mock_launcher.terminate.called
        assert mock_firefox.terminate.called
        assert count == 1

def test_memory_functions():
    from python.core.runtime.process_manager import ProcessManager
    import psutil
    from unittest.mock import MagicMock, patch
    
    pm = ProcessManager()
    
    # Mock a running process
    mock_popen = MagicMock()
    mock_popen.pid = 12345
    pm.running_processes["test_profile"] = mock_popen
    
    # Mock psutil.Process
    with patch('psutil.Process') as mock_psutil_proc_cls:
        mock_instance = mock_psutil_proc_cls.return_value
        # Return 100MB
        mock_instance.memory_info.return_value.rss = 100 * 1024 * 1024
        
        usage = pm.get_memory_usage("test_profile")
        assert usage == 100
        
        # Check limit
        exceeding = pm.check_memory_limits(limit_mb=50)
        assert "test_profile" in exceeding
        
        exceeding = pm.check_memory_limits(limit_mb=200)
        assert "test_profile" not in exceeding
