# AI Dev Toolkit

**Use AI to write code without losing control of it.**
A spec-driven workflow where AI does the typing and you keep the decisions, the understanding and the review.

> ⚠️ Status: design stage. Nothing to install yet. See [docs/design.md](docs/design.md).

## The problem

- **No control.** AI generates code faster than anyone can understand it. It "works", nobody knows exactly how, and it breaks later.
- **No method.** Every developer on the team uses AI their own way. No shared structure, no documentation, no consistency.
- **Unreviewable PRs.** 1,500–2,000 line pull requests that get skimmed and approved, or approved by another AI.

## What you get

- **Clear intent before code.** Every task becomes a business spec (*what*) and a technical plan (*how*) you approve before anything is written.
- **Small, explained changes.** Work is split into sections of ~300 lines. Each one is built, explained and approved before the next starts.
- **Reviewable by default.** Each section ships as its own PR in a stack, with its own reading guide. No more giant PRs.
- **Works with your tools.** Agnostic: Copilot, Claude Code and more. Your models, your rules.

## How it works

```
ticket ─► refiner ─► spec.md ─► planner ─► plan.md ─► builder ─► code ─► reviewer ─► stack of PRs
          (what)      you ✓     (how)       you ✓    section by    you ✓   cleanup +      each with
                                                     section                review guide   its guide
```

| Step | Agent | You get | You decide |
|---|---|---|---|
| 1 | `refiner` | `spec.md`: branch, requirements, acceptance criteria | What to build |
| 2 | `planner` | `plan.md`: approach, structure, sections ≤300 lines | How to build it |
| 3 | `builder` | Code, one section at a time, with guide comments | Approve each section |
| 4 | `reviewer` | Clean code + one review guide per section + stacked PRs | Publish |

### Big feature or small fix

The same flow scales to the size of the task. You pick the mode, or the refiner suggests one.

| Mode | For | What changes |
|---|---|---|
| `full` | Features, multi-section work | All four steps, in full |
| `light` | Small fixes and tasks | Same four steps, shortened: a few-line spec, a one-section plan, a quick review |
| `rework` | Feedback on an open PR | Only the builder and reviewer, on the affected section |

Small tasks get the same control with a fraction of the questions and tokens.

## Install only what you need

Every product works on its own. Use one, some or all.

| Product | What it does |
|---|---|
| `workflow` | The four agents above |
| `review` | Review anyone's PR: splits it into sections with a reading order, checks it against the ticket |
| `init` | Guided setup of your project's AI files (`AGENTS.md`, rules, structure) |
| `profile` | Your personal coding preferences, applied on every project |
| `docs` | Living documentation for people, always in sync with the code. Powered by [living-docs](https://github.com/Akiles94/living-docs) |
| `context` | Lean, always-current context for AI agents: flows and invariants the code doesn't reveal. Powered by [easy-repo-context](https://github.com/Akiles94/easy-repo-context) |

`docs` and `context` are standalone npm packages you can also use on their own. When present, the workflow plugs into them: agents read the context instead of exploring the repo, and the reviewer uses them to detect affected flows and broken invariants.

Files are copied into your repo and become yours: plain Markdown and small scripts, no runtime dependency, no network calls, no telemetry. Easy to audit, easy to customize.

## Token usage

Designed to be cheap by default: mechanical work runs as deterministic scripts, agents only see one section at a time, small fixes use a lighter mode, and models are picked per agent by tier (`efficient` · `balanced` · `max`). With `context` enabled, agents answer "how does X work" with up to 67% fewer tokens ([measured](https://github.com/Akiles94/easy-repo-context#proof-of-concept)). Measurements for the full workflow will be published once there are real runs.

## License

[MIT](LICENSE) © Oscar Vinueza
