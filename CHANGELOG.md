# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-11-18

### Added

- **`qa` agent** (`aidt add qa`): uses the product as each person who will use it, plus someone
  with bad intentions, and reports dead ends, bugs, contradictions, broken promises and blind
  spots in the journeys a change makes and the older ones it touches, with a PASS/FAIL verdict
  bound to the commit walked. Only when asked; it proposes the journeys, people, states and a
  token estimate first. Modes `block`, `flow` and `audit`. Each finding is confirmed by running its
  walk again; what is not goes under «Unconfirmed». FAIL with a confirmed 🔴, or while a 🟡 is
  neither fixed nor accepted. It writes only its reports, its walks and `.aidt/app.md` (shared with
  the `demo`, which now has a «QA» part), and has no `node`, `curl` or install pre-approved.
- **`aidt qa walk <file> [--json]`**: plays a walk the agent wrote as JSON, in a real browser, with
  no model: one browser context per person (`phone` or `desktop`; `as` says who does a step, the
  first person otherwise), the demo's steps plus `click`
  with `times`, `back`, `reload`, `look` (a screenshot and the page's text), `keep` (a value from
  the page reused as `{name}`), `request` (a call with the person's cookies), `offline` and
  `clear`. For every step it prints the calls the page made with their status, console and page
  errors and failed calls; a step that cannot be done stops the walk with a screenshot and says
  why. The app must already be running. Output in `qa.output` (`.aidt/qa`, ignored by git).
- **Plan check** (`practices/plan-check.md`, installed with the QA): the list a plan goes through
  before building. The planner reads it only in projects that have it, and plans a test from the
  walk for every QA finding a block fixes.

### Changed

- `aidt add` marks each file it keeps that differs from this version's, and says how to take the
  new one: a project installed before kept older agents without knowing (a 0.5.0 builder and
  reviewer without `aidt context check`, a planner without the plan check).
- A step with a key a demo script does not know is refused; it was silently ignored.

### Fixed

- `aidt add` with no agent installed printed «Generated 0 file(s):» and nothing under it.
- Output cut short by its reader (`aidt add workflow | head`) crashed with `EPIPE`; it now stops
  quietly.

## [0.5.0] - 2026-11-18

### Added

- **`demo` agent** (`aidt add demo`): a narrated video of what a task built, for the PR. Only when
  asked; it proposes scenes, length and a token estimate first, writes a JSON script, renders a
  first-scene sample the first time, then the video, and hands over a PR text. It writes only its
  scripts and `.aidt/app.md` (how to run the product, shared with the future `qa`).
- **`aidt demo render <script> [--sample]`**: records a script with no model, in a real browser
  (Playwright from the project or installed globally) with an offline voice (Piper) mixed by
  ffmpeg; a circle marks each tap. Steps: `go`, `say`, `click`, `fill`, `select`, `press`,
  `scroll`, `wait`. The first failing step stops the render and is named. Writes the video,
  WebVTT subtitles, the PR text and the facts (the video's length, size, render time, commit) to
  `demo.output` (a `.gitignore` when the render creates the folder).
- The render starts the app with `demo.start` from the config (never from a script), also one
  that puts it in the background with `&`, and stops its process group after, also on Ctrl+C. A
  start that fails (an error or a signal) ends the render at once, shows its error output and
  stops anything it had already left in the background. A video that loses its start is
  recorded once more. Nothing is installed or downloaded: what is missing is printed as commands.
- `demo` in `.aidt/config.json`: `start`; the voice by language (`en-US`, `en-GB`, `es-ES`,
  `es-419`) and gender, or any Piper model; subtitles `file`, `burned` or `none`; the output
  folder.

- **`context` product** (`aidt add context`): what every new AI session reads, in layers with a
  token budget. `aidt context check [--json]` measures the rules files the tools load by
  themselves (`CLAUDE.md` `@` imports followed) and the status every session reads first, fails
  over budget with the heaviest sections to move, and checks that every path of the status's
  «Read first» list exists. A practice (`session-context.md`) says how to close a block: the
  block's story in its own `summary.md`, a row in the tasks index, the status rewritten with the
  next session's reading list. Budgets and files: `context` in `.aidt/config.json`.
- The builder runs `aidt context check` when a section changes a rules file or the status, and
  the reviewer reports a breach as a finding, in projects that use `context`.

## [0.4.0] - 2026-11-07

### Added

- **Model of each agent in the config:** `models` in `.aidt/config.json` moves an agent to another
  tier (`"agents": { "reviewer": "max" }`) and sets the model of each tier per tool
  (`"claude-code"`, `"copilot"`). Copilot agents get a fixed model only when one is configured;
  otherwise they keep using the chat's model. A misspelled agent or tier makes `aidt sync` fail
  with the reason. New projects get the block in their starter config.

## [0.3.0] - 2026-11-07

### Added

- **Code quality review** in the `reviewer` and the `walkthrough`: beyond bugs, both rate the
  changed code on structure, practices, readability, maintainability, performance, security and
  tests (✅ / 🟡 / 🔴 / ➖), with at most 5 concrete suggestions per section. The dimensions live
  in `.aidt/practices/code-quality.md`, shared by both agents and editable per team. Only a broken
  written rule or a confirmed security or performance problem fails a section; suggestions never
  do: a problem the change only inherits is a 🟡 suggestion. The review guide has a new
  `Quality` block.

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
  [ai-dev-toolkit-examples](https://github.com/Akiles94/ai-dev-toolkit-examples) repository and its measured cost.

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
