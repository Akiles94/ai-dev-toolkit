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

Each product is independent and installable alone.

| Product | Contents | Depends on |
|---|---|---|
| `workflow` | `refiner`, `planner`, `builder`, `reviewer` agents + scripts | — |
| `review` | Review of external PRs/diffs (no spec or plan required) | — (shares scripts with `workflow`) |
| `init` | Guided creation of project AI files | — |
| `profile` | Guided creation of the developer profile | — |
| `docs` | Living docs for people (business flows + reference), checked in CI | [`living-docs`](https://github.com/Akiles94/living-docs) (npm, TS only) |
| `context` | Lean context for agents (cross-module flows, invariants/gotchas), checked on every commit | [`easy-repo-context`](https://github.com/Akiles94/easy-repo-context) (npm, TS/JS, Python, Go) |

`docs` and `context` remain independent packages. The toolkit installs/configures them and plugs them into the workflow (§5.5). They do not replace each other: `docs` is for people, `context` is for agents.

v0 scope: **`workflow`**. `review`, `init` and `profile` follow.

## 3. Layout

### In a project
```
AGENTS.md                      ← project rules (source of truth, open standard)
.aidt/
├── config.json                ← toolkit config for this project (committed)
├── agents/                    ← canonical agent definitions (editable)
├── templates/                 ← spec, plan, review templates (editable)
└── tasks/
    └── <branch-name>/
        ├── spec.md            ← refiner output
        ├── plan.md            ← planner output
        ├── review/
        │   ├── index.md       ← stack overview in reading order
        │   └── s01-<slug>.md  ← one guide per section / PR
        └── state.json         ← progress (resumable)
```
Harness-specific files (`.github/agents/…`, `.claude/agents/…`, `CLAUDE.md` importing `AGENTS.md`) are **generated** from `.aidt/agents/` by `aidt sync`. They are outputs, never edited by hand.

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
- **Splits the work into sections** by intent (e.g. data → domain → presentation → wiring), each targeting ≤ `limits.sectionLines` (default 300, tests and generated files excluded).
- **Output:** `plan.md`. Gate: user approves.

### 5.3 Builder (code)
- Implements **one section at a time**, strictly from `plan.md`.
- Adds **guide comments** (see §6) explaining intent and flow.
- Writes tests linked to spec requirements (`R1`, `R2`…).
- **Stops after each section.** Loop: user asks, requests changes or approves. Next section only after explicit approval.
- After approval: commits the section on its own branch (see §7).

### 5.4 Reviewer (clean + explain)
- Fresh context: reads only spec, plan and diff. Cannot edit source (enforced by hooks where the harness supports them).
- **Cleanup** (script): removes guide comments.
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

## 6. Guide comments

Verbose, tutorial-style comments the builder writes so the developer can follow the code while reviewing each section. Always marked so removal is deterministic:

```ts
// @guide: We check the limit BEFORE verifying the password,
// @guide: so a blocked IP never reaches the database.
if (limiter.isBlocked(ip)) return tooManyRequests(retryAfter);
```

- Prefix configurable (`guide.marker`, default `@guide`), adapted to each language's comment syntax.
- Removed by `aidt clean` (script). Normal comments are untouched.
- Not counted in section line limits.

## 7. Delivery: stacked PRs by default

One section = one branch = one PR, each based on the previous one.

| Situation | Behavior |
|---|---|
| GitHub + `gh stack` | Native stacked PRs |
| GitLab + `glab` | `glab stack` |
| Other host / no CLI | Chained branches + PRs targeting the previous branch; if no API access, print the links to open them |
| `delivery.mode: single` | One PR, one commit per section, full guide in the description |

- Missing tool → one-line notice, fall back to the next option. Never block.
- PRs are created as **drafts**. Publishing and merging always require user confirmation.
- Changing an approved section → builder restacks the branches above it.
- Each PR description = its section guide + link to `index.md`.

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
  "harnesses": ["copilot", "claude-code"],
  "limits": { "sectionLines": 300, "exclude": ["**/*.lock", "**/*.snap", "**/generated/**"] },
  "tests": { "coverage": 80, "requireRequirementTests": true },
  "guide": { "marker": "@guide" },
  "delivery": { "mode": "stack", "draft": true },
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

- **Canonical agents** in `.aidt/agents/*.md`: frontmatter (name, role, tier, allowed capabilities: read / write / shell) + instructions.
- **Adapters** render them per harness:
  - v0: GitHub Copilot (VS Code agents, skills, instructions) and Claude Code (subagents, skills, hooks).
  - Later: Codex, Gemini CLI, Cursor…
  - Chat-only tools (ChatGPT web, self-hosted UIs): exported as copy-paste prompts.
- Shared standards used where they exist: `AGENTS.md`, Agent Skills.
- Hard guarantees (reviewer cannot edit, line limit, PASS bound to SHA) use hooks where supported; elsewhere they run as scripts in the reviewer step.

## 11. CLI (`aidt`)

TypeScript, Node 24, minimal dependencies.

| Command | What |
|---|---|
| `aidt add <product>` | Copy a product's files into the repo |
| `aidt sync` | Render canonical agents to each configured harness |
| `aidt diff [--section S1]` | Diff stats with noise filtered |
| `aidt clean` | Remove guide comments |
| `aidt check` | Section size, coverage, requirement→test mapping |
| `aidt stack <prepare\|submit>` | Build / publish the stack via the detected delivery adapter |
| `aidt customize <agent>` | Optional guided customization |

Agents call these scripts instead of doing mechanical work with tokens.

## 12. Distribution and security

- Public repo, MIT. Every product can be copied by hand (for locked-down environments).
- npm package `aidt` (or `npx`): no install scripts, no network calls, no telemetry, minimal pinned dependencies, signed provenance.
- VS Code extension: later and optional. Nothing depends on it.
- Integrated packages: `living-docs` has no runtime dependencies; `easy-repo-context` has one (`yaml`). Both are optional; neither calls a model or the network.

## 13. Roadmap

- **v0:** `workflow` (four agents, templates, `clean`, `check`, `diff`, `stack`), adapters for Copilot and Claude Code.
- **v1:** `review` (external PRs), `init`, `profile`, `docs` and `context` integrations, more adapters, measured token benchmarks.
- **v2:** VS Code extension (panel, per-section diff, progress) on the same core.

## 14. Open questions

1. Canonical agent format: custom frontmatter, or reuse an existing one (e.g. Claude subagent format) as the base?
2. `aidt check` coverage: read standard reports (lcov, cobertura) only, or run the test command?
3. Monorepo layout for the CLI: single package for v0, split later?
