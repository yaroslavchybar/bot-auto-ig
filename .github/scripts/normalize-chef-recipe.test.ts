import { expect, test } from 'bun:test'
import { normalizeRecipe } from './normalize-chef-recipe'

test('normalizing chef manifests preserves features and package edition while removing duplicate target editions', () => {
  const original = {
    package: { name: 'fixture', edition: '2021', version: '0.0.1' },
    dependencies: { tokio: { version: '1', features: ['macros'], 'default-features': false } },
    lib: { path: 'src/lib.rs', edition: '2021', 'crate-type': ['lib'] },
    bin: [{ name: 'tool', path: 'src/main.rs', edition: '2021', 'required-features': ['cli'] }],
    test: [{ name: 'integration', edition: '2021' }],
    bench: [{ name: 'benchmark', edition: '2021' }],
    example: [{ name: 'sample', edition: '2021' }],
  }
  const recipe = {
    skeleton: {
      manifests: [{ relative_path: 'Cargo.toml', contents: Bun.TOML.stringify(original)! }],
      lock_file: 'unchanged-lock',
    },
  }
  const expected = structuredClone(original)
  for (const target of [
    expected.lib,
    ...expected.bin,
    ...expected.test,
    ...expected.bench,
    ...expected.example,
  ])
    Reflect.deleteProperty(target, 'edition')
  const normalized = normalizeRecipe(recipe)
  expect(Bun.TOML.parse(normalized.skeleton.manifests[0].contents)).toEqual(expected)
  expect(normalized.skeleton.lock_file).toBe('unchanged-lock')
  const serialized = JSON.stringify(normalized)
  expect(JSON.stringify(normalizeRecipe(normalized))).toBe(serialized)
})

test('a genuine target edition override is rejected rather than changing compilation semantics', () => {
  const contents =
    '[package]\nname="fixture"\nedition="2021"\n[[bin]]\nname="other"\nedition="2018"'
  expect(() =>
    normalizeRecipe({ skeleton: { manifests: [{ relative_path: 'Cargo.toml', contents }] } }),
  ).toThrow('Different target edition')
})
