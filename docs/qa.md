# QA

Uses the product end to end as each person who will use it, after a block of work, and reports
what a real person would trip over: dead ends, bugs, contradictions, broken promises and blind
spots. It never changes code, designs or documents.

[When to use it](#when-to-use-it) · [Install and run](#install-and-run) ·
[How it works](#how-it-works) · [What you get](#what-you-get) · [Limits](#limits)

## When to use it

The [reviewer](reviewer.md) reads the code of a change against its plan. That leaves three blind
spots, and they are where most of the serious problems of a growing product hide:

- **The product is never used.** Green tests cover the paths someone already thought of; nobody
  pressed back, reloaded, chose the same file twice or let the session expire.
- **Only the diff is read.** A block that adds a new kind of person (a family where there was one
  traveller) or a new state breaks older journeys its diff never shows.
- **Promises are not compared.** The landing page, the terms and the emails promise things the
  product may not do.

The QA covers those three. Run the reviewer first, then the QA, on every block that changes
something a person uses (screens, emails, texts, a design, a written process). A block with none,
such as infrastructure alone, keeps only the reviewer.

Before building, the block's plan goes through `.aidt/practices/plan-check.md`: a gap found in the
plan costs a line; found after building, it costs a fix.

## Install and run

```bash
npx @akiles94/ai-dev-toolkit add qa
```

| Tool | How to call it |
|---|---|
| GitHub Copilot (VS Code) | Pick `qa` in the chat and give the mode, the branch or design, and the plan |
| Claude Code | `/qa feat/checkout`, or launch it as a fresh subagent with `.claude/skills/qa/SKILL.md` |

## How it works

1. **Project facts, once.** It reads `.aidt/qa.md`: who the people are, how to start the product,
   what is faked locally, how to simulate time, what is already accepted. On the first call it
   drafts that file from the repository and stops so you can complete it.
2. **Scope and budget.** It lists the journeys the block changes, the older journeys it touches,
   the promises about them and what the plan leaves out on purpose, with the people, the states to
   try and a token estimate. Nothing is walked until you approve.
3. **Walk.** As each person, plus someone with bad intentions, from the real start to the real
   end: back, reload, another person's session, no session, double tap, empty and odd values,
   expired links and sessions, failed network calls, every email and where its links land.
4. **Confirm.** Each finding reproduced twice; what it saw once goes under «Unconfirmed», never
   dropped.
5. **Second pass.** A fresh run walks what the first did not cover. A third needs your yes.

| Mode | Scope | When |
|---|---|---|
| `block` | the journeys a block changes and the ones it touches | after each block |
| `flow` | one whole flow, every person, every state | when a flow is complete |
| `audit` | everything | before a first deployment or a launch |

## What you get

`.aidt/tasks/<task-id>/qa/<mode>-<slug>.md`, from `templates/qa-report.md`: the scope and what was
covered, every finding with exact steps, what was seen against what was expected (and which
document says so) and a proposed fix, the official data checked with its source, what was not
covered, and the decisions for you. **FAIL** with any confirmed 🔴, or while a 🟡 is neither fixed
nor accepted by you.

## Limits

- It walks what runs locally: real payment providers, real AI services or real phones are only as
  real as the project's local setup and fakes.
- A walk in a real browser costs more than a code review: that is why it asks for the scope and
  its budget first, and why `block` mode walks only what the block changes or touches.
