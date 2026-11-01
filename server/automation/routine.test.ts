import { visibleActionGeometry } from './actions/action-locator.test-support.js'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';
import { runRoutineSession } from './routine.js';
import { errors } from 'playwright-core';
import { BrowseSession, SessionEnded } from './actions/session.js';
import { currentLogScope, type LogScope } from '../shared/logger.js';
import { DecisionRefusedError } from './actions/openrouter-decision.js';

function setup(mode: 'dm' | 'follow' = 'dm', relationship: 'Follow' | 'Following' | 'Requested' = mode === 'dm' ? 'Following' : 'Follow',
) {
  const calls: string[] = [];
  const events: Record<string, unknown>[] = [];
  let now = 0, sent = false, issue: string | undefined;
  let privateProfile = relationship === 'Requested';
  const attempt = { leadId: 'lead', date: '2026-09-21', username: 'alice', message: 'Hello alice',
    screeningToken: 'screen', isPrivate: undefined as boolean | undefined,
  };
  const locator = {
    first() { return this; }, last() { return this; }, nth() { return this; }, or() { return this; }, filter() { return this; },
    getByRole() { return this; }, getByText() { return this; }, locator() { return this; }, count: async () => 1, ...visibleActionGeometry, hover: async () => {}, isVisible: async () => false,
    page: () => page,
    dispose: async () => {},
    click: async () => { calls.push('message-button'); },
    fill: async (_text: string) => { calls.push('compose'); },
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
    requests: async () => {},
    profileAvailable: async () => true,
    browseLeadPosts: async () => {},
    searchProfile: async () => true,
    screenLead: async () => {
      calls.push('screen')
      return { category: 'male', confidence: 1, model: 'openai/gpt-6-luna-decisions' }
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
    cancelFollow: async () => { calls.push('cancel-follow'); },
    checkNotifications: async () => false,
    dmTasks: async () => (mode === 'dm' ? [attempt] : []),
    inspectProfile: async () => { calls.push('check-message'); return { isPrivate: privateProfile,
      canMessage: !privateProfile && relationship !== 'Requested' }; },
    openMessage: async () => { calls.push('message-button'); await locator.waitFor(); return locator as unknown as Locator; },
    messageHistory: async () => ({ ownUsername: 'self', hasOwnMessage: false, threadId: undefined }),
    recordExistingDm: async () => { calls.push('existing-dm'); return true; },
    typeMessage: async (_composer, text) => { await locator.fill(text); },
    sendMessage: async () => { await locator.press(); },
    closeMessage: async () => { calls.push('close-message'); },
    notifications: async () => null,
    recordNotifications: async () => ({ ok: true }),
    readNotifications: async () => [],
    reserve: async () => { calls.push('reserve'); return attempt; },
    begin: async () => { calls.push('authorize'); return true; },
    finish: async (_, __, ___, value, blocked) => { calls.push(value ? 'sent' : blocked ? 'blocked' : 'uncertain'); sent = value; },
    record: async (_, __, completed, error) => { calls.push(completed ? 'record-completed' : 'record-incomplete'); issue = error; },
    session: async (_p, _a, _c, _page, _log, stopped, _deps, activity, startupNotifications) => {
      await startupNotifications?.(new BrowseSession(now + 600_000, stopped), 8);
      const result = await activity!({ deadline: now + 600_000, remainingMinutes: 10,
        browse: async (minutes) => { calls.push('browse'); now += minutes * 60_000; return 'finished'; },
      });
      return { minutes: 10, reason: stopped() || result === 'stopped' ? 'stopped' : 'finished' };
    },
  };
  const automation = { _id: 'automation', name: 'Daily', nodes: [], edges: [], routine: { headless: true, activity: {} },
  };
  const run = (stopped = () => false) => runRoutineSession(automation, 'profile', page, event => { events.push(event); }, stopped, deps);
  return { calls, events, deps, page, locator, attempt, run, setPrivate: (value: boolean) => { privateProfile = value; },
    setRelationship: (value: typeof relationship) => { relationship = value; }, result: () => ({ sent, issue }) };
}

test('unavailable cleanup leads are marked unfollowed while the next cleanup and new outreach continue', async () => {
  const s = setup('follow');
  s.deps.followTasks = async () => [{ leadId: 'missing', username: 'cal74_grand' }, { leadId: 'known', username: 'bob' }];
  let checks = 0;
  s.deps.profileAvailable = async () => checks++ !== 0;
  const recorded: { leadId: string; followed: boolean }[] = [];
  s.deps.recordFollow = async (_profile, leadId, followed) => { recorded.push({ leadId, followed }); };
  await s.run();
  assert.deepEqual(recorded, [{ leadId: 'missing', followed: false }, { leadId: 'known', followed: false }, { leadId: 'lead', followed: true }]);
  assert.ok(s.calls.includes('browse'));
  assert.equal(s.result().issue, undefined);
  assert.ok(s.events.some(event => event.targetUsername === 'cal74_grand' &&
    event.event === 'automation.routine.unfollowed' && event.kind === 'unfollow' && event.reason === 'profile_unavailable'));
});

for (const mode of ['follow', 'dm'] as const) test(`unavailable ${mode} recipients skip screening and interaction without stopping browsing`, async () => {
  const s = setup(mode);
  s.deps.profileAvailable = async () => false;
  let claimed = false;
  s.deps.reserve = async () => {
    s.calls.push('reserve');
    if (claimed) return null;
    claimed = true;
    return s.attempt;
  };
  await s.run();
  for (const action of ['screen', 'check-message', 'authorize-follow', 'follow', 'authorize', 'message-button', 'compose', 'send', 'record-unfollow'])
    assert.ok(!s.calls.includes(action), action);
  assert.equal(s.calls.filter(call => call === 'screen-saved').length, mode === 'follow' ? 1 : 0);
  assert.ok(s.calls.includes('browse'));
  assert.deepEqual(s.result(), { sent: false, issue: undefined });
  assert.ok(s.events.some(event => event.targetUsername === 'alice' && event.reason === 'profile_unavailable'));
});

test('stopping while an unavailable profile loads prevents subsequent cleanup and outreach', async () => {
  const s = setup('follow');
  let stopped = false;
  s.deps.followTasks = async () => [{ leadId: 'missing', username: 'alice' }, { leadId: 'next', username: 'bob' }];
  s.deps.profileAvailable = async () => { stopped = true; return false; };
  await s.run(() => stopped);
  assert.equal(s.calls.filter(call => call === 'navigate').length, 1);
  assert.ok(!s.calls.includes('record-unfollow'));
  assert.ok(!s.calls.includes('reserve'));
  assert.equal(s.result().issue, undefined);
});

test('a cleanup navigation to a login challenge still stops the session', async () => {
  const s = setup();
  s.deps.followTasks = async () => [{ leadId: 'lead', username: 'alice' }];
  s.page.goto = async () => { s.page.url = () => 'https://www.instagram.com/challenge/'; };
  s.deps.instagram = async () => { if (s.page.url().includes('/challenge/')) throw new Error('Instagram login challenge'); };
  s.deps.profileAvailable = async () => { throw new Error('Must check login before loading a profile'); };
  await s.run();
  assert.match(s.result().issue ?? '', /login challenge/);
  assert.ok(!s.calls.includes('record-unfollow'));
  assert.ok(!s.calls.includes('message-button'));
});

test('a new public lead is followed without sending a DM', async () => {
  const s = setup('follow'); await s.run();
  assert.deepEqual(s.calls.filter(c => !['browse', 'record-completed'].includes(c)),
    ['reserve', 'navigate', 'screen', 'screen-saved', 'check-message', 'authorize-follow', 'follow', 'record-follow']);
  assert.equal(s.result().sent, false);
});

for (const stored of [undefined, false, true]) for (const livePrivate of [false, true]) {
  test(`live privacy overrides stored ${stored} privacy for ${livePrivate ? 'private' : 'public'} outreach`, async () => {
    const s = setup('follow')
    s.attempt.isPrivate = stored
    s.setPrivate(livePrivate)
    s.deps.random = (min, max) => min === 0 && max === 1 ? 0.9 : min
    s.deps.browseLeadPosts = async () => { s.calls.push('lead-posts') }
    await s.run()
    assert.equal(s.calls.includes('follow'), true)
    assert.equal(s.calls.includes('send'), false)
    assert.equal(s.calls.includes('lead-posts'), !livePrivate)
    assert.equal(s.result().issue, undefined)
  })
}

test('public lead posts are browsed once before following, without a DM', async () => {
  const s = setup('follow');
  s.deps.browseLeadPosts = async (page, username) => {
    assert.equal(page, s.page); assert.equal(username, 'alice'); s.calls.push('lead-posts');
  };
  await s.run();
  assert.ok(s.calls.indexOf('lead-posts') > s.calls.indexOf('screen-saved'));
  assert.ok(s.calls.indexOf('lead-posts') < s.calls.indexOf('follow'));
  assert.equal(s.calls.filter(c => c === 'lead-posts').length, 1);
  assert.equal(s.calls.filter(c => c === 'navigate').length, 1);
  assert.ok(!s.calls.includes('message-button') && !s.calls.includes('send'));
  assert.equal(s.result().issue, undefined);
});

test('DM activity never invokes lead post browsing', async () => {
  const s = setup('dm')
  s.deps.browseLeadPosts = async () => { throw new Error('Only new lead Follow visits may browse posts') }
  await s.run(); assert.ok(s.calls.includes('sent')); assert.equal(s.result().issue, undefined)
})

for (const relationship of ['Following', 'Follow'] as const) test(`a manual outgoing DM is saved before typing (${relationship})`, async () => {
  const s = setup('dm', relationship)
  s.deps.messageHistory = async () => ({ ownUsername: 'self', hasOwnMessage: true, threadId: '123' })
  s.deps.recordExistingDm = async args => {
    assert.deepEqual(args, { automationId: 'automation', profileId: 'profile', username: 'alice', threadId: '123' })
    s.calls.push('existing-dm'); return true
  }
  await s.run()
  assert.ok(s.calls.includes('existing-dm') && s.calls.includes('close-message') && s.calls.includes('browse'))
  for (const call of ['compose', 'authorize', 'send', 'sent']) assert.ok(!s.calls.includes(call), call)
  assert.equal(s.result().issue, undefined)
})

test('failure to save a detected manual DM never falls through to Send', async () => {
  const s = setup('dm')
  s.deps.messageHistory = async () => ({ ownUsername: 'self', hasOwnMessage: true, threadId: undefined })
  s.deps.recordExistingDm = async () => { throw new Error('Existing DM save unavailable') }
  await s.run()
  assert.match(s.result().issue ?? '', /Existing DM save unavailable/)
  for (const call of ['compose', 'authorize', 'send']) assert.ok(!s.calls.includes(call), call)
})

test('rejected leads never browse posts or Like them', async () => {
  const s = setup('follow')
  s.deps.finishScreening = async () => false
  s.deps.browseLeadPosts = async () => { s.calls.push('lead-posts') }
  await s.run(); assert.ok(!s.calls.includes('lead-posts')); assert.ok(!s.calls.includes('follow'))
})

test('optional public post UI errors preserve following and the session', async () => {
  const s = setup('follow')
  s.deps.browseLeadPosts = async () => { s.calls.push('lead-posts'); throw new errors.TimeoutError('Viewer failed to close') }
  await s.run()
  assert.ok(s.calls.includes('follow')); assert.ok(!s.calls.includes('send'))
  assert.equal(s.calls.filter(c => c === 'navigate').length, 2, 'recover the exact lead profile only after an error')
  assert.equal(s.result().issue, undefined)
})

test('cancellation while browsing a lead prevents subsequent Follow authorization', async () => {
  const s = setup('follow')
  let stopped = false
  s.deps.browseLeadPosts = async () => { stopped = true; throw new SessionEnded('Stopped') }
  await s.run(() => stopped)
  assert.ok(!s.calls.includes('authorize-follow')); assert.ok(!s.calls.includes('follow'))
})

test('saved interest interpretations reach browsing, and clearing tags does not restore old topics', async () => {
  for (const interests of [
    [{ label: 'ecom', description: 'E-commerce income tutorials.' }, { label: 'fishing', description: 'Fishing trips.' }], [],
  ]) {
    const s = setup()
    s.deps.session = async (_profile, _automation, config) => {
      assert.deepEqual(config.warmup_topics, interests.map(interest => interest.description))
      return { minutes: 0, reason: 'skipped' }
    }
    await runRoutineSession({ _id: 'automation', name: 'Interest routine', nodes: [], edges: [],
      routine: { headless: true, activity: { warmup_topics: 'Old description' }, interests } },
      'profile', s.page, () => {}, () => false, s.deps)
  }
})

test('each lead retains navigation, screening and follow timings in its own completed event', async () => {
  const s = setup('follow');
  s.setPrivate(true);
  let scope: LogScope | undefined;
  const navigate = s.page.goto.bind(s.page), screen = s.deps.screenLead, follow = s.deps.follow;
  s.page.goto = async (url, options) => { await s.deps.sleep(400); return navigate(url, options); };
  s.deps.screenLead = async (...args) => {
    scope = currentLogScope();
    await s.deps.sleep(1250);
    return screen(...args);
  };
  s.deps.follow = async (...args) => { await s.deps.sleep(250); return follow(...args); };
  await s.run();
  assert.ok(scope?.completed);
  assert.equal(scope.event, 'automation.recipient_session');
  assert.equal(scope.fields.targetUsername, 'alice');
  assert.equal(scope.fields.navigationMs, 400);
  assert.equal(scope.fields.screeningMs, 1250);
  assert.equal(scope.fields.followMs, 250);
  assert.equal(scope.fields.followed, true);
});

test('selected known public leads open through Search once before screening and following', async () => {
  const s = setup('follow')
  s.attempt.isPrivate = false
  s.deps.searchProfile = async (_page, username) => { assert.equal(username, 'alice'); s.calls.push('search'); return true }
  await s.run()
  assert.ok(s.calls.indexOf('search') < s.calls.indexOf('screen'))
  assert.ok(s.calls.indexOf('search') < s.calls.indexOf('follow'))
  assert.ok(!s.calls.includes('send'))
  assert.equal(s.calls.filter(c => c === 'navigate').length, 0)
  assert.equal(s.calls.filter(c => c === 'search').length, 1)
})

for (const isPrivate of [undefined, true, false]) test(`private/unknown or unselected public leads keep the direct route (${isPrivate})`, async () => {
  const s = setup('follow')
  s.attempt.isPrivate = isPrivate
  if (isPrivate === false) s.deps.random = (min, max) => min === 0 && max === 1 ? 0.9 : min
  s.deps.searchProfile = async () => { throw new Error('Should not search this profile') }
  await s.run()
  assert.ok(s.calls.includes('follow')); assert.ok(!s.calls.includes('send'))
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
    assert.deepEqual(s.calls.slice(s.calls.indexOf('search'), s.calls.indexOf('check-message') + 1), ['search', 'navigate', 'screen', 'screen-saved', 'check-message'])
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
    return { category: 'female', confidence: 0.95, model: 'liquid/d1-ultra' }
  }
  s.deps.finishScreening = async (_a, _p, _l, _token, _date, decision) => {
    assert.equal(decision?.category, 'female')
    assert.equal(decision?.model, 'liquid/d1-ultra')
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

test('a provider refusal marks the lead terminal without approving, following or stopping browsing', async () => {
  const s = setup('follow')
  let scope: LogScope | undefined
  const reserve = s.deps.reserve
  let reserved = false
  s.deps.reserve = async (...args) => {
    if (reserved) return null
    reserved = true
    return reserve(...args)
  }
  s.deps.screenLead = async () => {
    scope = currentLogScope()
    throw new DecisionRefusedError('Provider refused to answer')
  }
  s.deps.finishScreening = async (_a, _p, _lead, _token, _date, decision, failureReason) => {
    assert.equal(decision, undefined)
    assert.equal(failureReason, 'refused')
    s.calls.push('refusal-saved')
    return false
  }
  await s.run()
  assert.ok(s.calls.includes('refusal-saved'))
  assert.equal(s.calls.filter(call => call === 'refusal-saved').length, 1)
  assert.ok(!s.calls.includes('authorize-follow') && !s.calls.includes('follow') && !s.calls.includes('optional-like'))
  assert.equal(s.result().issue, undefined)
  assert.ok(s.calls.filter(call => call === 'browse').length > 1)
  assert.equal(scope?.fields.outcome, 'rejected')
  assert.equal(scope?.fields.result, 'screening_refused')
})

test('before maintenance the routine only browses, even when ready lead and DM mocks are available', async () => {
  const s = setup('follow');
  s.deps.session = async (_p, _a, _c, _page, _log, _stopped, _deps, activity) => {
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
  s.deps.session = async (_p, _a, _c, _page, _log, _stopped, _deps, activity) => {
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

test('an existing followed recipient is checked and authorized before sending', async () => {
  const s = setup(); await s.run();
  assert.deepEqual(s.calls, ['browse', 'navigate', 'message-button', 'confirm', 'compose', 'authorize', 'send', 'confirm', 'confirm', 'sent', 'close-message', 'browse', 'record-completed',
  ]);
  assert.equal(s.result().sent, true);
});

test('a multi-message outreach authorizes once and confirms a new bubble for repeated text', async () => {
  const s = setup(), drafts: string[] = [], positions: number[] = []
  s.attempt.message = 'Hello alice / Hello alice'
  let delivered = 0
  s.locator.count = async () => delivered
  s.locator.nth = (index: number) => ({ ...s.locator, waitFor: async () => {
    positions.push(index); assert.ok(delivered > index, 'require another outgoing message')
  } })
  s.deps.typeMessage = async (_editor, text) => { drafts.push(text) }
  s.deps.sendMessage = async () => { s.calls.push('send'); delivered++ }
  await s.run()
  assert.deepEqual(drafts, ['Hello alice', 'Hello alice'])
  assert.deepEqual(positions, [0, 0, 1, 1])
  assert.equal(s.calls.filter(c => c === 'authorize').length, 1)
  assert.equal(s.calls.filter(c => c === 'send').length, 2)
  assert.equal(s.calls.filter(c => c === 'sent').length, 1)
  assert.equal(s.result().issue, undefined)
})

for (const interruption of ['failure', 'stop'] as const) test(`a ${interruption} after the first outreach message keeps the sequence claimed for review`, async () => {
  const s = setup()
  s.attempt.message = 'Hello alice / How are you? / Third message'
  let attempts = 0, stopped = false
  s.deps.sendMessage = async () => {
    s.calls.push('send')
    if (++attempts === 2) throw new Error('Connection reset')
    if (interruption === 'stop') stopped = true
  }
  await s.run(() => stopped)
  assert.equal(attempts, interruption === 'stop' ? 1 : 2)
  assert.equal(s.calls.filter(c => c === 'authorize').length, 1)
  assert.ok(s.calls.includes('uncertain') && !s.calls.includes('sent'))
  assert.match(s.result().issue ?? '', /Delivery needs review/)
})

for (const finishFails of [false, true]) test(`stopping after DM authorization finalizes the claim (finish fails: ${finishFails})`, async () => {
  const s = setup();
  let stopped = false;
  s.deps.begin = async () => { s.calls.push('authorize'); stopped = true; return true; };
  const finish = s.deps.finish;
  s.deps.finish = async (...args) => {
    await finish(...args);
    if (finishFails) throw new Error('Save failed');
  };
  await s.run(() => stopped);
  assert.equal(s.calls.filter(call => call === 'uncertain').length, 1);
  assert.ok(!s.calls.includes('send'));
  assert.match(s.result().issue!, /Delivery authorization needs review/);
});

for (const finishFails of [false, true]) test(`a lost DM authorization response is reconciled without sending (finish fails: ${finishFails})`, async () => {
  const s = setup();
  s.deps.begin = async () => { s.calls.push('authorize'); throw new TypeError('Authorization response lost'); };
  const finish = s.deps.finish;
  s.deps.finish = async (...args) => {
    await finish(...args);
    if (finishFails) throw new Error('No authorization found');
  };
  await s.run();
  assert.equal(s.calls.filter(call => call === 'authorize').length, 1);
  assert.equal(s.calls.filter(call => call === 'uncertain').length, 1);
  assert.ok(!s.calls.includes('send'));
  assert.match(s.result().issue!, /Delivery authorization needs review/);
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
  test(`an invalid message is skipped and the session continues (${message.length} characters)`, async () => {
    const s = setup();
    const authorized: string[] = [], composed: string[] = [];
    s.deps.dmTasks = async () => [
      { leadId: 'invalid', date: '2026-09-21', username: 'alice', fullName: 'a'.repeat(20), message,
      },
      { leadId: 'valid', date: '2026-09-21', username: 'bob', message: 'Hello [username]' },
    ];
    s.deps.begin = async (_, __, leadId) => { authorized.push(leadId); return true; };
    s.locator.fill = async (text?: string) => { composed.push(text!); };
    assert.equal(await s.run(), true);
    assert.deepEqual(authorized, ['valid']);
    assert.deepEqual(composed, ['Hello bob']);
    assert.equal(s.calls.filter((call) => call === 'send').length, 1);
    assert.equal(s.result().issue, undefined);
    assert.equal(s.calls.at(-1), 'record-completed');
  });
}

test('a follow-back DM opens the chat without loading private posts', async () => {
  const s = setup(); s.setPrivate(true);
  s.deps.inspectProfile = async () => { throw new Error('DMs do not inspect profile posts') };
  await s.run();
  assert.ok(s.calls.includes('message-button') && s.calls.includes('send'));
  assert.equal(s.result().issue, undefined);
});

test('a saved follow-back can receive a DM after we unfollowed them', async () => {
  const s = setup('dm', 'Follow'); await s.run();
  assert.ok(s.calls.includes('send') && !s.calls.includes('follow'));
  assert.equal(s.result().issue, undefined);
});

test('a follow-back notification permits a DM without opening the Following list', async () => {
  const s = setup();
  s.page.getByRole = (() => { throw new Error('Following-list dialogs must not be opened'); }) as Page['getByRole'];
  await s.run();
  assert.ok(s.calls.includes('send') && s.calls.includes('close-message'));
  assert.equal(s.result().issue, undefined);
});

test('every queued DM checks our message history and an existing manual reply skips only that recipient', async () => {
  const s = setup();
  const inspected: string[] = [];
  s.deps.dmTasks = async () => [s.attempt, { ...s.attempt, leadId: 'second', username: 'bob' },
    { ...s.attempt, leadId: 'third', username: 'carol' }];
  s.deps.messageHistory = async (_page, username) => {
    inspected.push(username);
    return { ownUsername: 'self', hasOwnMessage: username === 'bob', threadId: undefined };
  };
  await s.run();
  assert.deepEqual(inspected, ['alice', 'bob', 'carol']);
  assert.equal(s.calls.filter(call => call === 'sent').length, 2);
  assert.equal(s.calls.filter(call => call === 'existing-dm').length, 1);
  assert.equal(s.result().issue, undefined);
});

test('notification DMs and new follows share the session without a follow-back lookup', async () => {
  const s = setup('follow');
  s.deps.dmTasks = async () => [s.attempt];
  // A DM is for an existing followed lead; new outreach still starts from Follow.
  s.deps.inspectProfile = async () => {
    s.setRelationship(s.calls.includes('reserve') ? 'Follow' : 'Following');
    return { isPrivate: false, canMessage: true };
  };
  await s.run();
  assert.ok(s.calls.includes('follow'));
  assert.ok(s.calls.includes('sent'));
  assert.equal(s.result().issue, undefined);
});

test('a stop while loading DM tasks does not continue with DMs or follows', async () => {
  const s = setup('follow'); let stopped = false;
  s.deps.dmTasks = async () => { stopped = true; return [s.attempt]; };
  await s.run(() => stopped);
  assert.ok(!s.calls.includes('sent') && !s.calls.includes('follow') && !s.calls.includes('reserve'));
  assert.equal(s.result().issue, undefined);
});

for (const engagement of ['like', 'comment'] as const) test(`saved ${engagement} flags cannot bypass final DM authorization`, async () => {
  const s = setup('dm', 'Requested');
  s.deps.dmTasks = async () => [{ ...s.attempt, engagement }];
  s.deps.begin = async () => { s.calls.push('authorize'); return false; };
  await s.run();
  assert.ok(s.calls.includes('authorize'));
  assert.ok(!s.calls.includes('send') && !s.calls.includes('follow'));
});

for (const relationship of ['Following', 'Requested'] as const) test(`existing ${relationship} is never claimed as a new follow`, async () => {
  const s = setup('follow', relationship); await s.run();
  assert.ok(!s.calls.includes('follow')); assert.ok(!s.calls.includes('record-follow'));
  assert.ok(!s.calls.includes('send'));
});

test('private follow requests are recorded but never messaged before approval', async () => {
  const s = setup('follow');
  s.setPrivate(true);
  s.deps.browseLeadPosts = async () => { throw new Error('Private profiles must not browse posts'); };
  s.deps.follow = async (_page, allowed, click, confirmed) => {
    if (!await allowed()) return false;
    await click(); s.setRelationship('Requested'); await confirmed(); return true;
  };
  await s.run(); assert.ok(s.calls.includes('record-follow')); assert.ok(s.calls.includes('check-message'));
  assert.ok(!s.calls.includes('send')); assert.equal(s.result().issue, undefined);
});

test('a recorded follow-back can open a chat even while our own follow request is pending', async () => {
  const s = setup('dm', 'Requested'); await s.run();
  assert.ok(s.calls.includes('navigate') && s.calls.includes('message-button'));
  assert.ok(s.calls.includes('send')); assert.equal(s.result().issue, undefined);
});

for (const relationship of ['Follow', 'Following', 'Requested'] as const) {
  test(`saved follow-back DM candidates do not follow again (${relationship})`, async () => {
    const s = setup('dm', relationship);
    s.setPrivate(true);
    s.deps.beginFollow = async () => { s.calls.push('authorize-follow'); throw new Error('DM revisits must not reserve follow quota'); };
    s.deps.follow = async () => { throw new Error('DM revisits must not follow'); };
    await s.run();
    assert.ok(!s.calls.includes('check-message'));
    assert.ok(!s.calls.includes('authorize-follow') && !s.calls.includes('follow') && !s.calls.includes('record-follow'));
    assert.ok(s.calls.includes('message-button') && s.calls.includes('send'));
    assert.equal(s.result().issue, undefined);
    assert.equal(s.calls.at(-1), 'record-completed');
  });
}

test('startup uses a brief notification visit when no follow-back scan is due', async () => {
  const s = setup(); let visits = 0;
  s.deps.checkNotifications = async () => { visits++; return true; };
  await s.run(); assert.equal(visits, 1); assert.ok(s.calls.includes('sent'));
});

for (const fails of [false, true]) test(`follow cancellation errors are logged without replacing the lead result (original error=${fails})`, async () => {
  const s = setup('follow');
  const original = new Error('Original follow failure'), cleanup = new Error('Cancellation save failed');
  s.deps.follow = async () => { if (fails) throw original; return false; };
  s.deps.cancelFollow = async () => { throw cleanup; };
  await s.run();
  assert.equal(s.result().issue, fails ? original.message : undefined);
  const entry = s.events.find(event => event.event === 'automation.routine.follow_cancellation_failed');
  assert.equal(entry?.error, cleanup);
  assert.equal(entry?.leadId, 'lead');
});

for (const boundary of ['after claim', 'before input', 'after input'] as const) test(`follow intent cancellation at ${boundary}`, async () => {
  const s = setup('follow');
  let stopped = false, token = '';
  s.deps.beginFollow = async (_a, _p, _lead, _date, attemptId) => {
    token = attemptId;
    if (boundary === 'after claim') stopped = true;
    return true;
  };
  s.deps.cancelFollow = async (_p, _lead, attemptId) => {
    assert.equal(attemptId, token);
    s.calls.push('cancel-follow');
  };
  s.deps.follow = async (_page, _allowed, click) => {
    if (boundary === 'before input') { stopped = true; return false; }
    await click();
    stopped = true;
    throw new Error('Input result unknown');
  };
  await s.run(() => stopped);
  assert.equal(s.calls.includes('cancel-follow'), boundary !== 'after input');
});

test('a due follow-back scan queues discovered DMs before activity starts', async () => {
  const s = setup();
  let discovered = false;
  s.deps.notifications = async () => ({ date: s.attempt.date, since: 123 });
  s.deps.checkNotifications = async () => { throw new Error('A full scan replaces the brief visit'); };
  s.deps.readNotifications = async (_page, _stopped, since) => {
    assert.equal(since, 123); s.calls.push('read-notifications'); return [{ username: 'alice', kind: 'follow' }];
  };
  s.deps.recordNotifications = async (_a, _p, date, names) => {
    assert.equal(date, s.attempt.date); assert.deepEqual(names, [{ username: 'alice', kind: 'follow' }]);
    discovered = true; s.calls.push('record-notifications');
    return { ok: true };
  };
  s.deps.dmTasks = async () => discovered ? [s.attempt] : [];
  await s.run();
  assert.ok(s.calls.indexOf('read-notifications') < s.calls.indexOf('record-notifications'));
  assert.ok(s.calls.indexOf('record-notifications') < s.calls.indexOf('message-button'));
  assert.ok(s.calls.includes('sent'));
});

for (const result of [null, new errors.TimeoutError('Notifications loading')]) test(`incomplete follow-back scans stay retryable (${String(result)})`, async () => {
  const s = setup('follow');
  s.deps.notifications = async () => ({ date: s.attempt.date, since: 0 });
  s.deps.readNotifications = async () => { if (result instanceof Error) throw result; return result; };
  s.deps.recordNotifications = async () => { throw new Error('Incomplete scans must not be recorded'); };
  await s.run();
  assert.ok(s.calls.includes('follow'));
  assert.equal(s.result().issue, undefined);
});

test('week-one startup keeps the brief notification visit without outreach', async () => {
  const s = setup('follow'); let visits = 0;
  s.deps.checkNotifications = async () => { visits++; return true; };
  s.deps.session = async (_p, _a, _c, _page, _log, stopped, _deps, activity, startupNotifications) => {
    await startupNotifications?.(new BrowseSession(600_000, stopped), 7);
    const reason = await activity!({ deadline: 600_000, day: 7, remainingMinutes: 10,
      browse: async minutes => { await s.deps.sleep(minutes * 60_000); return 'finished'; },
    });
    return { minutes: 10, reason };
  };
  await s.run(); assert.equal(visits, 1); assert.ok(!s.calls.includes('reserve') && !s.calls.includes('send'));
});

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
  s.setPrivate(true)
  s.deps.follow = async (_page, allowed, click) => { await allowed(); await click(); throw new errors.TimeoutError('Follow confirmation timed out') }
  await s.run()
  assert.match(s.result().issue ?? '', /Follow confirmation timed out/)
})

test('removed membership prevents all outreach and browsing', async () => {
  const s = setup(); s.deps.ready = async () => false; await s.run(); assert.deepEqual(s.calls, ['record-incomplete']);
});

for (const mode of ['dm', 'follow'] as const) test(`refused authorization stops ${mode}`, async () => {
  const s = setup(mode); if (mode === 'follow') s.setPrivate(true);
  s.deps.begin = async () => false; s.deps.beginFollow = async () => false; await s.run();
  assert.ok(!s.calls.includes('send')); assert.ok(!s.calls.includes('follow'));
});

for (const stage of ['navigation', 'composer', 'authorization', 'cleanup'] as const) test(`deadline during ${stage} prevents further input and reconciles any DM claim`, async () => {
  const s = setup();
  if (stage === 'navigation' || stage === 'cleanup') s.page.goto = async () => { await s.deps.sleep(600_000); throw new Error('Timeout'); };
  if (stage === 'cleanup') s.deps.followTasks = async () => [{ leadId: 'lead', username: 'alice' }];
  if (stage === 'composer') s.locator.fill = async () => { await s.deps.sleep(600_000); };
  if (stage === 'authorization') s.deps.begin = async () => { await s.deps.sleep(600_000); return true; };
  await s.run(); assert.ok(!s.calls.includes('send'));
  assert.equal(s.calls.includes('uncertain'), stage === 'authorization');
  if (stage === 'authorization') assert.match(s.result().issue!, /Delivery authorization needs review/);
  else assert.equal(s.result().issue, undefined);
});

test('an unconfirmed delivery is recorded once and surfaces an issue', async () => {
  const s = setup(); let confirms = 0;
  s.locator.waitFor = async () => { if (++confirms > 1) throw new Error('Timeout'); };
  await s.run(); assert.equal(s.calls.filter((c) => c === 'send').length, 1); assert.ok(s.calls.includes('uncertain')); assert.match(s.result().issue!, /needs review/);
});

test('blocked messages are recorded and closed without Unsend or retry', async () => {
  const s = setup();
  let scope: LogScope | undefined;
  const send = s.deps.sendMessage;
  s.deps.sendMessage = async (...args) => { scope = currentLogScope(); await send(...args); };
  s.page.getByText = (() => s.locator) as Page['getByText'];
  s.page.getByRole = () => { throw new Error('Blocked messages must not open message actions'); };
  await s.run();
  assert.equal(s.calls.filter(call => call === 'send').length, 1);
  assert.equal(s.calls.filter(call => call === 'blocked').length, 1);
  assert.equal(s.calls.filter(call => call === 'close-message').length, 1);
  assert.ok(s.calls.indexOf('blocked') < s.calls.indexOf('close-message'));
  assert.equal(s.result().sent, false);
  assert.equal(s.result().issue, undefined);
  assert.equal(s.calls.at(-1), 'record-completed');
  assert.equal(scope?.fields.outcome, 'rejected');
  assert.equal(scope?.fields.result, 'dm_blocked');
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
  const s = setup(); s.deps.session = async () => ({ minutes: 0, reason: 'skipped' }); s.deps.followTasks = async () => [{ leadId: 'lead', username: 'alice' }];
  await s.run(); assert.deepEqual(s.calls, ['record-incomplete']);
});

test('a login challenge stops all actions and is reported', async () => {
  const s = setup(); s.page.url = () => 'https://www.instagram.com/challenge/'; await s.run();
  assert.deepEqual(s.calls, ['record-incomplete']); assert.match(s.result().issue!, /login or challenge/);
});

test('stopping the browser worker records an incomplete session without blocking the profile', async () => {
  const s = setup(); let stopped = false;
  s.deps.session = async () => { stopped = true; throw new Error('Browser worker stopped'); };
  await s.run(() => stopped);
  assert.equal(s.result().issue, undefined);
  assert.deepEqual(s.calls, ['record-incomplete']);
});

test('stopping the worker never hides an uncertain delivery issue', async () => {
  const s = setup(); let stopped = false;
  s.deps.session = async () => { stopped = true; throw new Error('Delivery needs review: Browser worker stopped'); };
  await s.run(() => stopped);
  assert.equal(s.result().issue, 'Delivery needs review: Browser worker stopped');
});

test('stopping during Send keeps an uncertain delivery classified as an error', async () => {
  const s = setup();
  let stopped = false;
  let scope: LogScope | undefined;
  s.deps.sendMessage = async () => {
    scope = currentLogScope();
    s.calls.push('send');
    stopped = true;
    throw new Error('Send transport failed');
  };
  await s.run(() => stopped);
  assert.equal(s.calls.filter(call => call === 'send').length, 1);
  assert.equal(s.calls.filter(call => call === 'uncertain').length, 1);
  assert.match(s.result().issue ?? '', /Delivery needs review: Send transport failed/);
  assert.equal(scope?.fields.outcome, 'error');
});

test('stopping before Send keeps the cancelled outcome', async () => {
  const s = setup();
  let stopped = false;
  let scope: LogScope | undefined;
  s.deps.typeMessage = async () => {
    scope = currentLogScope();
    stopped = true;
  };
  await s.run(() => stopped);
  assert.ok(!s.calls.includes('send') && !s.calls.includes('uncertain'));
  assert.equal(s.result().issue, undefined);
  assert.equal(scope?.fields.outcome, 'cancelled');
});

test('pending DMs do not need a daily DM allowance', async () => {
  const s = setup(); s.deps.target = async () => ({ target: 0, remaining: 0, sent: 0 });
  s.deps.dmTasks = async () => Array.from({ length: 4 }, (_, i) => ({ leadId: `lead-${i}`, date: '2026-09-21', username: 'alice', message: 'Hello alice',
    }));
  await s.run(); assert.equal(s.calls.filter((c) => c === 'send').length, 4);
})


test('a temporary public composer failure preserves browsing and never claims a send', async () => {
  const s = setup('dm');
  s.locator.fill = async () => { throw new errors.TimeoutError('Composer changed'); };
  await s.run();
  assert.ok(!s.calls.includes('record-follow'));
  assert.ok(!s.calls.includes('authorize') && !s.calls.includes('send'));
  assert.equal(s.result().issue, undefined);
});

test('denied Send authorization closes the draft without sending', async () => {
  const s = setup(); s.deps.begin = async () => false;
  await s.run();
  assert.ok(s.calls.includes('compose') && s.calls.includes('close-message'));
  assert.ok(!s.calls.includes('send'));
});

test('a surviving DM popup stops browsing without changing a confirmed delivery to uncertain', async () => {
  const s = setup();
  s.deps.closeMessage = async () => { throw new errors.TimeoutError('Close unavailable'); };
  await s.run();
  assert.equal(s.result().sent, true);
  assert.ok(!s.calls.includes('uncertain'));
  assert.match(s.result().issue ?? '', /popup could not be closed/);
  assert.ok(!s.calls.slice(s.calls.indexOf('sent') + 1).includes('browse'));
});

test('cleanup errors never replace the primary uncertain-delivery error', async () => {
  const s = setup();
  s.deps.sendMessage = async () => { s.calls.push('send'); throw new Error('Send transport failed'); };
  s.deps.closeMessage = async () => { throw new errors.TimeoutError('Close failed too'); };
  await s.run();
  assert.equal(s.calls.filter(c => c === 'send').length, 1);
  assert.ok(s.calls.includes('uncertain'));
  assert.match(s.result().issue ?? '', /Delivery needs review: Send transport failed/);
});
