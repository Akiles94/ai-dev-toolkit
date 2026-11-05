# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

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
  - `diff`: diff stats with tests, config, noise and formatting counted apart.
  - `clean [--check]`: removes `@guide` comments, including JSX and multi-line blocks.
  - `check`: section sizes and requirement → test mapping for the current task.
  - `stack prepare` / `stack submit [--dry-run]`: one branch and one draft PR per reviewed section,
    with `gh` (linked by `gh stack` when installed), `glab`, or push-only fallback.
  - `structure audit [--json]`: deterministic check of the structure rules.
- Zero runtime dependencies; CI on Linux, Windows and macOS; npm provenance on publish.
