# Structure

Code organisation that scales, for any stack: a minimal conventional layout, feature modules, or
DDD/hexagonal. A script audits the common rules for free; the `architect` agent reads your code,
proposes three paths and writes the decision down. Nothing is moved automatically.

[Install](#install-and-run) · [The rules](#the-rules) · [The architect](#the-architect) ·
[Example](#example-a-shop-api-that-will-grow) · [Cost](#cost-and-model) · [Limits](#limits)

## When to use it

- A new project: pick a level and a stack preset before the first feature.
- An existing project that grows messy: `utils.ts` with everything, a 1,000-line `api.ts`, a flat
  folder of 40 files.
- With the [workflow](workflow.md): the planner places code by the decision, the builder follows
  it and the reviewer checks it.

## Install and run

```bash
npx @akiles94/ai-dev-toolkit add structure
npx @akiles94/ai-dev-toolkit structure audit     # the rules, by script, no AI
```

| Tool | How to call the architect |
|---|---|
| GitHub Copilot (VS Code) | Pick `architect` in the chat |
| Claude Code | `/architect` (add what is coming: "orders and payments are next") |

It installs `.aidt/structure/`: the common rules, three levels (`conventional`, `modular`,
`architecture`) and presets for React, Next.js, React Native, Node.js, Go, C#, Java, Kotlin Android
and Swift iOS, each based on the stack's official guides.

## The rules

The same rules at every level. The audit checks S1–S5; the agents check S6–S7.

| Rule | What it catches |
|---|---|
| S1 · No junk drawers | `utils.ts`, `helpers/`, `common.ts` mixing unrelated things |
| S2 · One module per resource | One `types.ts` or `api.ts` for the whole app |
| S3 · Small files and folders | Files over 300 lines, folders with more than 15 files (defaults) |
| S4 · No loose files | Anything but entry points and folders at the source root |
| S5 · One naming convention per kind of file | `userService.ts` next to `order-service.ts` |
| S6 · Features do not reach into each other | Imports into another feature's internals |
| S7 · Tests where the stack expects them | Tests far from their code when the stack puts them together |

`aidt structure audit` exits with 1 when a rule is broken, so it works in CI. Deliberate exceptions
go under `## Exceptions` in `.aidt/structure.md`.

## The architect

1. **Reads first:** the audit, the file tree, the stack, what is coming.
2. **New project:** asks for a level and a preset, and writes the layout.
3. **Existing project:** describes what exists, then three paths: **keep it, improved**, move to the
   stack's **conventional** layout, or adopt **modules** or an **architecture**, each with its
   size, and a recommendation with the reason.
4. **Writes the decision** to `.aidt/structure.md` once you choose: level, preset, layout, naming,
   boundaries, exceptions, and a migration in small steps (moves apart from logic changes), each
   one a normal workflow task.

## Example: a shop API that will grow

[shop-api](https://github.com/Akiles94/aidt-examples) on `main`: 5 source files and 241 lines. The
audit, with no AI:

```text
Structure: 2 finding(s) in 5 source files
S1 · No junk drawers (1)
    src/utils.ts  junk-drawer file
S2 · One module per resource (1)
    src/types.ts  one file for the whole app: split it by feature
```

The architect, called with *"It will grow: orders, payments and users are coming next"*, added
what the script cannot see (all routing by hand in `server.ts`, tests in one folder), then:

| Path | What changes | Size |
|---|---|---|
| **A. Keep it, improved** | Split `utils.ts` and `types.ts`, tests next to their code; stay flat | About 6 files |
| **B. Conventional** (Node preset, level 1) | `routes/`, `controllers/`, `services/`, `db/` | About 10 files |
| **C. Modular** (Node preset, level 2) | `src/modules/<feature>/` plus `shared/` | About 8 files |

It recommended C because each upcoming resource gets its own folder from day one, and after the
"yes" wrote `.aidt/structure.md` with the target layout and a five-step migration:

```markdown
1. [ ] Create `shared/ids`, `shared/money` and `shared/http`, move the helpers out of `utils.ts`
   into them, and delete `utils.ts`. (Fixes S1.)
2. [ ] Split `types.ts` into `modules/products` and `modules/cart`, move `products.ts` and
   `cart.ts` into their modules as `*.service.ts`, and add an `index.ts` to each. (Fixes S2.)
```

It ended by offering step 1 as a ticket for the refiner, without starting it.

Full output: [the audit, both answers and the decision file](https://github.com/Akiles94/aidt-examples/tree/main/examples/structure).

## Cost and model

The audit is a script: free. The architect, measured on the example above with Claude Code on
2026-11-06:

| Model | Turns | Agent time | Tokens in (cached) | Tokens out | Cost at API prices |
|---|---|---|---|---|---|
| `claude-sonnet-5-5` (tier `balanced`) | 2 | 34 s | 266k (244k) | 3k | $0.15 |

On a bigger codebase it reads more files, so it costs more. In Copilot it uses the model
selected in the chat; not measured.

## Limits

- Never moves or rewrites code. The only file it writes is `.aidt/structure.md`.
- The audit checks names, sizes and places, not what the code does: S6 and S7 are judged by the
  agents.
