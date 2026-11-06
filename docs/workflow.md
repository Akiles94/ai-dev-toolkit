# Workflow

Four agents that take a ticket to a stack of small, reviewed PRs, with you approving at every
step: the **refiner** decides *what*, the **planner** *how*, the **builder** writes one section at
a time with explanatory comments, and the **reviewer** checks everything with a fresh eye.

[Install](#install-and-run) · [The steps](#the-steps) · [Modes and control](#modes-and-control) ·
[Example](#example-low-stock-alerts-end-to-end) · [Cost](#cost-and-model) · [Limits](#limits)

```
ticket ─► refiner ─► spec.md ─► planner ─► plan.md ─► builder ─► code ─► reviewer ─► stack of PRs
          (what)      you ✓     (how)       you ✓    section by    you ✓   checks +       each with
                                                     section                review guide   its guide
```

## Install and run

```bash
npx @akiles94/ai-dev-toolkit add workflow
```

| Tool | How to run it |
|---|---|
| GitHub Copilot (VS Code) | Pick `refiner` and paste the ticket. After each approval the agent offers a button to the next one |
| Claude Code | `/refiner <ticket>`, then `/planner`, `/builder`, `/reviewer` |

Everything for a task lives in `.aidt/tasks/<branch>/`: `spec.md`, `plan.md`, `state.json` (phase,
approvals, sections and their commits) and `review/`. Any agent can resume from it.

## The steps

**1 · Refiner: what.** Branch first, then reads the code, asks every question in one message and
writes a spec with numbered requirements and acceptance criteria using real data. Detail:
[refiner](refiner.md).

**2 · Planner: how.** Reads the spec and the code, asks the design questions the code does not
settle, each with a recommended option, and writes `plan.md`:

| Block | What it holds |
|---|---|
| Approach | The chosen design and the discarded alternatives, one line each |
| Structure | Every file it will create or change, and its responsibility |
| Reuse | Existing code it reuses, so nothing is written twice |
| Sections | Parts of at most 300 reviewable lines, each with the requirements it covers |
| Tests | Which test proves each requirement |

**3 · Builder: code, one section at a time.** Writes the tests first, then the code, with `@guide`
comments that explain the decisions. It runs the project's tests and `aidt check`, then stops and
shows you the section: what it does, the files to open in order, and **decisions not in the
plan**, so nothing it decided on its own goes unseen. With your yes it removes the comments
(`aidt clean`), commits the section and moves on. It never redesigns: if the plan is wrong it
stops and says why.

**4 · Reviewer: verify and explain.** In a fresh context (it never saw the conversation that wrote
the code) it judges each section against the spec and the plan, runs every gate, searches for
defects, and writes one review guide per section. Detail: [reviewer](reviewer.md). On PASS and
your yes, `aidt stack prepare` makes one branch per section, each based on the previous one, and
`aidt stack submit` opens one draft PR per section with its guide as the description (`gh` or
`glab`). Publishing and merging always need a separate yes.

## Modes and control

**Mode**, by the size of the work. The refiner suggests one; you decide.

| Mode | For | What changes |
|---|---|---|
| `full` | Features, work in several sections | All four steps in full |
| `light` | Small fixes | Same steps, shortened: a few-line spec, a one-section plan |
| `rework` | Feedback on an open PR | Only the builder and the reviewer, on the affected section |

**Control**, by how much you want to review along the way. Set per task, change it any time.

| Control | You approve | The agents do on their own |
|---|---|---|
| `strict` | Spec, plan and every section, with its guide comments | Nothing |
| `standard` | Spec and plan | Build every section in a row, then review them all |
| `fast` | Only the spec | Plan, build and review; you review the finished stack |

At every level: sections stay under the limit, tests and checks run, a FAIL is never delivered,
and nothing is pushed or merged without your yes. Under `standard` and `fast` the reviewer shows
the builder's own decisions first, so you read what the AI decided alone before anything else.

## Example: low-stock alerts, end to end

[shop-api](https://github.com/Akiles94/aidt-examples), ticket SHOP-24 (*"the shop owner should find
out when stock drops below a threshold; show low-stock products in the admin"*), mode `full`,
control `strict`. Approvals were given by hand at every gate.

**1 · Refiner.** Flagged that there is no admin, no checkout and no notification channel, asked
seven questions, and wrote a spec with 10 requirements and 13 acceptance criteria. See
[the refiner example](refiner.md#example-low-stock-alerts).

**2 · Planner.** Found that `reserveStock` is the only place stock goes down, so it is the single
hook, and that comparing stock before and after a decrease covers "alert once, re-arm after
restock" with no stored flag. It asked eight design questions and proposed four tiny sections; the
answer was *"All A. But sections are tiny: merge into two"*. The approved plan:

| # | Section | Main files | Est. lines | Covers |
|---|---|---|---|---|
| S1 | Low-stock domain | `src/alerts.ts`, `src/low-stock.ts`, `src/products.ts`, `src/types.ts` | ~70 | R1–R6, R8–R10 |
| S2 | Admin endpoints | `src/server.ts` | ~25 | R7, R9 over HTTP |

**3 · Builder.** S1 test first, with guide comments like these while you review it:

```ts
// @guide: Newest first by reversing insertion order, not by sorting on `at`: two alerts in the same
// @guide: millisecond would otherwise have an undefined order (R9).
export function listAlerts(): LowStockAlert[] {
  return [...alerts].reverse();
}
```

It reported 65 reviewable lines and 162 test lines, `aidt check` with 9 of 10 requirements tested
(R7 belongs to S2), and its decisions not in the plan: a narrower parameter type, a test made
independent of order, and one extra test for a product already low at startup. After the yes it
committed S1 without the comments, then built S2 (12 lines, 4 HTTP tests, 10 of 10 requirements
tested).

**4 · Reviewer.** Both sections PASS: 25 of 25 tests, sizes within the limit, no guide comments
left, every boundary tested (5 to 4 alerts, staying at 5 does not, restocking to exactly 5
re-arms). Its warnings for the stack: `/admin/*` is open by decision, so the auth ticket must
cover it; nothing outside the tests calls `reserveStock` yet, so no alert fires until checkout
exists; alerts live in memory. After the yes, `aidt stack prepare`:

```text
1. feat/SHOP-24-low-stock-alerts-s01-low-stock-domain    → main     (55 reviewable lines)
2. feat/SHOP-24-low-stock-alerts-s02-admin-endpoints     → S1 branch (10 reviewable lines)
```

Full output: [spec, plan, every builder and reviewer answer, the guide comments of each section and
the review guides](https://github.com/Akiles94/aidt-examples/tree/main/examples/workflow), and the
two stacked PRs, [#3](https://github.com/Akiles94/aidt-examples/pull/3) and
[#4](https://github.com/Akiles94/aidt-examples/pull/4), with their guides as descriptions.

## Cost and model

Measured on the example above with Claude Code on 2026-11-06. Every agent is tier `balanced`, so
`claude-sonnet-5-5`:

| Step | Turns | Agent time | Tokens in (cached) | Tokens out | Cost at API prices |
|---|---|---|---|---|---|
| Refiner | 3 | 1 min 40 s | 569k (544k) | 9k | $0.25 |
| Planner | 3 | 1 min 13 s | 495k (462k) | 8k | $0.25 |
| Builder (2 sections) | 4 | 3 min 3 s | 1.6M (1.6M) | 18k | $0.54 |
| Reviewer + stack | 2 | 1 min 40 s | 741k (662k) | 13k | $0.39 |
| **Total** | 12 | **7 min 36 s** | 3.5M (3.3M) | 47k | **$1.43** |

Your reading and approvals are not in the agent time. Cost grows with the number of sections and
the code each one touches. In Copilot each agent uses the model selected in the chat; not measured.

## Limits

- Only the builder changes source code, and only inside the approved plan.
- The reviewer cannot change code; a FAIL goes back to the builder in `rework` mode.
- No push, PR or merge without an explicit yes; `aidt stack submit` needs `gh` or `glab`.
