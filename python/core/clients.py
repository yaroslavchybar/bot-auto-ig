"""Facade for database client classes.

This module re-exports the database client classes so that ``runners/`` and
``actions/`` can access them without importing from ``python.database``
directly.  This preserves the import-direction rules:

    runners → core (allowed)
    actions → core (allowed)
    core/clients → database (allowed — only database imports *core*, not the
    other way around, so no circular dependency is introduced.)
"""

from python.database.accounts import (
    InstagramAccountsClient,
    InstagramAccountsError,
)
from python.database.messages import (
    MessageTemplatesClient,
    MessageTemplatesError,
)
from python.database.profiles import (
    ProfilesClient,
    ProfilesError,
)

__all__ = [
    "InstagramAccountsClient",
    "InstagramAccountsError",
    "MessageTemplatesClient",
    "MessageTemplatesError",
    "ProfilesClient",
    "ProfilesError",
]
