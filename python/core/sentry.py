"""Guarded Sentry SDK initialization for Python automation runners."""

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_initialized = False


def init_sentry() -> bool:
    """Initialize Sentry SDK if SENTRY_DSN_PYTHON is set.

    Returns True if Sentry was initialized, False otherwise.
    Safe to call multiple times — only the first call has effect.
    """
    global _initialized
    if _initialized:
        return True

    dsn = os.environ.get('SENTRY_DSN_PYTHON')
    if not dsn:
        logger.debug('SENTRY_DSN_PYTHON not set, Sentry disabled')
        return False

    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            environment=os.environ.get('SENTRY_ENVIRONMENT', 'production'),
            release=os.environ.get('SENTRY_RELEASE'),
            send_default_pii=True,
            traces_sample_rate=float(
                os.environ.get('SENTRY_TRACES_SAMPLE_RATE', '0.2')
            ),
        )
        _initialized = True
        logger.debug('Sentry SDK initialized')
        return True
    except Exception:
        logger.warning('Failed to initialize Sentry SDK', exc_info=True)
        return False


def flush_sentry(timeout: int = 5) -> None:
    """Flush pending Sentry events. No-op if Sentry is not initialized."""
    if not _initialized:
        return
    try:
        import sentry_sdk

        sentry_sdk.flush(timeout=timeout)
    except Exception:
        pass


def set_sentry_context(
    profile: Optional[str] = None,
    workflow_id: Optional[str] = None,
    workflow_name: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Enrich Sentry context with profile/workflow metadata.

    No-op if Sentry is not initialized.
    """
    if not _initialized:
        return
    try:
        import sentry_sdk

        if profile:
            sentry_sdk.set_tag('profile', profile)
        if workflow_id:
            sentry_sdk.set_tag('workflow_id', workflow_id)
        if workflow_name:
            sentry_sdk.set_tag('workflow_name', workflow_name)
        context: Dict[str, Any] = {}
        if profile:
            context['profile'] = profile
        if workflow_id:
            context['workflow_id'] = workflow_id
        if workflow_name:
            context['workflow_name'] = workflow_name
        if extra:
            context.update(extra)
        if context:
            sentry_sdk.set_context('automation', context)
    except Exception:
        pass
