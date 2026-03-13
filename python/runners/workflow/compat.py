import importlib
import sys
from types import ModuleType


def compat() -> ModuleType:
    module = sys.modules.get('python.runners.run_workflow')
    if module is not None:
        return module
    return importlib.import_module('python.runners.run_workflow')
