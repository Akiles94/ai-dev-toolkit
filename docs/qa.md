# QA: the product in use, as each person

The [reviewer](reviewer.md) reads a change's code against its plan. The QA **uses the product**,
as each person who will use it plus someone with bad intentions, and reports what they would trip
over: dead ends, bugs, contradictions, broken promises and blind spots. Green tests and a
reviewer's PASS prove nothing to it: they cover the paths someone already thought of.

```bash
npx @akiles94/ai-dev-toolkit add qa
```

Then `/qa block` in Claude Code, or the `qa` agent in Copilot, naming the branch. It runs only
when you ask: no agent hands off to it.

[Why](#why-a-qa-and-not-only-a-reviewer) · [A pass](#a-pass) · [The walk](#the-walk) ·
[What you get](#what-you-get) · [The fixes](#the-fixes-and-their-tests) ·
[Before building](#before-building-the-plan-check) · [Limits](#limits)

## Why a QA, and not only a reviewer

A reviewer of the diff leaves three blind spots, and most of the serious problems of a growing
product hide in them:

- **The product is never used.** Nobody pressed back, reloaded, tapped twice or let the session
  expire.
- **Only the diff is read.** A block that adds a new kind of person (a family where there was one
  traveller) or a new state breaks older journeys its diff never shows.
- **Promises are not compared.** The landing page, the terms and the emails promise things the
  product may not do.

Run the reviewer first, then the QA, on a block that changes something a person uses (screens,
emails, texts, a design, a written process). A block with none keeps only the reviewer.

## A pass

1. **Scope and cost.** It reads what changed (the plan if there is one, the branch's files) and
   `.aidt/app.md`, the notes on how to run and use the product it shares with the
   [demo](demo.md) (it drafts them the first time). It proposes the journeys the change makes, the
   older journeys it touches (with the assumption each relied on), the promises about them, the
   people and states to try, about how many walks, and a token estimate. Nothing is walked until
   you say «scope approved».
2. **Walk.** One JSON file per journey and state, played by `aidt qa walk` in a real browser,
   with no model. It reads what the app answered at each step.
3. **Confirm.** Each finding's walk runs a second time; what does not show again goes under
   «Unconfirmed», never dropped.
4. **Verdict.** `FAIL` with a confirmed 🔴, or while a 🟡 is neither fixed nor written down as
   accepted by you: unowned 🟡 are how a hundred of them pile up. `PASS` otherwise, bound to the
   commit walked.
5. **Second pass**, after the fixes, in a fresh context with the first report: the findings'
   walks first (does each fix hold?), then what the first pass did not cover. A third needs your
   yes.

| Mode | Scope | When |
|---|---|---|
| `block` | the journeys a change makes and the ones it touches | after a block |
| `flow` | one whole flow, every person, every state | when a flow is complete |
| `audit` | every flow | before a first deployment or a launch |

## The walk

The agent writes the steps; the CLI plays them. No code of the agent's own runs on your machine
(it has no `node`, `curl` or install pre-approved), and running the same file again reproduces a
finding: it is how a developer sees it, and where its test starts.

```json
{
  "title": "A double tap on Add to cart",
  "app": { "url": "http://localhost:3000" },
  "people": { "shopper": { "device": "desktop" }, "intruder": { "device": "phone" } },
  "steps": [
    { "go": "/" },
    { "click": "Add to cart", "times": 2 },
    { "look": "the cart after a double tap" },
    { "keep": { "cart": "localStorage.getItem('shop.cartId')" } },
    { "as": "intruder", "request": { "method": "DELETE", "path": "/carts/{cart}/items/p-2" } }
  ]
}
```

| Step | What it does |
|---|---|
| `go`, `click`, `fill`, `select`, `press`, `wait` | As in a [demo script](demo.md#the-script); `click` takes `"times": 2` for a double tap |
| `back`, `reload` | The browser's back button, a reload |
| `look` | A screenshot and the page's visible text |
| `keep` | A value from the page (an id, an address), reused as `{name}` in later steps |
| `request` | A call to the app with the person's cookies: what a client that skips the page can do |
| `offline` | `true` makes every call fail, `false` brings them back |
| `clear` | `cookies` or `storage`: an expired session, a cleared browser |
| `as` | Beside any step: who does it. Each person has a browser of their own (`phone` or `desktop`) |

```text
$ aidt qa walk .aidt/tasks/feat-SHOP-40-storefront/qa/walks/double-tap.json
Walk «A double tap on Add to cart» · http://localhost:3000 · at 51814c5
 1 shopper    go /
      GET / 200 · GET /products 200 · POST /carts 201 · GET /carts/cart-7a416dc9 200
 2 shopper    click "Add to cart" ×2
      POST /carts/cart-7a416dc9/items 200 · POST /carts/cart-7a416dc9/items 200
 3 shopper    look «the cart after a double tap»
      screenshot: .aidt/qa/double-tap/03-shopper.png
      │ Cart
      │ Refactoring × 2
      …
 4 shopper    keep cart
      cart = "cart-7a416dc9"
 5 intruder   request DELETE /carts/{cart}/items/p-2
      200 {"id":"cart-7a416dc9","items":[],…}
Walked all 5 step(s).
Calls that failed or answered 4xx/5xx: 0 · console errors: 0 · page errors: 0
Log: .aidt/qa/double-tap/walk.json
```

For every step: the calls the page made with their status, console and page errors, calls that
failed. A step that cannot be done stops the walk with a screenshot of what the screen showed
instead, and says why: nothing matched, or what it found and why it could not use it (disabled,
hidden, covered). The app must already be running, started as `.aidt/app.md` says: the walk starts
nothing. Screenshots and logs go to `.aidt/qa/` (`qa.output`), which git ignores; the walks are
committed with the report. Playwright comes from the project or npm's global packages; when it is
missing, the walk prints how to install it.

## What you get

`.aidt/tasks/<task>/qa/<mode>-<slug>.md`, from `templates/qa-report.md`: the journeys, people and
states covered, each finding with its walk file and step, what was seen against what was expected
(and which document says so), a proposed fix, what could not be confirmed, the official data
checked with its source, what was not covered, and the decisions for you.

| Kind | |
|---|---|
| Dead end | no way forward and none back, an error with no way to retry |
| Bug | wrong data or state, something another person can see or do, a server error |
| Contradiction | two screens, or a screen and an email, saying different things |
| Broken promise | a page, email or term promising what the product does not do |
| Confusing | a text that does not say what to do next, a layout broken on the device |
| Blind spot | a situation the product does not consider at all |

🔴 blocks or misleads a person, loses data or shows it to someone else · 🟡 a real annoyance or
risk · ℹ️ a note. Code style and structure stay the reviewer's.

## The fixes and their tests

The QA never fixes anything. The fixes go through the workflow like any block, and every
confirmed finding that is fixed leaves a test that reproduces its walk, written with the fix (end
to end when the project has a suite): the QA explores once and expensively, the suite guards
cheaply from then on.

## Before building: the plan check

`aidt add qa` also brings `.aidt/practices/plan-check.md`, the list a block's plan goes through
before any code: people, states, seams with older journeys, contradictions, official data,
business, promises, and what is left out on purpose. The planner goes through it only in projects
that have it. A gap found in the plan costs a line; found by the QA, it costs a fix block.

## Limits

- Web apps, clickable designs and written processes. Slow calls, terminal apps and native mobile
  apps are not walked yet.
- It walks what runs locally: payments, email or AI services are only as real as the project's
  local fakes, which `.aidt/app.md` lists.
- The agent cannot see its own token usage; your tool's usage view does (`/cost` in Claude Code).
