# Canonical agent format

Agents are defined once here and rendered to each AI tool by `aidt sync` (Copilot, Claude Code…).
Edit these files to customize an agent; never edit the generated per-tool files.

```markdown
---
name: refiner                       # lowercase, unique, used as the command name
description: One line. What it does and when to use it.
tier: balanced                      # efficient | balanced | max (mapped to a model per tool)
capabilities: [read, ask, write]    # what the agent may do (see below)
writes:                             # files it may create or change (globs); required with `write`
  - .aidt/tasks/*/spec.md
commands:                           # shell commands it may run (prefixes); required with `shell`
  - git branch
handoff: planner                    # next agent, offered after the user approves
---
Instructions in Markdown.
```

## Capabilities

| Capability | Allows | Enforced by |
|---|---|---|
| `read` | Read and search the repository | — |
| `ask` | Ask the user structured questions | — |
| `write` | Create or change only the files listed in `writes` | Tool permissions, hooks where supported |
| `edit` | Change source code | Tool permissions |
| `shell` | Run only the commands listed in `commands` | Tool permissions, hooks where supported |

Adapters map each capability to the closest permission of each tool. When a tool cannot enforce
a limit, the instructions still state it and the reviewer checks it afterwards.

## Shared conventions

- **Task folder:** `.aidt/tasks/<task-id>/`, where `<task-id>` is the branch name with `/` replaced
  by `-` (`feat/AUTH-87-rate-limit` → `feat-AUTH-87-rate-limit`).
- **Templates:** `.aidt/templates/`. Agents fill them; they never invent their own format.
- **State:** `.aidt/tasks/<task-id>/state.json`, following `state.schema.json`. Every agent reads
  it first and updates it last.
- **Rule layers:** task decisions > project rules (`AGENTS.md`) > developer profile
  (`~/.aidt/profile.md`) > toolkit defaults. The profile never overrides the project; it can only
  propose.
- **Approval gates:** an agent never moves the task to the next phase on its own. It asks, and
  only an explicit "yes" from the user counts.
- **Language:** artifacts and code in English; talk to the user in their language.
