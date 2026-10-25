import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { diagnosticControls } from './ui-diagnostics.js'

function events(code: string) {
  const raw = execFileSync('bun', ['--eval', `
    import assert from 'node:assert/strict';
    import { logOperation } from './server/shared/logger.ts';
    import { observeAutomationUi } from './server/automation/actions/observe-ui.ts';
    import { observationFixture } from './server/automation/actions/observe-ui.test-support.ts';
    ${code}
  `], { cwd: process.cwd(), encoding: 'utf8' })
  return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('all automation input surfaces and waits log rejected calls, including swallowed failures', () => {
  const logs = events(`
    const actions = [
      p => p.getByRole('button').click({timeout:10}),
      p => p.getByRole('button').dblclick({timeout:10}),
      p => p.getByRole('textbox').fill('private-message', {timeout:10}),
      p => p.getByRole('button').hover({timeout:10}),
      p => p.getByRole('button').press('Enter', {timeout:10}),
      p => p.getByRole('checkbox').setChecked(true, {timeout:10}),
      p => p.getByRole('combobox').selectOption('private-option', {timeout:10}),
      p => p.locator('input').setInputFiles('private-path', {timeout:10}),
      p => p.getByRole('dialog').waitFor({state:'visible',timeout:10}),
      p => p.getByRole('switch').getAttribute('aria-checked', {timeout:10}),
      p => p.mouse.click(10,20), p => p.mouse.move(10,20), p => p.mouse.wheel(0,120),
      p => p.keyboard.type('private-message'), p => p.keyboard.press('Enter'), p => p.keyboard.insertText('private-message'),
      p => p.goto('https://www.instagram.com/?private-query', {timeout:10}),
      p => p.reload({timeout:10}), p => p.waitForLoadState('domcontentloaded', {timeout:10}),
      p => p.waitForURL('**/direct/', {timeout:10}),
    ];
    const methods = ['click','dblclick','fill','hover','press','setChecked','selectOption','setInputFiles','waitFor','getAttribute',
      'click','move','wheel','type','press','insertText','goto','reload','waitForLoadState','waitForURL'];
    for (let index = 0; index < actions.length; index++) {
      await logOperation('automation.profile_session', {profileId:'profile-' + index}, async () => {
        const s = observationFixture(); s.fail(methods[index]);
        const stop = observeAutomationUi(s.page, () => false);
        try { await actions[index](s.page).catch(error => assert.equal(error,s.failure)); }
        finally { stop(); }
      });
    }
  `)
  const failures = logs.filter(log => log.event === 'automation.ui_failure')
  const completions = logs.filter(log => log.event === 'automation.profile_session')
  assert.equal(failures.length, 20)
  assert.equal(completions.length, 20)
  for (let index = 0; index < failures.length; index++) {
    assert.equal(failures[index].profileId, completions[index].profileId)
    assert.equal(failures[index].parentOperationId, completions[index].operationId)
    assert.equal(failures[index].context.pagePath, '/direct/')
    assert.equal(completions[index].outcome, 'success')
    assert.equal(completions[index].context.diagnosticCount, 1)
  }
  for (const value of ['private-message', 'private-option', 'private-path', 'private-query', 'do-not-log'])
    assert.ok(!JSON.stringify(logs).includes(value), value)
})

test('locator composition, frames, arrays and original Cloak options retain observation', () => {
  const logs = events(`
    await logOperation('automation.profile_session', {}, async () => {
      const s = observationFixture(), p = s.page;
      const original = {locator:p.locator, wheel:p.mouse.wheel, getByRole:s.frame.getByRole};
      const identity = new WeakMap([[p,'page'],[p.mouse,'mouse'],[p.keyboard,'keyboard'],[s.frame,'frame']]);
      const stop = observeAutomationUi(p, () => false);
      assert.equal(identity.get(p),'page'); assert.equal(identity.get(p.mouse),'mouse'); assert.equal(identity.get(p.keyboard),'keyboard');
      assert.equal(p.mainFrame(),s.frame); assert.equal(p.frames()[0],s.frame); assert.equal(p.frame({name:'test'}),s.frame);
      assert.equal(identity.get(p.mainFrame()),'frame');
      const a = p.getByRole('button'), b = p.getByRole('switch');
      const options = {timeout:100,human_config:{scroll_target_zone:[0,1]},position:{x:2,y:3}};
      await a.filter({has:b,hasNot:b}).and(b).or(b).first().last().nth(0).click(options);
      assert.equal(s.called.at(-1).args[0],options);
      await a.locator('span',{has:b}).click(options);
      await p.mainFrame().getByRole('button').click(options);
      await p.frameLocator('iframe').getByRole('button').click(options);
      const targets = await a.all(); s.fail('click');
      await targets[0].click(options).catch(error => assert.equal(error,s.failure));
      stop(); stop();
      assert.equal(p.locator,original.locator); assert.equal(p.mouse.wheel,original.wheel); assert.equal(s.frame.getByRole,original.getByRole);
      // Retained locator references also become passive after the lease ends.
      const previousFailure=s.failure; s.fail('click');
      await targets[0].click().catch(error=>{assert.equal(error,s.failure);assert.notEqual(error,previousFailure)});
    });
  `)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].event, 'automation.ui_failure')
  assert.equal(logs[1].context.diagnosticCount, 1)
})

test('shared input helpers deduplicate diagnostics and preserve the richer action context', () => {
  const logs = events(`
    import { clickLiveAction } from './server/automation/actions/action-locator.ts';
    import { BrowseSession } from './server/automation/actions/session.ts';
    import { reportUiFailure } from './server/automation/actions/ui-diagnostics.ts';
    await logOperation('automation.profile_session', {}, async () => {
      const s=observationFixture(); s.fail('elementHandle');
      s.snapshot([{role:'dialog',children:[{role:'text',text:'private caption'},
        {role:'button',name:'Dark mode Dark mode',text:'private caption',children:[{role:'switch',name:'Dark mode',value:'private value'}]}]}]);
      const stop=observeAutomationUi(s.page,()=>false), target=s.page.getByRole('button',{name:'Dark mode'});
      const context={action:'appearance',stage:'change_theme',controls:s.page.getByRole('dialog')};
      try { await clickLiveAction(s.page,target,new BrowseSession(),100,context); }
      catch(error) {
        assert.equal(error,s.failure);
        await reportUiFailure(target,error,{...context,phase:'verification',startedAt:Date.now(),timeoutMs:100});
      } finally { stop(); }
    });
  `)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].context.action, 'appearance')
  assert.equal(logs[0].context.stage, 'change_theme')
  assert.equal(logs[0].context.phase, 'selection')
  assert.equal(logs[0].context.timeoutMs, 100)
  assert.deepEqual(logs[0].context.controls, [{ role: 'button', name: 'Dark mode Dark mode' }, { role: 'switch', name: 'Dark mode' }])
  assert.ok(!JSON.stringify(logs).includes('private caption'))
  assert.ok(!JSON.stringify(logs).includes('private value'))
})

test('successful probes, successful input and cancellation emit no failure diagnostics', () => {
  const logs = events(`
    import { clickAction } from './server/automation/actions/action-locator.ts';
    import { BrowseSession } from './server/automation/actions/session.ts';
    import { withUiDiagnosticContext } from './server/automation/actions/ui-diagnostics.ts';
    await logOperation('automation.profile_session', {}, async () => {
      const s=observationFixture(); let stopped=false;
      const stop=observeAutomationUi(s.page,()=>stopped);
      const target=s.page.getByRole('button');
      assert.equal(await target.isVisible(),false); assert.equal(await target.count(),0);
      await target.click(); s.fail('click'); stopped=true;
      await target.click().catch(error=>assert.equal(error,s.failure)); stopped=false;
      await withUiDiagnosticContext({session:new BrowseSession(Date.now()-1)},()=>target.click()).catch(()=>{});
      stop();
      const cancelled=observationFixture(); cancelled.fail('elementHandle');
      const release=observeAutomationUi(cancelled.page,()=>true);
      await clickAction(cancelled.page.getByRole('button')).catch(()=>{});
      release();
    });
  `)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].context.diagnosticCount, undefined)
})

test('anchored input failures retain the original semantic selector instead of the temporary marker', () => {
  const logs = events(`
    import { clickLiveAction } from './server/automation/actions/action-locator.ts';
    import { BrowseSession } from './server/automation/actions/session.ts';
    await logOperation('automation.profile_session', {}, async () => {
      const s=observationFixture(); s.fail('click');
      const stop=observeAutomationUi(s.page,()=>false);
      await clickLiveAction(s.page,s.page.getByRole('button',{name:'Intended control'}),new BrowseSession(),100,
        {action:'following',stage:'confirm_follow'}).catch(error=>assert.equal(error,s.failure));
      stop();
    });
  `)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].context.expectedSelector, "getByRole('button', {name: 'Intended control'})")
  assert.equal(logs[0].context.action, 'following')
  assert.equal(logs[0].context.phase, 'input')
  assert.equal(logs[1].context.diagnosticCount, 1)
})

test('deadline exhaustion stays on completion while genuine UI failures remain diagnostic', () => {
  const logs = events(`
    import { BrowseSession } from './server/automation/actions/session.ts';
    import { withUiDiagnosticContext } from './server/automation/actions/ui-diagnostics.ts';
    await logOperation('automation.profile_session', {}, async scope => {
      const s=observationFixture(); s.fail('waitFor');
      const stop=observeAutomationUi(s.page,()=>false);
      await withUiDiagnosticContext({session:new BrowseSession(Date.now()-1),action:'reels',stage:'verify_reel'},
        ()=>s.page.getByRole('dialog').waitFor({state:'visible',timeout:1})).catch(()=>{});
      assert.equal(scope.fields.lastUiAction.status,'deadline_exhausted');
      s.fail('waitFor');
      await withUiDiagnosticContext({session:new BrowseSession(),action:'notifications',stage:'open_notifications'},
        ()=>s.page.getByRole('dialog').waitFor({state:'visible',timeout:5000})).catch(()=>{});
      stop();
    });
  `)
  assert.equal(logs.length, 2)
  assert.equal(logs[0].event, 'automation.ui_failure')
  assert.equal(logs[0].context.stage, 'open_notifications')
  assert.equal(logs[1].context.uiDeadlineCount, 1)
  assert.equal(logs[1].context.lastUiDeadline.stage, 'verify_reel')
  assert.equal(logs[1].context.lastUiAction.status, 'failed')
  assert.equal(logs[1].context.lastUiAction.action, 'notifications')
  assert.equal(logs[1].context.lastUiAction.pagePath, '/direct/')
  assert.equal(logs[1].context.lastUiAction.expectedSelector, undefined)
})

test('a successful action is retained as bounded context for later stalls', () => {
  const logs = events(`
    import { withUiDiagnosticContext } from './server/automation/actions/ui-diagnostics.ts';
    await logOperation('automation.profile_session', {}, async () => {
      const s=observationFixture(), stop=observeAutomationUi(s.page,()=>false);
      await withUiDiagnosticContext({action:'notifications',stage:'open_notifications'},
        ()=>s.page.getByRole('button').click({timeout:5000}));
      stop();
    });
  `)
  assert.equal(logs.length, 1)
  assert.equal(logs[0].context.lastUiAction.status, 'success')
  assert.equal(logs[0].context.lastUiAction.stage, 'open_notifications')
  assert.equal(logs[0].context.diagnosticCount, undefined)
})

test('successful selector text cannot leak escaped names into completion or parent failure notes', () => {
  const names = [
    { value: "Alice O'Connor", selector: "getByText('Alice O\\'Connor', {exact: true})" },
    { value: 'Alice "Quoted"', selector: 'getByText("Alice \\"Quoted\\"", {exact: true})' },
    { value: 'Alice\\Connor', selector: 'getByText("Alice\\\\Connor", {exact: true})' },
  ]
  const logs = events(`
    import { redactLogValues } from './server/shared/logger.ts';
    import { withUiDiagnosticContext } from './server/automation/actions/ui-diagnostics.ts';
    for (const {value,selector} of ${JSON.stringify(names)}) {
      await logOperation('automation.session', {}, async parent => {
        await logOperation('automation.profile_session', {}, async scope => {
          redactLogValues(value);
          const s=observationFixture(), target=s.page.getByText(value,{exact:true});
          target.toString=()=>selector;
          s.page.getByText=()=>target;
          const stop=observeAutomationUi(s.page,()=>false);
          await withUiDiagnosticContext({action:'profile_edit',stage:'verify_full_name'},
            ()=>s.page.getByText(value,{exact:true}).waitFor({state:'visible',timeout:5000}));
          stop();
          scope.add({outcome:'error'});
          parent.note('error',{event:'automation.profile_failed',...scope.safeFields({lastUiAction:scope.fields.lastUiAction})});
        });
      });
    }
  `)
  const serialized = JSON.stringify(logs)
  for (const { value, selector } of names) {
    assert.ok(!serialized.includes(value))
    assert.ok(!serialized.includes(JSON.stringify(selector).slice(1, -1)))
  }
  assert.equal(logs.length, names.length * 2)
  for (const log of logs) {
    const action = log.event === 'automation.profile_session' ? log.context.lastUiAction : log.context.notes[0].lastUiAction
    assert.equal(action.expectedSelector, undefined)
    assert.equal(action.stage, 'verify_full_name')
    assert.equal(action.status, 'success')
  }
})

test('control snapshots bound names, count and traversal, excluding static text and values', () => {
  const controls = diagnosticControls([{ role: 'text', name: 'private text' }, { role: 'textbox', name: 'message' },
    ...Array.from({ length: 30 }, () => ({ role: 'button', name: 'x'.repeat(200), value: 'private' }))])
  assert.equal(controls.length, 12)
  assert.ok(controls.every(control => control.role === 'button' && control.name.length === 100))
  assert.equal(diagnosticControls({ role: 'button', name: 'Unexpected shape' }).length, 0)
  assert.deepEqual(diagnosticControls([{ role: 'link', name: 'Notifications Notifications', url: 'private-url' }]),
    [{ role: 'link', name: 'Notifications Notifications' }])
})

test('expected absence probes stay quiet while required waits and transport failures remain visible', () => {
  const logs = events(`
    import { hasUnseenStories } from './server/automation/actions/stories.ts';
    import { messageWasBlocked } from './server/automation/follow.ts';
    import { BrowseSession } from './server/automation/actions/session.ts';
    import { withUiDiagnosticContext } from './server/automation/actions/ui-diagnostics.ts';
    await logOperation('automation.profile_session', {}, async () => {
      const s=observationFixture(); s.fail('waitFor');
      const stop=observeAutomationUi(s.page,()=>false);
      assert.equal(await hasUnseenStories(s.page,new BrowseSession()),false);
      assert.equal(await messageWasBlocked(s.page),false);
      await s.page.getByRole('dialog').waitFor({state:'visible',timeout:10}).catch(()=>{});
      const target=s.page.getByRole('dialog');
      target.waitFor=async()=>{throw new Error('Browser disconnected')};
      await withUiDiagnosticContext({expectedTimeout:true},()=>target.waitFor({state:'visible',timeout:10})).catch(()=>{});
      stop();
    });
  `)
  assert.equal(logs.length, 3)
  assert.equal(logs[0].context.failureKind, 'verification_timeout')
  assert.equal(logs[1].error.message, 'Browser disconnected')
  assert.equal(logs[2].context.diagnosticCount, 2)
})
