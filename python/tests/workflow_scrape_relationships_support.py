from concurrent.futures import ThreadPoolExecutor

from python.runners.workflow import runtime as workflow_runtime_mod


class DummyClient:
    def __init__(self):
        self.increment_calls = []
        self.status_updates = []
        self.accounts_by_status = []

    def increment_daily_scraping_used(self, name, amount):
        self.increment_calls.append((name, amount))
        return True

    def list_accounts_by_status(self, status):
        return list(self.accounts_by_status) if status == 'scraping' else []

    def update_account_status(self, account_id, status='subscribed', assigned_to='__NOT_SET__'):
        self.status_updates.append(
            {
                'account_id': account_id,
                'status': status,
                'assigned_to': assigned_to,
            }
        )
        return True


class DummyDisplayManager:
    def cleanup_all(self):
        return None


class ConvexResponse:
    status_code = 200

    @staticmethod
    def json():
        return {'_id': 'artifact_test', 'storageId': 'storage_test'}

    @staticmethod
    def raise_for_status():
        return None


class FakeLocator:
    def __init__(self, page, selector, *, name=None):
        self._page = page
        self._selector = selector
        self._name = name

    @property
    def first(self):
        return self

    def click(self, timeout=None):
        selector = self._selector
        if self._name:
            selector = f'{selector}[name={self._name}]'
        self._page.click(selector, timeout=timeout)


class FakePage:
    def __init__(self, *, available_kinds=None, openable_kinds=None):
        self.visited = []
        self.waits = []
        self.clicks = []
        self.waited_functions = []
        self.evaluations = []
        self.available_kinds = {'followers', 'following'} if available_kinds is None else set(available_kinds)
        self.openable_kinds = set(self.available_kinds) if openable_kinds is None else set(openable_kinds)
        self.opened_kind = None

    def goto(self, url, wait_until=None, timeout=None):
        self.visited.append({'url': url, 'wait_until': wait_until, 'timeout': timeout})

    def wait_for_timeout(self, ms):
        self.waits.append(ms)

    def click(self, selector, timeout=None):
        self.clicks.append({'selector': selector, 'timeout': timeout})
        kind = None
        if 'followers' in selector.lower():
            kind = 'followers'
        elif 'following' in selector.lower():
            kind = 'following'
        if kind is None or kind not in self.available_kinds:
            raise Exception(f'selector not found: {selector}')
        self.opened_kind = kind

    def evaluate(self, script, arg=None):
        self.evaluations.append({'script': script, 'arg': arg})
        selectors = arg.get('selectors') if isinstance(arg, dict) else None
        if selectors is None:
            raise AssertionError('unexpected evaluate call in test fake')
        for selector in selectors:
            kind = None
            if 'followers' in selector.lower():
                kind = 'followers'
            elif 'following' in selector.lower():
                kind = 'following'
            if kind is None or kind not in self.available_kinds:
                continue
            self.clicks.append({'selector': selector, 'timeout': None})
            self.opened_kind = kind
            return selector
        return None

    def wait_for_function(self, script, arg=None, timeout=None):
        self.waited_functions.append({'script': script, 'arg': arg, 'timeout': timeout})
        kind = arg.get('kind') if isinstance(arg, dict) else None
        if kind and kind == self.opened_kind and kind in self.openable_kinds:
            return True
        raise Exception('relationship UI not open')

    def get_by_role(self, role, name=None, exact=None):
        return FakeLocator(self, f'role:{role}', name=name)

    def locator(self, selector, has_text=None):
        label = has_text if isinstance(has_text, str) else None
        return FakeLocator(self, selector, name=label)


def patch_runtime_symbol(monkeypatch, name, value):
    monkeypatch.setattr(workflow_runtime_mod, name, value)
    monkeypatch.setattr(workflow_runtime_mod, name, value, raising=False)


def build_runner(monkeypatch, node_states=None):
    patch_runtime_symbol(monkeypatch, 'InstagramAccountsClient', DummyClient)
    patch_runtime_symbol(monkeypatch, 'ProfilesClient', DummyClient)
    patch_runtime_symbol(monkeypatch, 'DisplayManager', DummyDisplayManager)
    monkeypatch.setattr('requests.post', lambda *args, **kwargs: ConvexResponse())
    runner = workflow_runtime_mod.WorkflowRunner(
        workflow_id='wf_123',
        nodes=[],
        edges=[],
        accounts=[],
        options={'workflow_name': 'Workflow Scrape Test', 'node_states': node_states or {}},
    )
    runner._executor.shutdown(wait=False, cancel_futures=True)
    runner._executor = ThreadPoolExecutor(max_workers=1)
    return runner


def scrape_config(kind: str, targets, **overrides):
    return {
        'kind': kind,
        'targets': list(targets),
        'chunkLimit': 50,
        'maxPagesPerAttempt': 2,
        'maxAttempts': 2,
        'retryBackoffSeconds': '5,10',
        'openDelaySeconds': 0,
        **overrides,
    }
