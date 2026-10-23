type Target = { edition?: string }
type Manifest = {
  package?: { edition?: string }
  lib?: Target
  bin?: Target[]
  test?: Target[]
  bench?: Target[]
  example?: Target[]
}
type Recipe = { skeleton: { manifests: { relative_path: string; contents: string }[] } }

// cargo-chef 0.1.78 duplicates package editions onto targets. Cargo deprecates those overrides.
export function normalizeRecipe<T extends Recipe>(recipe: T): T {
  for (const file of recipe.skeleton.manifests) {
    const manifest = Bun.TOML.parse(file.contents) as Manifest
    const edition = manifest.package?.edition ?? '2015'
    for (const target of [
      manifest.lib,
      ...(manifest.bin ?? []),
      ...(manifest.test ?? []),
      ...(manifest.bench ?? []),
      ...(manifest.example ?? []),
    ]) {
      if (target?.edition === undefined) continue
      if (target.edition !== edition)
        throw new Error(
          `Different target edition in ${file.relative_path}; migrate it before caching`,
        )
      delete target.edition
    }
    const contents = Bun.TOML.stringify(manifest)
    if (!contents) throw new Error(`Empty manifest in ${file.relative_path}`)
    file.contents = contents
  }
  return recipe
}

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) throw new Error('Recipe path is required')
  await Bun.write(file, JSON.stringify(normalizeRecipe(await Bun.file(file).json())))
}
