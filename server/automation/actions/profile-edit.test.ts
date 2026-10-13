import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

for (const scenario of [
  'username',
  'fullName',
  'avatar',
  'avatar not persisted',
  'avatar query only',
  'unavailable',
  'uncertain',
  'wrong account',
  'stopped',
]) {
  test(`browser profile edit: ${scenario}`, () => {
    execFileSync(
      'bun',
      [
        '--eval',
        `
      import { mock } from 'bun:test'
      import assert from 'node:assert/strict'
      import { promises as fs } from 'node:fs'
      import { tmpdir } from 'node:os'
      import path from 'node:path'
      import { visibleActionGeometry } from './server/automation/actions/action-locator.test-support.ts'
      const scenario=${JSON.stringify(scenario)}
      const root=await fs.mkdtemp(path.join(tmpdir(),'profile-edit-test-'))
      const image=path.join(root,'avatar.jpg');await fs.writeFile(image,'fixture')
      let url='https://www.instagram.com/',username='old',name='Old Name',draft='',photo='old-photo',hidden=false
      const clicks=[],hovers=[]
      function control(key) {
        return {
          first(){return this},filter(){return this},
          locator(selector){return selector==='img'?control('photo-image'):control('center')},
          getByRole(role,options){return control(options?.name||'form')},
          getByText(text){return control(text instanceof RegExp?'unavailable':'verified-name')},
          inputValue:async()=>draft,
          getAttribute:async()=>photo,
          isVisible:async()=>key==='unavailable'?scenario==='unavailable':true,
          waitFor:async options=>{
            if(options.state==='hidden'&&!hidden)throw Error('Save did not close the form')
            if(key==='verified-name'&&name!=='New Name')throw Error('The saved name did not match')
          },
          setInputFiles:async payload=>{assert.equal(payload.mimeType,'image/jpeg');assert.equal(payload.buffer.toString(),'fixture');photo=scenario==='avatar query only'?'old-photo?new=1':'new-photo';hidden=true;clicks.push('upload')},
          elementHandle:async()=>({...visibleActionGeometry,dispose:async()=>{},
            hover:async()=>hovers.push(key),
            fill:async value=>{draft=value},
            click:async()=>{
              clicks.push(key)
              if(key==='center')url='https://accountscenter.instagram.com/profiles/'
              if(key==='Username'){draft=username;hidden=false}
              if(key==='Name'){draft=name;hidden=false}
              if(key==='Done'&&scenario!=='uncertain'){if(scenario==='fullName')name=draft;else username=draft;hidden=true}
              if(key==='Close')hidden=true
              if(key==='Back to Instagram Settings')url='https://www.instagram.com/accounts/edit/'
            },
          }),
        }
      }
      const page={url:()=>url,reload:async()=>{if(scenario==='avatar not persisted')photo='old-photo'},
        getByRole:(role,options)=>control(options?.name||'form'),
        locator:selector=>control(selector==='main'?'main':selector.includes('input[type="file"]')?'file':'center'),
        waitForURL:async fn=>assert.equal(fn(new URL(url)),true),
      }
      mock.module('./server/automation/actions/profiles.ts',()=>({openOwnProfile:async()=>{assert.equal(new URL(url).hostname,'www.instagram.com');url='https://www.instagram.com/'+(scenario==='wrong account'?'someone_else':username)+'/';return true}}))
      mock.module('./server/automation/actions/instagram-state.ts',()=>({assertInstagramReady:async()=>{}}))
      mock.module('./server/automation/actions/navigation.ts',()=>({dismissPopups:async()=>false}))
      try {
        const {editProfileInBrowser}=await import('./server/automation/actions/profile-edit.ts')
        const kind=scenario.startsWith('avatar')?'avatar':scenario==='fullName'?'fullName':'username'
        const result=await editProfileInBrowser(page,{kind,currentUsername:'old',value:kind==='fullName'?'New Name':'new',path:image},()=>{},()=>scenario==='stopped')
        assert.equal(result,['username','fullName','avatar'].includes(scenario)?'applied':scenario==='unavailable'?'unavailable':scenario==='uncertain'||scenario.startsWith('avatar ')?'uncertain':'failed')
        if(['username','fullName'].includes(scenario)){assert.ok(clicks.includes('old Instagram'));assert.ok(clicks.includes('Done'));assert.ok(hovers.includes('Done'))}
        if(scenario==='avatar'){assert.equal(photo,'new-photo');assert.deepEqual(clicks,['Change profile photo','upload'])}
        if(['unavailable','wrong account','stopped'].includes(scenario))assert.equal(clicks.includes('Done'),false)
        if(scenario==='unavailable')assert.equal(new URL(url).hostname,'www.instagram.com')
      } finally {await fs.rm(root,{recursive:true,force:true})}
    `,
      ],
      { cwd: new URL('../../../', import.meta.url), encoding: 'utf8', timeout: 15_000 },
    )
  })
}
