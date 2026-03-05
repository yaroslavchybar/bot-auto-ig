# Docs-First Knowledge Model

This repository uses a docs-first model.

## Canonical Sources

1. `docs/` holds source-of-truth guidance.
2. `AGENTS.md` is a short map injected into agent context.
3. Module `README.md` files are entry pointers.

## Precedence

When guidance conflicts:
1. Follow `docs/`.
2. Use `AGENTS.md` for fast navigation only.
3. Treat README stubs as pointers, not specifications.

## Placement Rules

- Architecture, APIs, runtime behavior, env policy, and troubleshooting belong in `docs/`.
- Keep `AGENTS.md` map-focused.
- Keep README files minimal and avoid duplicated deep guidance.

## Link Rules

- Use repo-relative markdown links.
- Do not use machine-local paths.
- Keep anchors stable when restructuring sections.
