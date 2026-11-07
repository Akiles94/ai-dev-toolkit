# Reviewer

Reviews a branch against its ticket, like a careful senior reviewer: it hunts for real defects
beyond the diff, verifies each one before reporting it, rates the quality of the new code, gives a
PASS or FAIL verdict and writes a guide ready to paste as the PR description. It never edits code.

[Install](#install-and-run) · [How it reviews](#how-it-reviews) · [What you get](#what-you-get) ·
[Example](#example-discount-codes) · [Cost](#cost-and-model) · [Limits](#limits)

## When to use it

- Before opening your own PR, to catch what the tests miss.
- On any branch or PR, yours or not, when you want a verdict and the findings fast.

To understand a large PR from someone else part by part, use the
[walkthrough](walkthrough.md) instead. Inside the [workflow](workflow.md), the reviewer also checks
each section against the spec and plan, and prepares the stack of PRs.

## Install and run

```bash
npx @akiles94/ai-dev-toolkit add reviewer
```

This copies the agent, the review templates and the practices into `.aidt/`, and generates
`.github/agents/reviewer.agent.md` (Copilot) and `.claude/skills/reviewer/SKILL.md` (Claude Code).

| Tool | How to call it |
|---|---|
| GitHub Copilot (VS Code) | Pick `reviewer` in the chat's agent picker and paste the ticket |
| Claude Code | `/reviewer SHOP-12: <ticket text or link>` |

Run it on the branch to review. It compares it with the default branch, or with the base you name.

## How it reviews

1. **Asks for the ticket first.** A ticket often exists even when the branch and commits don't
   mention it, so it asks for it (link, text, or "there is none") and for anything else to keep
   in mind. The ticket becomes numbered requirements (`R1`, `R2`…).
2. **Gathers the facts with scripts, not by eye:** `aidt diff --json` (reviewable lines without
   lockfiles, generated files or formatting), the project's tests and checks,
   `aidt clean --check`, and `aidt structure audit` when the project uses it.
3. **Looks for defects where the risk is:** skips what cannot break, reads each changed function
   with its callers, callees and tests, and goes through a fixed list: logic, edge inputs,
   errors and partial state, security, async, performance, compatibility and test quality.
4. **Verifies every finding** by trying to prove it wrong. What it cannot confirm is dropped, so the
   list stays short and real.
5. **Rates the quality** of the changed code with `.aidt/practices/code-quality.md`: structure,
   practices, readability, maintainability, performance, security and tests, each ✅ good,
   🟡 improvable, 🔴 broken rule or ➖ not applicable, plus at most 5 concrete suggestions per
   section. Edit that file to add or change dimensions.
6. **Judges:** each requirement is met, partial or missing, with `file:line`. Any confirmed 🔴, a
   missing requirement, a failing check or a quality rule broken means FAIL (a 🟡 never does), with exactly what would turn it into PASS.
   The verdict is bound to the reviewed commit.

## What you get

A short verdict in the chat, and the guides in `.aidt/tasks/<branch>/review/`:

| Block | What it holds |
|---|---|
| At a glance | Reviewable lines, test lines, noise filtered, reading time |
| Predict first | One question to read the change with a goal |
| What it does | The behavior after the change, with `file:line` |
| Walkthrough | One realistic input followed step by step, with real values |
| Reading order | Which files to read carefully and which to skim |
| Requirement coverage | Each requirement: where, which test, met / partial / missing |
| Findings | 🔴 bug · 🟡 worth a look · ℹ️ note, each with the input that fails and the fix |
| Quality | One rating per dimension, and up to 5 suggestions with `file:line` and the change |
| Questions for the author | What only the author can answer |

The blocks come from `.aidt/templates/review-section.md`: edit it to change the review.

## Example: discount codes

[shop-api](https://github.com/Akiles94/ai-dev-toolkit-examples), branch `feat/discount-codes`: 65
reviewable lines for ticket SHOP-12, with 11 green tests and three bugs the ticket contradicts.
The call:

```text
/reviewer Ticket: SHOP-12 Discount codes. A customer can apply one discount code to their cart
(…) fixed codes take a fixed amount off, but the discount never exceeds the subtotal. A code is
valid through the end of its expiry date (UTC). (…) Free shipping (from $50) is based on the
subtotal after the discount. (…) Nothing else to keep in mind, base is main.
```

Verdict **FAIL**, with the three bugs found, each with a failing case and a fix:

````markdown
### 🔴 Fixed discount can exceed the subtotal · `src/discounts.ts:30`
**Fails when:** one 2999-cent item and `BIGSAVER` (3000) → discount 3000. With an empty cart and
`FIVEOFF` → discount 500, `totalCents = -500`. Negative totals are possible.
**Fix:**
```suggestion
  return Math.min(code.value, subtotalCents);
```

### 🔴 Free shipping uses the subtotal before the discount · `src/cart.ts:62`
**Fails when:** 5000-cent subtotal with `WELCOME10`: discount 500, post-discount 4500, but
`subtotalCents >= 5000` gives shipping 0. The ticket says free shipping is based on the subtotal
after the discount, so shipping should be 499.
````

Plus the expiry bug (a code dies at the start of its last valid day) and a coverage table: 5
requirements met, 1 partial, 3 missing. Then the quality of the new code:

| Dimension | Rating | Why |
|---|---|---|
| Structure | 🟡 | New `src/discounts.ts` is well placed. The audit flags `src/types.ts` and `src/utils.ts`, both existing before; this change only adds 2 lines to `types.ts`. |
| Practices | ✅ | Errors as values, same style as `addItem`. |
| Readability | ✅ | Small functions, clear names. |
| Maintainability | 🟡 | Code table hard-coded at `discounts.ts:10`; `totals` cannot inject the date, so it is hard to test expiry through the cart. |
| Performance | ✅ | One lookup per totals call. |
| Security | ✅ | Body type checked; lookup is a record key with uppercased input. |
| Tests | 🔴 | No test covers the boundary day, the cap, the shipping rule or the HTTP 400 responses. Three requirements with bugs have no test. |

With two suggestions: the exact tests to add, and a `Map` for the code table so user input can
never hit inherited object keys.

Full output: [the guide, the chat answer and the ticket](https://github.com/Akiles94/ai-dev-toolkit-examples/tree/main/examples/reviewer),
and [the PR](https://github.com/Akiles94/ai-dev-toolkit-examples/pull/1) with the guide as its description.

## Cost and model

Measured on the example above with Claude Code on 2026-11-07, quality review included:

| Model | Turns | Agent time | Tokens in (cached) | Tokens out | Cost at API prices |
|---|---|---|---|---|---|
| `claude-sonnet-5-5` (tier `balanced`) | 1 | 1 min 17 s | 332k (298k) | 11k | $0.22 |

Most input tokens are cache reads, which cost a tenth of fresh input. With a Claude subscription
the run counts toward your usage limits instead of costing money. In Copilot the agent uses the
model selected in the chat and counts as premium requests of your plan; we have not measured it.
The cost grows with the size of the change and of the code around it, not with the repository.

## Limits

- Never changes source code, pushes, merges or comments on the PR. The only files it writes are
  the guides (and `state.json` inside the workflow).
- Runs only read-only git commands, the project's test and check scripts, and `aidt`.
- Reviews committed code: uncommitted changes are not part of the verdict.
- Without a ticket it cannot check requirement coverage; it says so and judges everything else.
