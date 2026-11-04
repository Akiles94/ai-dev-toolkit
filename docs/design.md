# AI Dev Toolkit: design

Status: draft v0.1 · 2026-10-29

## 1. Principles

1. **The developer decides, the AI types.** Every agent ends at an approval point. Nothing moves forward without an explicit "ok".
2. **Small units.** Work, code and review happen in sections of ~300 production lines. The section is the unit of build, review and delivery.
3. **Specs as documentation.** `spec.md` (what) and `plan.md` (how) are committed with the code. They are the living record of each change.
4. **Deterministic first.** Anything mechanical (diffs, line counts, cleanup, coverage, git) is a script, not a prompt. Cheaper, faster, reliable.
5. **Agnostic.** One canonical definition, rendered to each AI tool. No lock-in to a vendor or model.
6. **You own the files.** The CLI copies plain files into your repo (shadcn-style). Edit anything. No runtime dependency.
7. **No questions for the sake of it.** Agents ask only what is genuinely unclear or not already defined by the project or profile.

## 2. Products

Each product is independent and installable alone. The `refiner` and the `reviewer` are also installable alone (`aidt add refiner`, `aidt add reviewer`): the refiner then ends at the approved spec, and the reviewer reviews a branch against its ticket when there is no spec (§5.4).

| Product | Contents | Depends on |
|---|---|---|
| `workflow` | `refiner`, `planner`, `builder`, `reviewer` agents + scripts | — |
| `structure` | Code organisation: common rules, 3 levels, stack presets, `aidt structure audit`, `architect` agent (§6c) | — (the workflow reads it if present) |
| `review` | Review of external PRs/diffs (no spec or plan required) | — (shares scripts with `workflow`) |
| `init` | Guided creation of project AI files | — |
| `profile` | Guided creation of the developer profile | — |
| `docs` | Living docs for people (business flows + reference), checked in CI | [`living-docs`](https://github.com/Akiles94/living-docs) (npm, TS only) |
| `context` | Lean context for agents (cross-module flows, invariants/gotchas), checked on every commit | [`easy-repo-context`](https://github.com/Akiles94/easy-repo-context) (npm, TS/JS, Python, Go) |

`docs` and `context` remain independent packages. The toolkit installs/configures them and plugs them into the workflow (§5.5). They do not replace each other: `docs` is for people, `context` is for agents.

v0 scope: **`workflow`** and **`structure`**. `review`, `init` and `profile` follow.

## 3. Layout

### In a project
```
AGENTS.md                      ← project rules (source of truth, open standard)
.aidt/
├── config.json                ← toolkit config for this project (committed)
├── agents/                    ← canonical agent definitions (editable)
├── templates/                 ← spec, plan, review templates (editable)
├── practices/                 ← sustainable code, static analysis
├── structure.md               ← this project's structure (`structure` product)
├── structure/                 ← common rules, levels, stack presets
└── tasks/
    └── <branch-name>/
        ├── spec.md            ← refiner output
        ├── plan.md            ← planner output
        ├── review/
        │   ├── index.md       ← stack overview in reading order
        │   └── s01-<slug>.md  ← one guide per section / PR
        └── state.json         ← progress (resumable)
```
Harness-specific files (`.github/agents/…`, `.claude/agents/…`, `CLAUDE.md` importing `AGENTS.md`) are **generated** from `.aidt/agents/` by `aidt sync`. They are outputs, never edited by hand. `sync` removes the generated files of agents that no longer exist (recognised by their banner) and drops a `handoff` whose target agent is not installed.

### For the developer
```
~/.aidt/
├── profile.md                 ← personal preferences (TS, coverage, architecture…)
└── config.json                ← personal overrides (models, limits)
```
Versionable with git to sync across machines.

## 4. Rule layers

Resolved in this order (first wins):

| Layer | Where | Wins on |
|---|---|---|
| Task | `spec.md`, `plan.md` | Decisions made for this task |
| Project | `AGENTS.md`, `.aidt/config.json` | Conventions, stack, structure, naming |
| Profile | `~/.aidt/profile.md`, `~/.aidt/config.json` | Anything the project does not define |
| Defaults | Toolkit | Everything else |

Conflict rule: **the profile never overrides the project; it can only propose.** Example: profile says "TypeScript", project is legacy JS → code is JS, the planner offers progressive TS migration as an option.

## 5. The workflow

### 5.1 Refiner (what)
- **Input:** ticket (any source: URL, text, issue) or a prompt.
- **First step:** branch. If the current branch is the default branch or unrelated, ask for/propose a name (`<type>/<ticket>-<slug>`) and create it before anything else.
- **Asks:** business questions only. No technical topics.
- **Output:** `spec.md`. Gate: no open questions; user approves.

### 5.2 Planner (how)
- **Input:** `spec.md` + repo + rule layers. Does not read the refining conversation.
- **Asks:** only what is not already defined. Typical: approach and trade-offs, placement and structure, naming, reuse of existing code ("there's already `searchUsers()`: reuse or new?").
- **Splits the work into sections** by intent (e.g. data → domain → presentation → wiring), each targeting ≤ `limits.sectionLines` (default 300; tests, tooling config and generated files excluded).
- **Output:** `plan.md`. Gate: user approves.

### 5.3 Builder (code)
- Implements **one section at a time**, strictly from `plan.md`.
- Adds **guide comments** (see §6) explaining intent and flow, left uncommitted while the user reviews.
- Writes tests linked to spec requirements (`R1`, `R2`…).
- **Stops after each section.** Loop: user asks, requests changes or approves. Next section only after explicit approval.
- After approval: removes the guide comments (`aidt clean`) and commits the clean section. One commit per section on the task branch; delivery turns them into the stack (see §7).

### 5.4 Reviewer (verify + explain)
- Fresh context: reads only spec, plan and diff. Cannot edit source (enforced by hooks where the harness supports them).
- **Cleanup check** (script): `aidt clean --check` must find no guide comments left.
- **Checks** (scripts first): section line count, coverage threshold, every requirement has a test.
- **Explains:** one review guide per section (§8) + `index.md`.
- **Verdict** per section: `PASS` / `FAIL`, bound to the reviewed commit SHA (a stale PASS is invalid).
- **Delivery:** prepares the stack. Publishing requires user confirmation.

### 5.5 Integrations with `docs` and `context`

Optional. Detected from the project (`package.json`, `.context/`, `docs/flows/`). Without them, the same steps fall back to AI exploration.

| Step | `context` (easy-repo-context) | `docs` (living-docs) |
|---|---|---|
| `init` | Offer `erctx prompt init` + hooks | Offer `living-docs prompt init` (TS projects) |
| `refiner` | Read the `AGENTS.md` index and relevant flows instead of exploring | Read `docs/flows/` to name the business flows the change touches |
| `planner` | List the **gotchas that apply** in `plan.md` | Reuse existing flows and references |
| `builder` | Run `erctx context <file>` before editing; update docs its change makes false, in the same section | Update flow files and TSDoc in the same section |
| `reviewer` | `erctx check` gate; **affected flows and invariant warnings** from `erctx context` on changed files | `living-docs check` gate; link affected flows to the human guide |

Doc updates do not count toward section line limits. When both are present, the reviewer uses `context` for affected flows (multi-language) and `docs` for links to the human guide.

### 5.6 Modes
| Mode | Use | Steps |
|---|---|---|
| `full` | Features | All four agents |
| `light` | Small fixes | Short spec + short plan + builder + reviewer |
| `rework` | Address PR feedback | Builder + reviewer on the affected section |

**Control** is independent of the mode: the mode is the size of the task, the control is how much
the developer reviews along the way. Chosen with the refiner, stored in `state.json`, default
`workflow.control` in the config.

| Control | Developer approves | Agents do on their own |
|---|---|---|
| `strict` | spec, plan, each section (with guide comments) | nothing |
| `standard` | spec, plan | build all sections in a row, review them |
| `fast` | spec | plan, build and review; the developer reviews the finished stack |

Never skipped: section size limit, quality commands and tests, the reviewer's verdict (a FAIL is
never delivered), and an explicit yes to publish or merge. Under `standard`/`fast` agents still stop
on an ambiguous spec, a check failing twice, or anything hard to undo. Moving between agents stays
one explicit handoff per phase (a click or `/<agent>`), since both harnesses make handoffs explicit.

## 6. Guide comments

Verbose, tutorial-style comments the builder writes so the developer can follow the code while reviewing each section. Always marked so removal is deterministic:

```ts
// @guide: We check the limit BEFORE verifying the password,
// @guide: so a blocked IP never reaches the database.
if (limiter.isBlocked(ip)) return tooManyRequests(retryAfter);
```

- Prefix configurable (`guide.marker`, default `@guide`), adapted to each language's comment syntax.
- Never committed: the builder removes them with `aidt clean` when the user approves the section, so history never needs rewriting. The reviewer checks none are left.
- Removed by script. Normal comments are untouched.
- Not counted in section line limits.

## 6b. Practices and quality gates

The code the workflow produces follows written practices, checked by tools wherever a tool can do it.

- **Practices** in `.aidt/practices/`, copied into the project and editable:
  - `sustainable-code.md`: the ideas of *Código sostenible* (Carlos Blé) that pay off, split into
    always / when it pays off / not applied, plus a review checklist. The planner designs with
    it, the builder writes with it, the reviewer checks it.
  - Where code goes and how it is named comes from the `structure` product (§6c), not from a
    practice: `.aidt/structure.md` when present, otherwise the project's existing structure.
  - `static-analysis.md`: free tools that cover what SonarQube checks, per stack (cognitive
    complexity, smells, duplication, unused code, SAST, coverage, vulnerable dependencies, secrets).
- **Quality commands:** `quality.commands` in `.aidt/config.json`, or the project's single check
  script (`npm run verify`). The builder runs them before showing a section; the reviewer runs
  them as a gate, and any failure is a FAIL.
- Project rules (`AGENTS.md`) win over the practices; the practices win over the developer profile.
- This repository follows its own practices: `npm run verify` runs typecheck, Biome (with cognitive
  complexity ≤ 15), knip, jscpd and tests with a coverage minimum on `src/core`; CI adds Semgrep and
  `npm audit`, and reports findings as PR annotations.

## 6c. Structure

Many projects fail not for lack of an architecture but for lack of any organisation: junk-drawer
`utils/`, one 1,000-line `api.ts`, loose files everywhere. `structure` gives every project a
written, checked organisation, sized to what the team wants.

- **Common rules** (`structure/rules.md`, S1–S7), at every level and in every stack: no junk drawers,
  one module per resource, small files and folders, no loose files, one naming convention per kind of
  file, features that do not reach into each other, tests where the stack expects them.
- **Three levels**, chosen per project:
  1. **Conventional:** the stack's own layout and names from its official guide, nothing more.
  2. **Modular:** top level by feature, one public entry per feature, `shared` by subject.
  3. **Architecture:** bounded contexts per user flow, `domain / application / infra`, ports and
     adapters, `<what>.<role>` names, boundaries checked by a tool.
- **Presets** (`structure/presets/<stack>.md`), one per stack, each with its official sources: the
  layout and names of each level in that stack, and the tool that checks its boundaries. v0.1:
  React, Next.js, React Native, Node.js, Go, C#/.NET, Java, Kotlin (Android), Swift (iOS).
- **The decision** lives in `.aidt/structure.md` (template `templates/structure.md`): level, preset,
  layout, naming, boundaries, deliberate exceptions, migration status. It is a project rule.
- **`aidt structure audit`**: deterministic check of the rules marked (audit), thresholds in
  `structure` config (`maxFileLines` 300, `maxFolderFiles` 15, junk-drawer names), exceptions read
  from `.aidt/structure.md`. Text or `--json`; exit 1 with findings. No model involved.
- **`architect` agent:**
  - New project: asks level and preset (recommends one from the stack and the team's answers) and
    writes `.aidt/structure.md`.
  - Existing project: runs the audit, detects the structure the code is trying to follow, and proposes
    three paths: **keep it, improved** (default), the stack's **conventional** layout, or an
    **architecture**. Writes the decision, then hands the migration to the `refiner` as a normal task.
- **Migration rules:** never automatic; new code follows the target from day one; old code moves in
  reviewed sections; pure moves and renames are separate commits from logic changes.

## 7. Delivery: stacked PRs by default

One section = one commit while building → one branch = one PR at delivery, each based on the previous one.

| Situation | Behavior |
|---|---|
| GitHub + `gh` | Chained draft PRs; linked as a native stack when `gh stack` is installed |
| GitLab + `glab` | Chained draft MRs, each targeting the previous branch |
| Other host / no CLI | Chained branches + PRs targeting the previous branch; if no API access, print the links to open them |
| `delivery.mode: single` | One PR, one commit per section, full guide in the description |

- Missing tool → one-line notice, fall back to the next option. Never block.
- PRs are created as **drafts**. Publishing and merging always require user confirmation.
- Changing an approved section → builder restacks the branches above it.
- Each PR description = its section guide + link to `index.md`.

Two steps, so nothing leaves the machine without a yes:

1. `aidt stack prepare [--base <trunk>]`: refuses unless every section is `PASS` with a commit, a
   review guide, and the commits sit in order on the task branch. Then creates one local branch per
   section at its commit (`<task-branch>-s01-<name>`, each based on the previous one), records them
   in `state.json` (`phase: deliver`) and prints the plan. Never moves a branch that already exists
   at another commit. Pushes nothing.
2. `aidt stack submit [--dry-run]`: re-runs the same checks, requires the prepared branches,
   pushes them (`--force-with-lease`) and opens one draft PR per section with the adapter above,
   reusing PRs already open. Records each PR, `delivery.tool` and `phase: done` in `state.json`.
   `--dry-run` prints the commands and changes nothing.

## 8. Artifacts

### spec.md
```markdown
# <Ticket> · <title>
Branch: `<branch>` · Source: <ticket link or "prompt"> · Mode: full

## Goal
## Context (current behavior)
## Requirements          R1, R2… (testable)
## Acceptance criteria   Given / When / Then with real data
## Edge cases
## Out of scope
## Decisions             what the user decided during refining
```

### plan.md
```markdown
# Plan · <title>
## Approach              chosen option + rejected alternatives (one line each)
## Structure             where things go, naming
## Reuse                 existing code reused or deliberately not reused
## Sections
| # | Name | Intent | Files | Est. lines | Covers |
| S1 | Data access | … | … | ~180 | R1, R2 |
## Tests                 requirement → test mapping
## Assumptions
## Risks
```

### review/sNN-<slug>.md (per section / PR)
Sections (each enabled/disabled or extended via `templates/review-section.md`):
- At a glance (lines, files, noise filtered)
- Predict first
- What it does
- Walkthrough with real data
- Read carefully / skim
- Affected flows (direct and indirect, from changed symbols)
- Ticket coverage for the requirements in this section
- Warnings (misaligned with spec, not requested, risks)
- Questions for the author

### state.json
```json
{
  "branch": "feat/AUTH-87-login-rate-limit",
  "mode": "full",
  "phase": "build",
  "sections": [
    { "id": "S1", "status": "approved", "branch": "feat/AUTH-87/s01-data", "commit": "a1b2c3d", "verdict": "PASS" },
    { "id": "S2", "status": "in-progress" }
  ]
}
```

## 9. Configuration

`.aidt/config.json` (project) merged over `~/.aidt/config.json` (personal) over defaults.

```json
{
  "$schema": "https://…/aidt.schema.json",
  "sync": { "agents": ".aidt/agents", "harnesses": ["copilot", "claude-code"] },
  "limits": { "sectionLines": 300, "exclude": ["**/*.lock", "**/*.snap", "**/generated/**"] },
  "tests": { "coverage": 80, "requireRequirementTests": true },
  "configFiles": { "patterns": ["**/package.json", "**/tsconfig*.json", ".github/**"] },
  "guide": { "marker": "@guide" },
  "delivery": { "mode": "stack", "draft": true },
  "workflow": { "control": "strict" },
  "models": {
    "refiner": "balanced",
    "planner": "balanced",
    "builder": "balanced",
    "reviewer": "efficient"
  },
  "artifacts": { "path": ".aidt/tasks", "commit": true }
}
```

Model tiers (`efficient` / `balanced` / `max`) map to concrete models per harness in the adapter, so configs stay portable.

## 10. Agnostic by design

- **Canonical agents** in `.aidt/agents/*.md`: frontmatter (name, description, tier, context, capabilities with scoped writes and commands, handoff) + instructions. Format: `products/workflow/agents/README.md`.
- **Adapters** render them per harness with `aidt sync` (`aidt sync --check` fails in CI when the generated files are out of date):
  - **GitHub Copilot:** one custom agent per agent in `.github/agents/<name>.agent.md`, tools mapped from capabilities and a handoff button to the next agent. Copilot cannot scope writes or commands, so the limits travel as explicit instructions.
  - **Claude Code:** one skill per agent in `.claude/skills/<name>/SKILL.md`, invoked as `/<name>`, model from the tier (efficient → haiku, balanced → sonnet, max → opus), scoped writes and commands pre-approved (`Edit(<glob>)`, `Bash(<command> *)`) so anything else asks the user. Agents with `context: fresh` (the reviewer) run in a forked subagent that never saw the conversation.
  - Later: Codex, Gemini CLI, Cursor…
  - Chat-only tools (ChatGPT web, self-hosted UIs): exported as copy-paste prompts.
- Shared standards used where they exist: `AGENTS.md`, Agent Skills.
- Hard guarantees (reviewer cannot edit, line limit, PASS bound to SHA) use hooks where supported; elsewhere they run as scripts in the reviewer step.

## 11. CLI (`aidt`)

TypeScript, Node 24, minimal dependencies.

| Command | What |
|---|---|
| `aidt add <product\|agent>` | Copy a product's files into the repo, or one standalone agent (`refiner`, `reviewer`) with only the templates and practices it reads |
| `aidt sync` | Render canonical agents to each configured harness |
| `aidt diff [--section S1]` | Diff stats with noise filtered |
| `aidt clean` | Remove guide comments |
| `aidt check` | Task gates: every section within the line limit, every spec requirement referenced by a test of the task. Coverage stays in the quality commands |
| `aidt stack <prepare\|submit>` | Build / publish the stack via the detected delivery adapter |
| `aidt structure audit` | Check the common structure rules; exceptions from `.aidt/structure.md` |
| `aidt customize <agent>` | Optional guided customization |

Agents call these scripts instead of doing mechanical work with tokens.

## 12. Distribution and security

- Public repo, MIT. Every product can be copied by hand (for locked-down environments).
- npm package `aidt` (or `npx`): no install scripts, no network calls, no telemetry, minimal pinned dependencies, signed provenance.
- VS Code extension: later and optional. Nothing depends on it.
- Integrated packages: `living-docs` has no runtime dependencies; `easy-repo-context` has one (`yaml`). Both are optional; neither calls a model or the network.

## 13. Roadmap

- **v0:** `workflow` (four agents, templates, `clean`, `check`, `diff`, `stack`), `structure` (rules, levels, nine presets, `audit`, `architect`), adapters for Copilot and Claude Code.
- **v1:** `review` (external PRs), `init`, `profile`, `docs` and `context` integrations, more adapters, measured token benchmarks.
- **v2:** VS Code extension (panel, per-section diff, progress) on the same core.

## 14. Open questions

1. Canonical agent format: custom frontmatter, or reuse an existing one (e.g. Claude subagent format) as the base?
2. Monorepo layout for the CLI: single package for v0, split later?
