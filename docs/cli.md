# CLI (`aidt`)

The mechanical work, done by scripts instead of tokens. The agents call these commands; they also
work on their own in any git repository, with no agent installed.

```bash
npx @akiles94/ai-dev-toolkit <command>     # no install
npm install -g @akiles94/ai-dev-toolkit    # then: aidt <command>
```

Requires Node 24 and git. No network calls, no telemetry. Exit codes: `0` ok · `1` findings
(`--check`, a broken rule, a stack not ready) · `2` usage or git error.

## Which changes

Every command that reads a diff takes the same source options. The default is
`<default branch>...HEAD`, like a PR.

| Option | Compares |
|---|---|
| `--base <ref>` / `--head <ref>` | `<base>...<head>`, from their merge base |
| `--staged` | Staged changes only |
| `--worktree` | Uncommitted changes, untracked files included |

## Commands

| Command | What it does |
|---|---|
| `aidt add <product\|agent>` | Copy `workflow`, `structure`, or one agent alone (`reviewer`, `refiner`, `walkthrough`) into `.aidt/`, then `sync`. Never overwrites a file you changed |
| `aidt sync [--check]` | Render `.aidt/agents/*.md` for Copilot (`.github/agents/`) and Claude Code (`.claude/skills/`). `--check` fails when they are stale |
| `aidt diff [--files] [--json]` | Diff stats with tests, config, noise (lockfiles, generated, snapshots) and formatting-only changes counted apart |
| `aidt clean [paths…] [--check]` | Remove `@guide` comments from changed files; `--check` lists them and fails |
| `aidt check [--json]` | Task gates for the workflow: every section within the limit, every requirement referenced by a test |
| `aidt stack prepare` / `submit [--dry-run]` | One branch per reviewed section, each based on the previous one / push them and open one draft PR each (`gh` or `glab`) |
| `aidt structure audit [--json]` | Check the structure rules S1–S5; exceptions in `.aidt/structure.md` |
| `aidt walkthrough plan [--json]` | Split a change into sections of at most 300 lines, in reading order |
| `aidt walkthrough start <ref> [name]` / `finish <name>` | Check a change out in an ignored local copy under `.aidt/walkthrough/` and plan it / remove it |

## Real outputs

All from [shop-api](https://github.com/Akiles94/ai-dev-toolkit-examples).

`aidt diff` on the 893-line PR: code and tests apart, and how many sections it needs.

```text
Source: origin/main...HEAD

Code       7 files    +402 −8
Tests      5 files    +481 −2
    tests/cart.test.ts  +9 −1
    tests/orders-api.test.ts  +168 −0
    tests/orders.test.ts  +253 −0
    tests/payments.test.ts  +43 −0
    tests/products.test.ts  +8 −1

Reviewable lines: 410 · limit 300 per section → at least 2 sections
```

`aidt walkthrough plan` on the same PR: sections in reading order, tests next to their code.

```text
Walkthrough: 5 sections · 893 lines · limit 300 per section

S1  Contracts and types + Core logic · src  (297 lines)
    src/types.ts  +27 −0
    src/cart.ts  +15 −3
    src/orders.ts  +180 −0
    …
S2  Tests · tests  (263 lines)
…
```

`aidt check` at the end of the workflow example:

```text
Sections (limit 300 lines)
  ✓ S1  55 reviewable lines
  ✓ S2  10 reviewable lines
Requirements with a test: 10/10
```

`aidt structure audit` on `main`:

```text
Structure: 2 finding(s) in 5 source files
S1 · No junk drawers (1)
    src/utils.ts  junk-drawer file
S2 · One module per resource (1)
    src/types.ts  one file for the whole app: split it by feature
```

## In CI

```yaml
- run: npx @akiles94/ai-dev-toolkit sync --check     # generated agents up to date
- run: npx @akiles94/ai-dev-toolkit clean --check    # no guide comments merged
- run: npx @akiles94/ai-dev-toolkit structure audit  # when the project uses structure
```

## Configuration

`.aidt/config.json`, created by `aidt add`. The values teams change first:

| Key | Default | What |
|---|---|---|
| `limits.sectionLines` | `300` | Reviewable lines per section, for the builder, the reviewer and the walkthrough |
| `limits.exclude` | lockfiles, snapshots, generated, build output | Globs counted as noise |
| `guide.marker` | `@guide` | The marker of removable guide comments |
| `sync.harnesses` | `["copilot", "claude-code"]` | Which AI tools to generate agents for |
| `workflow.control` | `strict` | Default control level for new tasks |
