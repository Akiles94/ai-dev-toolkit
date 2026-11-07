# AI Dev Toolkit

[![npm](https://img.shields.io/npm/v/@akiles94/ai-dev-toolkit)](https://www.npmjs.com/package/@akiles94/ai-dev-toolkit)
[![CI](https://github.com/Akiles94/ai-dev-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Akiles94/ai-dev-toolkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Use AI to write code without losing control of it.**

Agents for GitHub Copilot and Claude Code that turn a ticket into a spec you approve, a plan you
approve, and small explained sections you approve, delivered as a stack of reviewable PRs. Use the
whole workflow, just the reviewer, or the walkthrough to get through a teammate's huge PR.

## Quick start

Requires Node 24 and git. Works on Windows, macOS and Linux.

```bash
cd your-project

npx @akiles94/ai-dev-toolkit add reviewer    # just the reviewer: review any branch against its ticket
npx @akiles94/ai-dev-toolkit add walkthrough # walk a big PR from a teammate, 300 lines at a time
npx @akiles94/ai-dev-toolkit add workflow    # the full workflow: refiner → planner → builder → reviewer
npx @akiles94/ai-dev-toolkit add structure   # code organisation rules, stack presets and an architect
```

Then, in your AI tool:

| | GitHub Copilot (VS Code) | Claude Code |
|---|---|---|
| Review a branch | Pick `reviewer` in the chat, paste the ticket | `/reviewer <ticket>` |
| Walk a big PR | Pick `walkthrough`, give the PR number | `/walkthrough 123` |
| Start a task | Pick `refiner`, paste the ticket; each agent offers a button to the next | `/refiner <ticket>`, then `/planner`, `/builder`, `/reviewer` |
| Organise the code | Pick `architect` | `/architect` |

## The problem

- **No control.** AI writes code faster than anyone can understand it. It works, nobody knows
  exactly how, and it breaks later.
- **No method.** Every developer uses AI their own way: no shared structure, no consistency.
- **Unreviewable PRs.** 1,500-line pull requests get skimmed and approved, or approved by another AI.

## What's in the box

| | What it does | Docs and example |
|---|---|---|
| `workflow` | Four agents. The **refiner** turns a ticket into a spec (*what*), the **planner** into a plan of sections of ~300 lines (*how*), the **builder** writes one section at a time with explanatory comments, and the **reviewer** checks everything with a fresh eye and writes one review guide per PR. | [workflow](docs/workflow.md) |
| `reviewer` alone | Reviews any branch against its ticket, no spec needed: hunts for real defects, verifies each one before reporting it, and writes a guide ready to paste as the PR description. | [reviewer](docs/reviewer.md) |
| `walkthrough` | Walks you through someone else's large PR, one section of ≤300 lines at a time, in reading order, with explanatory comments written into a local copy of the code. You stay in control of what you approve. | [walkthrough](docs/walkthrough.md) |
| `refiner` alone | Turns a ticket into a clear, testable spec you can hand to anyone. | [refiner](docs/refiner.md) |
| `structure` | Code organisation that scales: a minimal conventional layout, feature modules or DDD/hexagonal, with presets for React, Next.js, React Native, Node.js, Go, C#, Java, Kotlin Android and Swift iOS. Audits existing projects and proposes a refactor, never forces one. | [structure](docs/structure.md) |
| `aidt` CLI | The mechanical work, done by scripts instead of tokens: diff stats without noise, section limits, guide-comment cleanup, stacked PRs, structure audit. | [cli](docs/cli.md) |

Everything is copied into your repo as plain Markdown and becomes yours to edit. No runtime
dependency, no network calls, no telemetry.

Each page explains what the tool does step by step and shows a real run on
[shop-api](https://github.com/Akiles94/ai-dev-toolkit-examples), a small demo repository where every output
is kept in full, so you can see the results before installing anything. Measured with Claude Code:

| Run | Model | Agent time | Cost at API prices |
|---|---|---|---|
| [Reviewer](docs/reviewer.md#cost-and-model), 65-line branch | Sonnet | 1 min 17 s | $0.22 |
| [Walkthrough](docs/walkthrough.md#cost-and-model), 893-line PR, all 5 sections | Sonnet | 6 min 55 s | $1.11 |
| [Refiner](docs/refiner.md#cost-and-model), one-line ticket to spec | Sonnet | 1 min 40 s | $0.25 |
| [Architect](docs/structure.md#cost-and-model), audit and proposal | Sonnet | 34 s | $0.15 |
| [Full workflow](docs/workflow.md#cost-and-model), ticket to 2 stacked PRs | Sonnet | 7 min 36 s | $1.43 |

### How these numbers were measured

- **Tool:** Claude Code 2.1.319, run headless (`claude -p`), with approvals and answers typed by
  hand at every gate, as a user would.
- **Configuration:** the defaults, with no `models` block in `.aidt/config.json`. Every agent
  is tier `balanced`, so all runs used `claude-sonnet-5-5`.
- **Cost:** what Claude Code reports at API list prices, cache reads included (most input tokens
  are cache reads, a tenth of the price of fresh input). With a Claude subscription the runs count
  toward usage limits instead.
- **One run each**, on a small demo repository. Three reviewer runs on the same branch cost
  between $0.22 and $0.29: expect that kind of spread from run to run.
- **Not measured:** GitHub Copilot, which bills by premium requests of your plan and uses the model
  selected in the chat or [configured per tier](docs/cli.md#models).

Your cost depends on that configuration: [choosing the model](docs/cli.md#models) of each agent
is the biggest lever. A `max` tier (Opus) costs more per token than `balanced` (Sonnet), and
`efficient` (Haiku) less. It also grows with the size of the change and the code around it.

## How the workflow works

```
ticket ─► refiner ─► spec.md ─► planner ─► plan.md ─► builder ─► code ─► reviewer ─► stack of PRs
          (what)      you ✓     (how)       you ✓    section by    you ✓   checks +       each with
                                                     section                review guide   its guide
```

| Step | Agent | You get | You decide |
|---|---|---|---|
| 1 | `refiner` | `spec.md`: branch, numbered requirements, acceptance criteria with real data | What to build |
| 2 | `planner` | `plan.md`: approach, structure, sections ≤300 lines, a test for every requirement | How to build it |
| 3 | `builder` | Code, one section at a time, with `@guide` comments removed on approval | Approve each section |
| 4 | `reviewer` | A verdict per section, verified findings, one review guide per PR | Publish |

**Big feature or small fix.** The refiner suggests a mode, or you pick one:

| Mode | For | What changes |
|---|---|---|
| `full` | Features, multi-section work | All four steps, in full |
| `light` | Small fixes | The same steps, shortened: a few-line spec, a one-section plan |
| `rework` | Feedback on an open PR | Only the builder and the reviewer, on the affected section |

**Short on time.** Choose how much you review, per task:

| Control | You approve | The AI does on its own |
|---|---|---|
| `strict` | Spec, plan and every section | Nothing |
| `standard` | Spec and plan | Builds all sections in a row and reviews them |
| `fast` | Only the spec | Plans, builds and reviews; you review the finished stack of PRs |

At every level sections stay small, tests and quality checks run, a failed review is never
delivered, and nothing is pushed or merged without your yes.

## The reviewer, on a real branch

A test branch with three planted bugs and green tests. The reviewer found all three, and one more
nobody planted:

```markdown
### 🔴 Cart total skips the first item · `src/checkout.js:6`
**Fails when:** items = [{500c, qty 1}, {1000c, qty 1}] → total 1000 instead of 1500.
The only test hides this by giving the first item price 0.
**Fix:**
    for (let i = 0; i < items.length; i++) total += items[i].priceCents * items[i].qty;

### 🔴 Unknown code is silently ignored · `src/checkout.js:13`
`Object.hasOwn` matters: with a plain `[]` lookup, code = "constructor" finds an inherited
function and the total becomes NaN.
```

How it gets there:

- **Asks for the ticket first.** Tickets often exist even when the branch and commits don't
  mention them.
- **Reads beyond the diff.** Callers, callees and tests of every changed function.
- **Goes through a fixed list.** Logic, edge cases, errors, security, async, performance,
  compatibility and test quality.
- **Verifies before reporting.** Every finding is re-checked and dropped if it can't be confirmed,
  so the list stays short and real.

## The walkthrough, on a real PR

A 970-line PR on [Valija](https://github.com/Akiles94/valija) (vault lifecycle, context save,
search and export). `aidt walkthrough start` split it, for free, into:

```
S1  Contracts and types + Core logic · src/domain, src/domain/ports, …  (287 lines)
S2  Core logic + Integration · src/application/usecases, …              (276 lines + 257 test)
S3  Integration · src/infrastructure/keychain, src/infrastructure       (78 lines)
S4  Tests · tests/helpers                                               (79 lines)
```

Then the agent went one section at a time and waited after each. You read the code in your
editor, explained inline (translated from Spanish, the language of the conversation):

```ts
// @guide Flow: read header -> key from the keychain (null = VAULT_LOCKED) ->
// @guide open the DB with the key -> migrate -> return repos + close().
open(): Result<VaultSession, DomainError> {
  …
  // @guide 🔴 If migrate() throws, nobody closes the connection openVaultDb returned:
  // @guide one leaked handle per failed attempt. Fix: close db in the catch.
  migrate(db);
```

At the end: requirement coverage, 3 🔴 and 9 🟡 findings written as review comments ready to
paste, and the local copy removed with every comment in it. Your branch is never touched.

## The full workflow, on a real task

A trial on [Valija](https://github.com/Akiles94/valija), a TypeScript CLI and desktop app, for
"filter search by type" (approvals simulated to test the flow end to end):

1. **Refiner:** 5 requirements with real example data.
   > **R3** An unknown type is rejected with the same error `show` uses (`INVALID_ITEM_TYPE`).
2. **Planner:** two sections, every requirement mapped to a test.

   | # | Section | Est. lines | Covers |
   |---|---|---|---|
   | S1 | Type filter in the domain | ~70 | R1, R2, R3 |
   | S2 | CLI and desktop | ~60 | R4, R5 |
3. **Builder:** each section with `@guide` comments, stopped for approval, then committed clean:
   45 and 81 reviewable lines.
4. **Reviewer:** all 5 requirements met, but **FAIL** on both sections. A format doc still said
   search had no type filter, and a generated guide was stale. Exactly the kind of drift a
   1,500-line PR hides.

## CLI

Agents call these instead of spending tokens on mechanical work. They also work on their own in
any git repository. Without a global install, run them as `npx @akiles94/ai-dev-toolkit <command>`.

| Command | What it does |
|---|---|
| `aidt add <product\|agent>` | Copy `workflow`, `structure`, `reviewer`, `refiner` or `walkthrough` into `.aidt/` and generate the agents |
| `aidt sync [--check]` | Regenerate the Copilot and Claude Code files after editing `.aidt/agents/`; `--check` fails in CI if they are stale |
| `aidt diff [--json]` | Diff stats with tests, config, lockfiles and formatting counted apart |
| `aidt clean [--check]` | Remove `@guide` comments; `--check` fails if any are left |
| `aidt check` | Task gates: section sizes, every requirement has a test |
| `aidt stack prepare` / `submit` | One branch and one draft PR per reviewed section (`gh` or `glab`) |
| `aidt structure audit` | Check the structure rules; exceptions live in `.aidt/structure.md` |
| `aidt walkthrough plan` | Split a change into sections of ≤300 lines, in reading order |
| `aidt walkthrough start <ref> <name>` / `finish <name>` | Check a PR out in an ignored local copy and plan it / remove it with its comments |

## Make it yours

- Edit anything in `.aidt/`: agents, templates, practices. Then run `aidt sync`.
- Add `aidt sync --check` and `aidt clean --check` to CI.
- Choose the model of every agent in one place, `models` in `.aidt/config.json`: move an agent to
  another tier (`efficient`, `balanced`, `max`) and say which model each tier uses per tool. In
  Claude Code the tiers default to Haiku, Sonnet and Opus; in Copilot the agent uses the model
  selected in the chat unless you set one. Details: [configuration](docs/cli.md#configuration).

## Roadmap

- `init`: guided setup of your project's AI files (`AGENTS.md`, rules, structure).
- `profile`: your personal coding preferences, applied on every project.
- `docs` and `context`: living docs for people and lean context for agents, powered by
  [living-docs](https://github.com/Akiles94/living-docs) and
  [easy-repo-context](https://github.com/Akiles94/easy-repo-context).
- More AI tools (Codex, Gemini CLI, Cursor) and published token measurements.

Design and decisions: [docs/design.md](docs/design.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Oscar Vinueza
