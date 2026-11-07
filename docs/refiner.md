# Refiner

Turns a ticket into a clear, testable spec: what to build, with numbered requirements,
acceptance criteria with real data from your code, edge cases and what is out of scope. It asks
before it assumes, and it writes no code.

[Install](#install-and-run) · [How it works](#how-it-works) · [What you get](#what-you-get) ·
[Example](#example-low-stock-alerts) · [Cost](#cost-and-model) · [Limits](#limits)

## When to use it

- A ticket is a single vague line ("the owner should find out when stock is low").
- Before handing work to a developer or to an AI, so both build the same thing.
- As the first step of the [workflow](workflow.md), where the planner continues from the spec.

## Install and run

```bash
npx @akiles94/ai-dev-toolkit add refiner
```

| Tool | How to call it |
|---|---|
| GitHub Copilot (VS Code) | Pick `refiner` in the chat and paste the ticket |
| Claude Code | `/refiner SHOP-24 <ticket text or link>` |

## How it works

1. **Branch first.** On the default branch it proposes one (`feat/SHOP-24-low-stock-alerts`) and
   creates it once you confirm. The task lives in `.aidt/tasks/<branch>/`.
2. **Reads the code** the ticket touches, so its questions and examples use your real data.
3. **Proposes a mode and a control level** (see [the workflow](workflow.md#modes-and-control)).
4. **Asks every question in one message**, each with options and a recommendation, and points out
   what the ticket assumes but the code does not have.
5. **Writes the spec** from `.aidt/templates/spec.md`, shows a summary and waits for your
   approval. It changes the spec until you approve it.

Installed alone it ends there: paste the spec into the ticket or give it to anyone. Installed
with the workflow it offers the hand-off to the planner.

## What you get

`.aidt/tasks/<branch>/spec.md`, with:

| Block | What it holds |
|---|---|
| Goal | Why, in two lines |
| Context | What the code does today, in plain words |
| Requirements | `R1`, `R2`… each one testable |
| Acceptance criteria | Given / When / Then with the project's real data |
| Edge cases | Limits, empty states, what happens at exactly the threshold |
| Out of scope | What will not be done, so nobody builds it |
| Decisions | What you chose, and the options you discarded |

## Example: low-stock alerts

[shop-api](https://github.com/Akiles94/ai-dev-toolkit-examples), ticket SHOP-24: *"When a product's stock
drops below a threshold after a purchase, the shop owner should find out. Show low-stock products
in the admin."*

Its first answer flagged three things the ticket takes for granted:

```markdown
- **There's no admin.** The only routes are `/products` and `/carts`.
- **There's no purchase or checkout.** Adding to a cart doesn't touch stock. `reserveStock` in
  `src/products.ts` decreases stock but nothing calls it.
- **There's no notification mechanism, and no owner contact.**
```

Then seven questions (what counts as a purchase, how the owner finds out, the threshold, whether
"below" is strict, what about 0, when alerts repeat, what "admin" means), answered in one message:
*"1b. 2b. 3a, value 5. Strict: stock < 5. 4a. 5: both, it is low and shown as out of stock. 6a,
open for now (auth is out of scope). 7: name, stock, threshold, lowest stock first."* The
approved spec has 10
requirements and 13 acceptance criteria using the real catalog:

```markdown
- **R3** When a stock decrease takes a product from at-or-above the threshold to below it, an
  in-app alert is recorded for the owner, once, with the product and its stock at that moment.
- **R4** No further alert is recorded for a product while its stock stays below the threshold.

| R1 | "Refactoring" has stock 5 | Owner opens the list | "Refactoring" is not listed (5 is not below 5) |
| R6 | "Tetris Effect" has stock 30 | 40 units are requested | Stock stays 30, no alert exists |
```

It also added one requirement on its own (a view of the recorded alerts) and asked whether to keep
it rather than slipping it in.

Full output: [the conversation, the answers and the spec](https://github.com/Akiles94/ai-dev-toolkit-examples/tree/main/examples/refiner).
The same spec continues through the [full workflow example](workflow.md#example-low-stock-alerts-end-to-end).

## Cost and model

Measured on the example above with Claude Code on 2026-11-06 (questions, answers, approval):

| Model | Turns | Agent time | Tokens in (cached) | Tokens out | Cost at API prices |
|---|---|---|---|---|---|
| `claude-sonnet-5-5` (tier `balanced`) | 3 | 1 min 40 s | 569k (544k) | 9k | $0.25 |

In Copilot it uses the model selected in the chat; not measured.

Setup: Claude Code with the default configuration
([how it was measured](../README.md#how-these-numbers-were-measured)). The model, and so the cost,
change with [`models` in the config](cli.md#models).

## Limits

- Writes only `spec.md` and `state.json` in the task folder. Never writes code.
- Creates the branch only after you confirm its name.
- If the task is too big for about 8 sections of 300 lines, it proposes splitting the ticket.
