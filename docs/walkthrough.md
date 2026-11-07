# Walkthrough

Walks you through a large pull request from someone else, one section of at most 300 lines at a
time, in reading order, with explanatory comments written into a local copy of the code. You stay
in control of what you approve. It never changes your branch, pushes or comments on the PR.

[Install](#install-and-run) · [How it works](#how-it-works) · [What you get](#what-you-get) ·
[Example](#example-checkout-and-orders-893-lines) · [Cost](#cost-and-model) · [Limits](#limits)

## When to use it

A teammate opens a 900-line PR. Skimming it and approving is how bugs get in; asking an AI
for a verdict leaves you not knowing the code you approved. The walkthrough splits the PR into
parts you can review in one sitting and explains each one inside the code.

When you only need a verdict and the findings, use the [reviewer](reviewer.md): it is faster and
cheaper.

## Install and run

```bash
npx @akiles94/ai-dev-toolkit add walkthrough
```

| Tool | How to call it |
|---|---|
| GitHub Copilot (VS Code) | Pick `walkthrough` in the chat and give the PR number or branch |
| Claude Code | `/walkthrough 123` or `/walkthrough feat/checkout-orders` |

With a PR number it reads the title, description and base with `gh` or `glab`; without them, give
it the branch and the base.

## How it works

1. **Opens the PR without touching your checkout.** It fetches the PR and runs
   `aidt walkthrough start`, which checks it out in `.aidt/walkthrough/<name>/`. Git ignores that
   folder (through `.git/info/exclude`), so it never shows in `git status` or a commit.
2. **Splits it, for free.** The same command splits the change by script, with no tokens:
   - sections of at most `limits.sectionLines` (300 by default), tests included;
   - reading order: contracts and types, core logic, integration, UI, docs, then config;
   - each test right next to the code it tests, or right after it when both don't fit;
   - a folder that fits in a section is never split;
   - lockfiles, generated files and formatting-only changes listed apart and never read.
3. **Shows the map** (sections, lines, what each is about, reading time) and asks for the ticket.
4. **One section at a time.** It writes `@guide` comments into the copy: one per file, one per
   changed function (what it does, the decision behind it, what to check), and findings at the
   exact line (🔴 bug · 🟡 worth a look · ❓ question). It rates the section's quality with the
   same dimensions as the [reviewer](reviewer.md#how-it-reviews) and leaves up to 5 suggestions as
   `@guide 💡` comments. In the chat it sums the section up and gives its opinion, then **waits** for you: next, go back, dig deeper, or stop.
5. **Closes:** requirement coverage, and the findings written as review comments to paste, with
   the line in the PR. With your yes, `aidt walkthrough finish` removes the copy and every comment.

Progress and findings are kept in `.aidt/walkthrough/<name>.md`, so a later session can resume.

## What you get

- **In your editor:** the PR's code with the explanation next to each function.
- **In the chat:** per section, what it does, what to read carefully, findings and an opinion.
- **At the end:** coverage per requirement and review comments ready to paste.

## Example: checkout and orders, 893 lines

[shop-api](https://github.com/Akiles94/ai-dev-toolkit-examples), PR `feat/checkout-orders` for ticket
SHOP-31: checkout with all-or-nothing stock, a payment gateway port, and the order lifecycle.
893 changed lines in 12 files, written by another agent playing the teammate.

The map, before reading any code:

| # | Section | Lines | What it is about |
|---|---|---|---|
| S1 | Contracts and core · `src/` | 297 | Order model, order service (checkout, ship, cancel), payment port and fake |
| S2 | Tests · `orders.test.ts`, `cart.test.ts` | 263 | Tests for the order logic |
| S3 | Tests · `payments.test.ts`, `products.test.ts` | 52 | Fake gateway and stock |
| S4 | Integration · `src/server.ts`, `README.md` | 113 | Routes and the 409 / 402 mapping |
| S5 | Tests · `orders-api.test.ts` | 168 | HTTP-level tests |

What you read in your editor in S1 (excerpt of the 235 comment lines it wrote):

```ts
// @guide The main flow, in this order:
//   1. validate the cart (not found / empty / already checking out),
//   2. reserve all stock or return OUT_OF_STOCK with the ids (R1),
//   3. charge the gateway for the total of the price snapshot (R2),
//   4. declined -> PAYMENT_DECLINED; the finally releases the stock (R4),
//   5. paid -> store the order as "paid" with history, empty the cart (R3, R8).
// What to check: `paid` is the flag the finally uses. It only turns true after the
// charge succeeded, so every early return and every throw gives the stock back. Correct.
// @guide 🟡 clearCart (line ~111) removes everything in the cart, but the charge covered
// only the copy taken at line ~82. Anything added to the cart while the gateway call is
// pending is deleted without being paid. Only reachable with a slow real gateway.
export async function checkout(
```

In S2 it noticed two test assertions that cannot fail (a filter always satisfies its own
predicate; Map keys are always unique), so the `cancelled` filter was never really tested. At the
end: all 8 requirements met, no 🔴, and 9 review comments to paste, such as:

```markdown
**`src/server.ts:130`** 🟡: a body of JSON `null` makes `body.cardToken` throw, so the client
gets 500 `INTERNAL` instead of 400 `INVALID_PAYMENT`. The items route at `:114` has the same
pattern. A guard like `if (!body || typeof body !== "object")` would fix it.
```

Full output: [every section as the agent presented it, all the guide comments, the notes and the
closing comments](https://github.com/Akiles94/ai-dev-toolkit-examples/tree/main/examples/walkthrough), and
[the PR](https://github.com/Akiles94/ai-dev-toolkit-examples/pull/2).

## Cost and model

Measured on the example above with Claude Code on 2026-11-06, the whole PR (5 sections and the
close):

| Model | Turns | Agent time | Tokens in (cached) | Tokens out | Cost at API prices |
|---|---|---|---|---|---|
| `claude-sonnet-5-5` (tier `balanced`) | 7 | 6 min 55 s | 2.5M (2.4M) | 44k | $1.11 |

Each turn re-reads the conversation, which is why input grows with the sections; almost all of it
is cache reads (a tenth of the price of fresh input). Stopping early costs only what you read. On
another PR of 970 lines it cost $0.68 for two sections and the close. In Copilot it uses the model
selected in the chat; not measured.

Setup: Claude Code with the default configuration
([how it was measured](../README.md#how-these-numbers-were-measured)). The model, and so the cost,
change with [`models` in the config](cli.md#models).

## Limits

- Writes only inside `.aidt/walkthrough/`. Never changes your checkout or branch.
- Never commits, pushes, approves, merges or posts on the PR or MR.
- Does not run the PR's code or install its dependencies unless you ask.
- The order of sections comes from paths; the agent may reorder them and says why.
