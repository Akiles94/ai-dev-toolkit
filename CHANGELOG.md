# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-05

### Added

- **`walkthrough` agent** (`aidt add walkthrough`): walks a developer through someone else's
  large PR one section of at most 300 lines at a time, in reading order, with guide comments
  written into a local copy of the code, verified findings and questions per section, and a
  pause after each one. Ends with requirement coverage and review comments ready to paste.
  Never commits, pushes or comments on the PR. The `reviewer` is unchanged.
- **`aidt walkthrough plan`**: splits a change into ordered sections (contracts, core,
  integration, UI, docs, tests, config), keeping folders together and each test next to its code.
- **`aidt walkthrough start <ref> <name>` / `finish <name>`**: check a PR out in
  `.aidt/walkthrough/<name>/`, ignored by git, and plan it; remove it with every comment in it.

### Fixed

- The `builder` can run the project's test and check scripts (`npm test`, `npm run`, pnpm, yarn),
  as its instructions require; before, it could not verify a section.
- The `refiner`, installed alone, names the task folder after the branch, not the ticket, so the
  planner and `aidt check` find the task.

### Docs

- One page per tool (`docs/reviewer.md`, `walkthrough.md`, `refiner.md`, `structure.md`,
  `workflow.md`, `cli.md`), each with a real run on the
  [aidt-examples](https://github.com/Akiles94/aidt-examples) repository and its measured cost.

## [0.1.1] - 2026-11-05

### Changed

- README rewritten around what works today: quick start first, the reviewer as the one-minute
  entry point, a CLI reference, and planned products moved to a short roadmap.
- More npm keywords, so the package shows up for Copilot and Claude Code agent searches.

### Fixed

- Tests that drive real git repositories get 60 seconds each, so `npm publish` no longer times out
  on slow machines.
- The release workflow skips publishing when the version is already on npm.

## [0.1.0] - 2026-11-05

First public release.

### Added

- **`workflow` product:** four canonical agents (`refiner`, `planner`, `builder`, `reviewer`), the
  spec, plan and review templates, `state.json` schema, and practices (sustainable code, static
  analysis). Modes `full` / `light` / `rework` and control levels `strict` / `standard` / `fast`.
  The `reviewer` searches for defects beyond the spec (verified findings with a failing scenario
  and a suggested fix) on a `balanced` model, also reviews a branch without a spec, against its ticket, and the `refiner`
  alone ends at the approved spec.
- **`structure` product:** common structure rules S1–S7, three levels (conventional, modular,
  architecture), nine stack presets (React, Next.js, React Native, Node.js, Go, C#, Java, Kotlin
  Android, Swift iOS) built on their official guides, and the `architect` agent.
- **CLI `aidt`:**
  - `add <product|agent>`: copies a product, or the `refiner` or `reviewer` alone, into `.aidt/`
    without overwriting your files, then syncs.
  - `sync [--check]`: renders the canonical agents for GitHub Copilot and Claude Code. Removes the
    generated files of deleted agents and drops handoffs to agents that are not installed.
    Agents may run every `aidt` command as `npx @akiles94/ai-dev-toolkit …` when `aidt` is not
    installed globally.
  - `diff`: diff stats with tests, config, noise and formatting counted apart.
  - `clean [--check]`: removes `@guide` comments, including JSX and multi-line blocks.
  - `check`: section sizes and requirement → test mapping for the current task.
  - `stack prepare` / `stack submit [--dry-run]`: one branch and one draft PR per reviewed section,
    with `gh` (linked by `gh stack` when installed), `glab`, or push-only fallback.
  - `structure audit [--json]`: deterministic check of the structure rules.
- `diff` and `clean` skip untracked symlinks (such as a package linked into `node_modules`)
  instead of failing.
- Zero runtime dependencies; CI on Linux, Windows and macOS; npm provenance on publish.
