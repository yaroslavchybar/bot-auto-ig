import sys
import os
import time
import subprocess
import unittest
import psutil

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

class TestWindowsJobObject(unittest.TestCase):
    def test_job_object_cleanup(self):
        if os.name != 'nt':
            self.skipTest("Windows Job Object only works on Windows")
            
        # Create a python script that:
        # 1. Creates a Job Object and assigns itself
        # 2. Spawns a child process (notepad or another python script that sleeps)
        # 3. Prints the child PID
        # 4. Exits (or is killed)
        
        parent_script = """
import sys
import os
import time
import subprocess
sys.path.insert(0, r"{root}")
from python.core.runtime.job_object import WindowsJobObject

# Create Job Object
job = WindowsJobObject()
job.assign_process()

# Spawn child
child = subprocess.Popen(["python", "-c", "import time; time.sleep(60)"])
print(child.pid)
sys.stdout.flush()

# Keep running until killed or instructed
time.sleep(10)
""".format(root=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

        # Run the parent script
        parent_proc = subprocess.Popen(
            [sys.executable, "-c", parent_script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Read child PID
        try:
            child_pid_str = parent_proc.stdout.readline().strip()
            if not child_pid_str:
                print("Failed to get child PID from parent script")
                print(parent_proc.stderr.read())
                self.fail("Could not get child PID")
                
            child_pid = int(child_pid_str)
            
            # Verify child is running
            self.assertTrue(psutil.pid_exists(child_pid), "Child should be running")
            
            # Kill the parent process
            parent_proc.terminate()
            parent_proc.wait()
            
            # Wait a bit for OS to clean up
            time.sleep(1)
            
            # Verify child is DEAD
            is_running = psutil.pid_exists(child_pid)
            self.assertFalse(is_running, "Child process should have been killed by Job Object")
            
        except Exception as e:
            if parent_proc.poll() is None:
                parent_proc.kill()
            raise e

if __name__ == "__main__":
    unittest.main()
