import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { runRoutineSession } from './routine.js';
import { errors } from 'playwright-core';
import { SessionEnded } from './actions/session.js';
import { currentLogScope, type LogScope } from '../shared/logger.js';

function setup(mode: 'dm' | 'follow' = 'dm', relationship: 'Follow' | 'Following' | 'Requested' = mode === 'dm' ? 'Following' : 'Follow',
) {
  const calls: string[] = [];
  let now = 0, sent = false, issue: string | undefined;
  const attempt = { leadId: 'lead', date: '2026-09-21', username: 'alice', message: 'Hello alice',
    screeningToken: 'screen', isPrivate: undefined as boolean | undefined,
  };
  const locator = {
    first() { return this; }, last() { return this; }, nth() { return this; }, or() { return this; }, filter() { return this; },
    getByRole() { return this; }, count: async () => 1, ...visibleActionGeometry, hover: async () => {}, isVisible: async () => false,
    page: () => page,
    elementHandle: async function() { return this; }, dispose: async () => {},
    click: async () => { calls.push('message-button'); },
    fill: async () => { calls.push('compose'); },
    press: async () => { calls.push('send'); },
    waitFor: async () => { calls.push('confirm'); },
  };
  const page = {
    locator: (selector: string) => {
      if (!selector.startsWith('xpath=') || selector.startsWith('xpath=/*[') || selector.includes('="message"'))
        return selector.includes('IGDChatTabsRootContentOffMsys') ? { ...locator, isVisible: async () => true } : locator;
      const name = selector.includes('="following"') ? /^(Following|Requested)(?: Down chevron icon)?$/i : /^(Follow|Follow back)$/i;
      return { ...locator, or: () => ({ waitFor: async () => {} }),
        waitFor: async () => { assert.equal(name.test(relationship), true); },
        isVisible: async () => name.test(relationship),
        click: async () => { assert.equal(relationship, 'Follow'); relationship = 'Following'; calls.push('follow'); },
      };
    },
    url: () => 'https://www.instagram.com/',
    goto: async () => { calls.push('navigate'); },
    getByRole: () => locator,
    getByText: (text: string | RegExp) => String(text).startsWith("This account can't receive")
      ? { ...locator, waitFor: async () => { throw new Error('missing'); },
          } : locator,
  } as unknown as Page;
  const deps: NonNullable<Parameters<typeof runRoutineSession>[5]> = {
    searchProfile: async () => true,
    screenLead: async () => {
      calls.push('screen')
      return { category: 'male', confidence: 1 }
    },
    finishScreening: async () => {
      calls.push('screen-saved')
      return true
    },
    follow: async (_page, allowed, click, confirmed) => { if (!(await allowed())) return false; await click(); await confirmed(); return true; },
    pauseFollows: async () => {},
    instagram: async () => {},
    now: () => now, ready: async () => true,
    target: async () => ({ target: mode === 'follow' ? 1 : 0, remaining: mode === 'follow' && !calls.includes('reserve') ? 1 : 0, sent: 0,
    }),
    sleep: async (ms) => { now += ms; }, random: (min) => min,
    followTasks: async () => [],
    recordFollow: async (_, __, followed) => { calls.push(followed ? 'record-follow' : 'record-unfollow'); },
    beginFollow: async () => { calls.push('authorize-follow'); return true; },
    notifications: async () => null,
    readNotifications: async () => { calls.push('read-notifications'); return ['alice']; },
    recordNotifications: async () => { calls.push('record-notifications'); },
    dmTasks: async () => (mode === 'dm' ? [attempt] : []),
    dismissDm: async () => { calls.push('dismiss-dm'); },
    ownUsername: async () => 'sender',
    followsUs: async () => { calls.push('verify-follower'); return true; },
    likeRecentPost: async () => { calls.push('optional-like'); return true; },
    reserve: async () => { calls.push('reserve'); return attempt; },
    begin: async () => { calls.push('authorize'); return true; },
    finish: async (_, __, ___, value, blocked) => { calls.push(value ? 'sent' : blocked ? 'blocked' : 'uncertain'); sent = value; },
    record: async (_, __, completed, error) => { calls.push(completed ? 'record-completed' : 'record-incomplete'); issue = error; },
    warmup: async (_p, _a, _c, _page, _log, stopped, _deps, activity) => {
      const result = await activity!({ deadline: now + 600_000, remainingMinutes: 10,
        browse: async (minutes) => { calls.push('browse'); now += minutes * 60_000; return 'finished'; },
      });
      return { minutes: 10, reason: stopped() || result === 'stopped' ? 'stopped' : 'finished' };
    },
  };
  const automation = { _id: 'automation', name: 'Daily', nodes: [], edges: [], routine: { headless: true, activity: {} },
  };
  const run = (stopped = () => false) => runRoutineSession(automation, 'profile', page, () => {}, stopped, deps);
  return { calls, deps, page, locator, attempt, run, result: () => ({ sent, issue }) };
}

test('follow-first outreach never opens or sends a DM in the follow action', async () => {
  const s = setup('follow'); await s.run();
  assert.deepEqual(s.calls.filter((c) => !['browse', 'record-completed'].includes(c)),
    ['reserve', 'navigate',
      'screen',
      'screen-saved',
      'authorize-follow', 'follow', 'record-follow', 'optional-like',
    ],
  );
  assert.equal(s.result().sent, false);
});

test('each lead retains navigation, screening, follow and optional-like timings in its own completed event', async () => {
  const s = setup('follow');
  let scope: LogScope | undefined;
  const navigate = s.page.goto.bind(s.page), screen = s.deps.screenLead, follow = s.deps.follow;
  s.page.goto = async (url, options) => { await s.deps.sleep(400); return navigate(url, options); };
  s.deps.screenLead = async (...args) => {
    scope = currentLogScope();
    await s.deps.sleep(1250);
    return screen(...args);
  };
  s.deps.follow = async (...args) => { await s.deps.sleep(250); return follow(...args); };
  s.deps.likeRecentPost = async (_page, _allowed, _before, session) => {
    assert.ok(session);
    assert.ok(session.end <= Date.now() + 15_000);
    await s.deps.sleep(600);
    return false;
  };
  await s.run();
  assert.ok(scope?.completed);
  assert.equal(scope.event, 'automation.recipient_session');
  assert.equal(scope.fields.targetUsername, 'alice');
  assert.equal(scope.fields.navigationMs, 400);
  assert.equal(scope.fields.screeningMs, 1250);
  assert.equal(scope.fields.followMs, 250);
  assert.equal(scope.fields.optionalLikeMs, 600);
  assert.equal(scope.fields.followed, true);
  assert.equal(scope.fields.liked, false);
});

test('selected known public leads open through Search once before screening and following', async () => {
  const s = setup('follow')
  s.attempt.isPrivate = false
  s.deps.searchProfile = async (_page, username) => { assert.equal(username, 'alice'); s.calls.push('search'); return true }
  await s.run()
  assert.ok(s.calls.indexOf('search') < s.calls.indexOf('screen'))
  assert.ok(s.calls.indexOf('search') < s.calls.indexOf('authorize-follow'))
  assert.ok(s.calls.includes('follow'))
  assert.equal(s.calls.filter(c => c === 'navigate').length, 0)
  assert.equal(s.calls.filter(c => c === 'search').length, 1)
})

for (const isPrivate of [undefined, true, false]) test(`private/unknown or unselected public leads keep the direct route (${isPrivate})`, async () => {
  const s = setup('follow')
  s.attempt.isPrivate = isPrivate
  if (isPrivate === false) s.deps.random = (min, max) => min === 0 && max === 1 ? 0.9 : min
  s.deps.searchProfile = async () => { throw new Error('Should not search this profile') }
  await s.run()
  assert.ok(s.calls.includes('follow'))
  assert.equal(s.calls.filter(c => c === 'navigate').length, 1)
  assert.equal(s.result().issue, undefined)
})

for (const failure of [false, new errors.TimeoutError('Search result missing'), new SessionEnded('Search time ended')])
  test(`failed optional Search restores the exact profile before following (${String(failure)})`, async () => {
    const s = setup('follow')
    s.attempt.isPrivate = false
    s.deps.searchProfile = async () => { s.calls.push('search'); if (failure) throw failure; return false }
    const goto = s.page.goto
    s.page.goto = async (url, options) => { assert.equal(url, 'https://www.instagram.com/alice/'); return goto(url, options) }
    await s.run()
    assert.deepEqual(s.calls.slice(s.calls.indexOf('search'), s.calls.indexOf('follow') + 1), ['search', 'navigate', 'screen', 'screen-saved', 'authorize-follow', 'follow'])
    assert.equal(s.calls.filter(c => c === 'navigate').length, 1)
    assert.equal(s.result().issue, undefined)
  })

test('a stop during Search prevents fallback navigation and following', async () => {
  const s = setup('follow')
  let stopped = false
  s.attempt.isPrivate = false
  s.deps.searchProfile = async () => { stopped = true; throw new errors.TimeoutError('Interrupted') }
  await s.run(() => stopped)
  assert.equal(s.calls.filter(c => c === 'navigate').length, 0)
  assert.ok(!s.calls.includes('screen'))
  assert.ok(!s.calls.includes('authorize-follow'))
})

test('a checkpoint during optional Search stops before fallback or follow authorization', async () => {
  const s = setup('follow')
  s.attempt.isPrivate = false
  s.deps.searchProfile = async () => {
    s.deps.instagram = async () => { throw new Error('Instagram checkpoint needs attention') }
    throw new errors.TimeoutError('Search timed out')
  }
  await s.run()
  assert.equal(s.calls.filter(c => c === 'navigate').length, 0)
  assert.ok(!s.calls.includes('screen'))
  assert.ok(!s.calls.includes('authorize-follow'))
  assert.match(s.result().issue!, /checkpoint/)
})

test('a rejected screenshot decision saves enrichment and never follows or likes', async () => {
  const s = setup('follow')
  s.deps.screenLead = async () => {
    s.calls.push('screen')
    return { category: 'female', confidence: 0.95 }
  }
  s.deps.finishScreening = async (_a, _p, _l, _token, _date, decision) => {
    assert.equal(decision?.category, 'female')
    s.calls.push('screen-saved')
    return false
  }
  await s.run()
  assert.ok(s.calls.includes('screen-saved'))
  assert.ok(!s.calls.includes('authorize-follow'))
  assert.ok(!s.calls.includes('follow'))
  assert.ok(!s.calls.includes('optional-like'))
})

test('a screenshot/provider failure releases its lease without following or stopping the account', async () => {
  const s = setup('follow')
  s.deps.screenLead = async () => {
    throw new Error('Provider unavailable')
  }
  s.deps.finishScreening = async (_a, _p, _l, _token, _date, decision) => {
    assert.equal(decision, undefined)
    s.calls.push('screen-released')
    return false
  }
  await s.run()
  assert.ok(s.calls.includes('screen-released'))
  assert.ok(!s.calls.includes('follow'))
  assert.equal(s.result().issue, undefined)
})

test('before maintenance the routine only browses, even when ready lead and DM mocks are available', async () => {
  const s = setup('follow');
  s.deps.warmup = async (_p, _a, _c, _page, _log, _stopped, _deps, activity) => {
    const result = await activity!({ day: 7, deadline: 600_000, remainingMinutes: 10,
      browse: async () => { s.calls.push('browse'); return 'skipped'; },
    });
    return { minutes: 10, reason: result === 'finished' ? 'finished' : 'stopped' };
  };
  await s.run();
  assert.ok(s.calls.includes('browse')); assert.ok(!s.calls.includes('reserve'));
  assert.ok(!s.calls.includes('follow')); assert.ok(!s.calls.includes('send'));
});

test('week-one browsing retries a stall without running outreach', async () => {
  const s = setup('follow');
  let tries = 0;
  s.deps.warmup = async (_p, _a, _c, _page, _log, _stopped, _deps, activity) => {
    const reason = await activity!({ day: 7, deadline: 600_000, remainingMinutes: 10,
      browse: async minutes => {
        s.calls.push('browse');
        await s.deps.sleep(++tries === 1 ? 30_000 : minutes * 60_000);
        return tries === 1 ? 'stalled' : 'finished';
      },
    });
    assert.equal(reason, 'finished');
    return { minutes: s.deps.now() / 60_000, reason };
  };
  await s.run();
  assert.equal(tries, 2);
  assert.equal(s.deps.now(), 600_000);
  assert.ok(!s.calls.includes('reserve'));
  assert.ok(!s.calls.includes('authorize-follow'));
  assert.ok(!s.calls.includes('send'));
});

test('Instagram warnings stop outreach before reserving or following a lead', async () => {
  const s = setup('follow');
  s.deps.instagram = async () => { throw new Error('Instagram limit needs attention'); };
  await s.run();
  assert.deepEqual(s.calls, ['record-incomplete']);
  assert.equal(s.result().issue, 'Instagram limit needs attention');
});

test('a reciprocal recipient is verified and authorized before sending', async () => {
  const s = setup(); await s.run();
  assert.deepEqual(s.calls, ['browse', 'navigate', 'verify-follower', 'message-button', 'confirm', 'compose', 'authorize', 'send', 'confirm', 'sent', 'browse', 'record-completed',
  ]);
  assert.equal(s.result().sent, true);
});

test('message variations are resolved once and confirmation uses the exact composed text', async () => {
  const s = setup();
  s.deps.dmTasks = async () => [{ leadId: 'lead', date: '2026-09-21', username: 'alice', fullName: 'Alice Smith', message: '{Hi|Hey} [name], [username]!',
    },
  ];
  let composed = '';
  s.locator.fill = async (text?: string) => { composed = text!; s.calls.push('compose'); };
  const getByText = s.page.getByText;
  s.page.getByText = ((text, options) => {
    if (!String(text).startsWith("This account can't receive")) {
      assert.equal(text, composed);
      assert.equal(text, 'Hi Alice, alice!');
    }
    return getByText(text, options);
  }) as Page['getByText'];
  await s.run();
  assert.equal(composed, 'Hi Alice, alice!');
  assert.equal(s.result().sent, true);
});

for (const message of ['{Hi|Hey', '{|}', 'a'.repeat(990) + '[name]']) {
  test(`an invalid message is dismissed and the session continues (${message.length} characters)`, async () => {
    const s = setup();
    const dismissed: string[] = [], authorized: string[] = [], composed: string[] = [];
    s.deps.dmTasks = async () => [
      { leadId: 'invalid', date: '2026-09-21', username: 'alice', fullName: 'a'.repeat(20), message,
      },
      { leadId: 'valid', date: '2026-09-21', username: 'bob', message: 'Hello [username]' },
    ];
    s.deps.dismissDm = async (_, leadId) => { dismissed.push(leadId); };
    s.deps.begin = async (_, __, leadId) => { authorized.push(leadId); return true; };
    s.locator.fill = async (text?: string) => { composed.push(text!); };
    assert.equal(await s.run(), true);
    assert.deepEqual(dismissed, ['invalid']);
    assert.deepEqual(authorized, ['valid']);
    assert.deepEqual(composed, ['Hello bob']);
    assert.equal(s.calls.filter((call) => call === 'send').length, 1);
    assert.equal(s.result().issue, undefined);
    assert.equal(s.calls.at(-1), 'record-completed');
  });
}

test('non-reciprocal recipients are dismissed without composing a DM', async () => {
  const s = setup(); s.deps.followsUs = async () => false; await s.run();
  assert.ok(s.calls.includes('dismiss-dm')); assert.ok(!s.calls.includes('message-button')); assert.ok(!s.calls.includes('send'));
});

test('no longer following a recipient prevents messaging', async () => {
  const s = setup('dm', 'Follow'); await s.run();
  assert.ok(s.calls.includes('dismiss-dm')); assert.ok(!s.calls.includes('verify-follower')); assert.ok(!s.calls.includes('send'));
});

for (const relationship of ['Following', 'Requested'] as const) test(`existing ${relationship} is never claimed as a new follow`, async () => {
  const s = setup('follow', relationship); await s.run();
  assert.ok(!s.calls.includes('follow')); assert.ok(!s.calls.includes('record-follow')); assert.ok(!s.calls.includes('send'));
});

test('private follow requests are recorded and do not send DMs', async () => {
  const s = setup('follow');
  const original = s.page.locator;
  s.page.locator = ((selector: string) => {
    const controls = original(selector);
    if (selector.includes('="following"')) controls.waitFor = async () => {};
    return controls;
  }) as Page['locator'];
  await s.run(); assert.ok(s.calls.includes('record-follow')); assert.ok(!s.calls.includes('send'));
});

test('an optional like failure does not undo a successful follow', async () => {
  const s = setup('follow'); s.deps.likeRecentPost = async () => { throw new Error('Like missing'); }; await s.run();
  assert.ok(s.calls.includes('record-follow')); assert.equal(s.result().issue, undefined);
});

test('daily notification evidence is recorded before selecting DMs', async () => {
  const s = setup(); s.deps.notifications = async () => ({ date: '2026-09-21', since: 0 });
  const select = s.deps.dmTasks;
  s.deps.dmTasks = async () => { assert.ok(s.calls.includes('record-notifications')); return select('automation', 'profile'); };
  await s.run(); assert.ok(s.calls.includes('sent'));
});

test('an interrupted notification scan is never marked complete', async () => {
  const s = setup(); s.deps.notifications = async () => ({ date: '2026-09-21', since: 0 }); s.deps.readNotifications = async () => null;
  await s.run(); assert.ok(!s.calls.includes('record-notifications'));
});

test('a notification UI timeout skips the scan and continues the profile routine', async () => {
  const s = setup('follow')
  s.deps.notifications = async () => ({ date: '2026-09-21', since: 0 })
  s.deps.readNotifications = async (_page, _stop, _since, session) => {
    assert.ok(session && Number.isFinite(session.end), 'notification scans share the routine deadline')
    throw new errors.TimeoutError('Follows filter timed out')
  }
  await s.run()
  assert.equal(s.result().issue, undefined)
  assert.ok(!s.calls.includes('record-notifications'))
  assert.ok(s.calls.includes('record-follow'))
})

for (const mode of ['dm', 'follow'] as const) test(`temporary ${mode} navigation failure keeps browsing and releases unscreened leases`, async () => {
  const s = setup(mode)
  s.page.goto = async () => { throw new errors.TimeoutError('Recipient navigation timed out') }
  const reserve = s.deps.reserve
  let reserved = false
  s.deps.reserve = async (...args) => { if (reserved) return null; reserved = true; return reserve(...args) }
  let released = 0
  s.deps.finishScreening = async (_automation, _profile, _lead, _token, _date, decision) => {
    assert.equal(decision, undefined); released++; return false
  }
  await s.run()
  assert.equal(s.result().issue, undefined)
  assert.ok(s.calls.filter(call => call === 'browse').length > 1)
  assert.ok(!s.calls.includes('send') && !s.calls.includes('follow'))
  assert.equal(released, mode === 'follow' ? 1 : 0)
})

test('a DM composer failure before Send skips the recipient without claiming delivery', async () => {
  const s = setup()
  s.locator.fill = async () => { throw new errors.TimeoutError('Composer changed') }
  await s.run()
  assert.equal(s.result().issue, undefined)
  assert.ok(!s.calls.includes('send') && !s.calls.includes('sent') && !s.calls.includes('uncertain'))
})

test('recipient navigation recovery still stops at an Instagram checkpoint', async () => {
  const s = setup()
  let failed = false
  s.page.goto = async () => { failed = true; throw new errors.TimeoutError('Navigation timed out') }
  s.deps.instagram = async () => { if (failed) throw new Error('Instagram checkpoint needs attention') }
  await s.run()
  assert.match(s.result().issue ?? '', /checkpoint needs attention/)
  assert.ok(!s.calls.includes('send'))
})

test('a follow click timeout still requires review after input was attempted', async () => {
  const s = setup('follow')
  s.deps.follow = async (_page, allowed, click) => { await allowed(); await click(); throw new errors.TimeoutError('Follow confirmation timed out') }
  await s.run()
  assert.match(s.result().issue ?? '', /Follow confirmation timed out/)
})

test('removed membership prevents all outreach and browsing', async () => {
  const s = setup(); s.deps.ready = async () => false; await s.run(); assert.deepEqual(s.calls, ['record-incomplete']);
});

for (const mode of ['dm', 'follow'] as const) test(`refused authorization stops ${mode}`, async () => {
  const s = setup(mode); s.deps.begin = async () => false; s.deps.beginFollow = async () => false; await s.run();
  assert.ok(!s.calls.includes('send')); assert.ok(!s.calls.includes('follow'));
});

for (const stage of ['navigation', 'composer', 'authorization', 'cleanup'] as const) test(`deadline during ${stage} skips further actions without a delivery issue`, async () => {
  const s = setup();
  if (stage === 'navigation' || stage === 'cleanup') s.page.goto = async () => { await s.deps.sleep(600_000); throw new Error('Timeout'); };
  if (stage === 'cleanup') s.deps.followTasks = async () => [{ leadId: 'lead', username: 'alice' }];
  if (stage === 'composer') s.locator.fill = async () => { await s.deps.sleep(600_000); };
  if (stage === 'authorization') s.deps.begin = async () => { await s.deps.sleep(600_000); return true; };
  await s.run(); assert.ok(!s.calls.includes('send')); assert.ok(!s.calls.includes('uncertain')); assert.equal(s.result().issue, undefined);
});

test('an unconfirmed delivery is recorded once and surfaces an issue', async () => {
  const s = setup(); let confirms = 0;
  s.locator.waitFor = async () => { if (++confirms > 1) throw new Error('Timeout'); };
  await s.run(); assert.equal(s.calls.filter((c) => c === 'send').length, 1); assert.ok(s.calls.includes('uncertain')); assert.match(s.result().issue!, /needs review/);
});

test('blocked messages are unsent and never marked delivered', async () => {
  const s = setup(); s.page.getByText = (() => s.locator) as Page['getByText']; await s.run();
  assert.ok(s.calls.includes('blocked')); assert.equal(s.result().sent, false); assert.equal(s.result().issue, undefined);
});

test('delivery confirmation can finish after the deadline', async () => {
  const s = setup(); s.locator.press = async () => { s.calls.push('send'); await s.deps.sleep(600_000); };
  await s.run(); assert.equal(s.result().sent, true); assert.equal(s.result().issue, undefined);
});

test('a final logging query failure does not flag a completed session', async () => {
  const s = setup(); s.deps.target = async () => { if (s.calls.includes('sent')) throw new Error('Network timeout'); return { target: 0, remaining: 0, sent: 0 }; };
  await s.run(); assert.equal(s.result().issue, undefined); assert.equal(s.calls.at(-1), 'record-completed');
});

test('exhausted browsing budget prevents DM-only, follow-only and cleanup sessions', async () => {
  const s = setup(); s.deps.warmup = async () => ({ minutes: 0, reason: 'skipped' }); s.deps.followTasks = async () => [{ leadId: 'lead', username: 'alice' }];
  await s.run(); assert.deepEqual(s.calls, ['record-incomplete']);
});

test('a login challenge stops all actions and is reported', async () => {
  const s = setup(); s.page.url = () => 'https://www.instagram.com/challenge/'; await s.run();
  assert.deepEqual(s.calls, ['record-incomplete']); assert.match(s.result().issue!, /login or challenge/);
});

test('stopping the browser worker records an incomplete session without blocking the profile', async () => {
  const s = setup(); let stopped = false;
  s.deps.warmup = async () => { stopped = true; throw new Error('Browser worker stopped'); };
  await s.run(() => stopped);
  assert.equal(s.result().issue, undefined);
  assert.deepEqual(s.calls, ['record-incomplete']);
});

test('stopping the worker never hides an uncertain delivery issue', async () => {
  const s = setup(); let stopped = false;
  s.deps.warmup = async () => { stopped = true; throw new Error('Delivery needs review: Browser worker stopped'); };
  await s.run(() => stopped);
  assert.equal(s.result().issue, 'Delivery needs review: Browser worker stopped');
});

test('pending DMs do not need a daily DM allowance', async () => {
  const s = setup(); s.deps.target = async () => ({ target: 0, remaining: 0, sent: 0 });
  s.deps.dmTasks = async () => Array.from({ length: 4 }, (_, i) => ({ leadId: `lead-${i}`, date: '2026-09-21', username: 'alice', message: 'Hello alice',
    }));
  await s.run(); assert.equal(s.calls.filter((c) => c === 'send').length, 4);
})
