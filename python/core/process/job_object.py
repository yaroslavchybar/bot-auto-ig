import ctypes
from ctypes import wintypes
import os
import sys

# Windows API Constants
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
JobObjectExtendedLimitInformation = 9

class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ('ReadOperationCount', ctypes.c_ulonglong),
        ('WriteOperationCount', ctypes.c_ulonglong),
        ('OtherOperationCount', ctypes.c_ulonglong),
        ('ReadTransferCount', ctypes.c_ulonglong),
        ('WriteTransferCount', ctypes.c_ulonglong),
        ('OtherTransferCount', ctypes.c_ulonglong)
    ]

class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('PerProcessUserTimeLimit', ctypes.c_int64),
        ('PerJobUserTimeLimit', ctypes.c_int64),
        ('LimitFlags', wintypes.DWORD),
        ('MinimumWorkingSetSize', ctypes.c_size_t),
        ('MaximumWorkingSetSize', ctypes.c_size_t),
        ('ActiveProcessLimit', wintypes.DWORD),
        ('Affinity', ctypes.c_size_t),
        ('PriorityClass', wintypes.DWORD),
        ('SchedulingClass', wintypes.DWORD)
    ]

class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('BasicLimitInformation', JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ('IoInfo', IO_COUNTERS),
        ('ProcessMemoryLimit', ctypes.c_size_t),
        ('JobMemoryLimit', ctypes.c_size_t),
        ('PeakProcessMemoryUsed', ctypes.c_size_t),
        ('PeakJobMemoryUsed', ctypes.c_size_t)
    ]

class WindowsJobObject:
    """
    Manages a Windows Job Object to ensure child processes (browsers) 
    are terminated when the parent process (Python) ends.
    """
    
    def __init__(self):
        self._handle = None
        if os.name == 'nt':
            self._create_job()
            
    def _create_job(self):
        """Create a job object with KILL_ON_JOB_CLOSE limit."""
        self._handle = ctypes.windll.kernel32.CreateJobObjectW(None, None)
        if not self._handle:
            raise ctypes.WinError()
            
        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        
        success = ctypes.windll.kernel32.SetInformationJobObject(
            self._handle,
            JobObjectExtendedLimitInformation,
            ctypes.pointer(info),
            ctypes.sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)
        )
        
        if not success:
            raise ctypes.WinError()
            
    def assign_process(self, pid: int = None):
        """
        Assign a process to the job. 
        If pid is None, assigns the current process.
        """
        if not self._handle:
            return
            
        if pid is None:
            pid = os.getpid()
            
        process_handle = ctypes.windll.kernel32.OpenProcess(
            0x1F0FFF, # PROCESS_ALL_ACCESS
            False,
            pid
        )
        
        if not process_handle:
            # It's possible the process already died or we don't have access
            return
            
        try:
            success = ctypes.windll.kernel32.AssignProcessToJobObject(
                self._handle,
                process_handle
            )
            if not success:
                # If process is already in a job, this might fail.
                # But if we are the parent and it's a new job, it should work 
                # unless we are nested in a job that forbids breakaway.
                pass
        finally:
            ctypes.windll.kernel32.CloseHandle(process_handle)
            
    def close(self):
        """Close the job handle."""
        if self._handle:
            ctypes.windll.kernel32.CloseHandle(self._handle)
            self._handle = None
