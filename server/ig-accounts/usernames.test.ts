import { expect, test } from 'vitest'
import { fullNameForGroup, usernameCandidates } from './usernames.js'

test('uses supplied full names by group before generating variations', async () => {
  const model = { id: 'model-1', name: 'Anna', fullName: 'Anna Kowalska',
    fullNames: ['Anna Kowalska', 'Anna M. Kowalska'] }
  expect(await fullNameForGroup(model, 0)).toBe('Anna Kowalska')
  expect(await fullNameForGroup(model, 1)).toBe('Anna M. Kowalska')
})

test('uses every imported username before generating one', async () => {
  const usernames = Array.from({ length: 12 }, (_, index) => `anna.${index + 1}`)
  const model = { id: 'model-1', name: 'Anna', usernames }
  expect(await usernameCandidates(model, 10, [])).toEqual(['anna.11'])
  expect(await usernameCandidates(model, 11, [])).toEqual(['anna.12'])
})
