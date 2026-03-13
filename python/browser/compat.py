import importlib
import sys
from types import ModuleType


def compat() -> ModuleType:
    module = sys.modules.get('python.browser.setup')
    if module is not None:
        return module
    return importlib.import_module('python.browser.setup')
