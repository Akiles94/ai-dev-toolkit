# Context: what every new session reads

Every new session of an AI tool knows only what is in the repository, so it starts by reading:
the rules file the tool loads by itself, then whatever the project says to read first. As the
project grows, that reading grows with it, and nothing stops it. On a real project after three
weeks of daily blocks, the rules file took about 5,100 tokens and the status every session read
first about 19,900, most of it the story of finished blocks: some 25,000 tokens before the first
useful step, and more after every block.

`context` treats that reading like code: in layers, with a budget a script checks, and a way to
close each block that keeps the next session's reading short.

```bash
npx @akiles94/ai-dev-toolkit add context
```

It copies a practice (`.aidt/practices/session-context.md`) and three templates
(`.aidt/templates/status.md`, `summary.md`, `tasks-index.md`). No agent, no model, no network.

## The layers

| Layer | What | When it is read | Budget (default) |
|---|---|---|---|
| Always | The rules files the tool loads by itself: `AGENTS.md`, `CLAUDE.md` and its `@` imports, `.github/copilot-instructions.md` | automatically | 3,000 tokens |
| Start | The status, `.aidt/status.md`: where the work stands and what this session does first | first, every session | 2,500 tokens |
| Task | The plan; the flows and invariants of the files being touched (`erctx context <file>` with [easy-repo-context](https://github.com/Akiles94/easy-repo-context)) | while working | — |
| On demand | History, audits, deferred work, strategy documents | only when the task needs them, preferably through a subagent | — |

## The status is a snapshot, not a log

The status says *now*: what is in progress, the next block with its first steps, a **Read first**
list of the paths the next session needs, a **Not needed** list of what looks relevant but is not,
the open decisions, and the last three blocks in one line each. When a block closes, the status is
rewritten, never appended to. The block's story goes to its own folder:

1. `.aidt/tasks/<task-id>/summary.md`: what was done, the decisions and who took them, deviations
   from the plan, what was left and where, the verdicts with their commits. For a workflow task,
   mostly links: its spec, plan and review index already are the record.
2. A row in `.aidt/tasks/README.md`, the index of every block.
3. The status, rewritten with the next session's reading list.
4. `aidt context check` green, then commit.

The session that closes a block knows best what the next one needs, so it writes the reading list.

## `aidt context check`

On a project whose status kept every finished block (exit 1):

```text
Always (loaded by the tool): 565 / 3,000 tokens · ok
    AGENTS.md  562
    CLAUDE.md  3
Start (read first, every session): 5,488 / 2,500 tokens · over by 2,988
    .aidt/status.md  5,488
        largest sections:
            1,099  ### Refunds: done and merged
            1,090  ### Checkout: done and merged
            1,089  ### Search: done and merged
Read first (next session): 2 path(s), 791 tokens
    missing: docs/flows/alerts.md

Tokens ≈ characters / 4. Layers and how to trim them: .aidt/practices/session-context.md
```

- **What it measures:** the configured files that exist, with `CLAUDE.md` `@` imports followed
  (up to five hops, inside the repository) and each file counted once.
- **Over budget:** the heaviest sections of each file, cut below the title (at `##`, or at `#`
  when the file has several), and one level deeper while a single section still holds more than
  half the file; a heavy preamble stops the descent, and a `#` inside fenced code never cuts.
  Those are what to move.
- **Read first:** every path must exist, since a stale pointer sends the next session the wrong
  way. Paths go before the «: why» of each line, in backticks from the repository root or as links
  relative to the status file. Their total is reported, not budgeted.
- **Tokens** are estimated as characters / 4: not any model's tokenizer, the same on every machine,
  enough to see a file grow and stop it.
- `--json` for scripts. Put it in your quality commands and CI. The builder runs it when a section
  changes a rules file or the status, and the reviewer reports a breach as a finding.

## Keeping the always layer small

- **Indexes:** one short line per entry; the detail lives in the file the line points to.
- **Rules for one folder** go in that folder's scoped rules, loaded only when working there: a
  `CLAUDE.md` inside the folder for Claude Code, `.github/instructions/<name>.instructions.md` with
  `applyTo` for Copilot.
- **No history, decision logs or plans** in it.

## Configuration

`context` in `.aidt/config.json`; every key is optional.

```json
"context": {
  "always": ["AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"],
  "start": ["docs/status.md"],
  "budget": { "always": 3000, "start": 2500 }
}
```

Here the status lives in `docs/` instead of `.aidt/`. Raise a budget only when the project really
needs that much on every session, and say why in the commit.

## Limits

- It measures what is loaded at the start, not what a session reads later.
- It does not shorten anything by itself: it says what weighs most, and the closing practice says
  where it goes.
- A project-specific instruction to read a file at the start (outside the status) is only counted
  if that file is in `context.start`.
