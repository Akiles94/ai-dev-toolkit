# Contributing

Thanks for helping. This project uses its own workflow, so contributions follow the same rules it
asks of everyone else: small sections, explained, reviewed.

## Setup

Requires Node 24 (`.nvmrc`) and git.

```bash
npm ci
npm run verify   # typecheck, Biome (cognitive complexity ≤ 15), knip, jscpd, tests with coverage
npm run dev -- --help
```

CI runs the same `verify` on Linux, the tests on Windows and macOS, plus Semgrep and `npm audit`.
Findings appear as annotations on the PR.

## How the code is organised

- One folder per command flow under `src/` (`add/`, `clean/`, `diff/`, `check/`, `stack/`,
  `structure/`, `sync/`), and `shared/` with one subject per folder. A flow imports only itself and
  `shared`; `src/architecture.test.ts` enforces it.
- File names say their role: `<what>.command.ts`, `<what>.port.ts`, `<what>.test.ts` next to the file.
- Expected errors are values (`Result`), not exceptions. Every export has a doc comment.
- `aidt structure audit` must stay clean on this repository.
- Products live in `products/<name>/`: what `aidt add` copies, plus their tests (not published).

## Pull requests

- One PR per section of **≤ 300 reviewable lines** (`npm run dev -- diff`). Bigger changes go as a
  stack of PRs, each based on the previous one.
- Tests next to the code; requirement or behavior in the test name.
- Update `README.md`, `docs/design.md` and `CHANGELOG.md` (under *Unreleased*) in the same PR when
  behavior changes.
- Agents and templates change behavior too: keep `products/**/*.test.ts` passing.

## Releasing (maintainer)

1. Move *Unreleased* in `CHANGELOG.md` to the new version and set `version` in `package.json`.
2. Merge to `main`, then create a GitHub release with tag `v<version>`.
3. `.github/workflows/release.yml` runs `verify`, builds and publishes to npm with provenance.

One-time npm setup: an npm account that owns the `@akiles94` scope, and the package's **trusted
publisher** set to this repository and `release.yml` on npmjs.com. If npm needs the package to exist
before trusted publishing can be set, publish the first version from your machine with
`npm publish` and switch to the workflow from the next one.
