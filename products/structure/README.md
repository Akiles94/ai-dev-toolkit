# structure

Code organisation for any project, with or without an architecture: a minimal, conventional layout
for teams that do not want one, feature modules for the middle ground, and DDD/hexagonal for the
rest. The same common rules apply at every level: no junk drawers, no 1,000-line `api.ts`, no loose
files.

```
.aidt/
├── structure.md            ← this project's choice (from templates/structure.md)
└── structure/
    ├── rules.md            ← common rules S1–S7, every level, every stack
    ├── levels/
    │   ├── conventional.md ← 1 · the stack's own conventions, nothing more
    │   ├── modular.md      ← 2 · top level by feature, one public entry each
    │   └── architecture.md ← 3 · bounded contexts, domain / application / infra
    └── presets/            ← one per stack: layout and names for each level, from its official guides
```

## How it is used

- **New project:** the `architect` agent asks which level and preset fit, and writes
  `.aidt/structure.md`.
- **Existing project:** `aidt structure audit` measures the common rules; the `architect` agent
  reads the result, detects the structure the code is trying to follow and proposes three paths:
  **keep it, improved**, move to the stack's **conventional** layout, or adopt an **architecture**.
  The choice goes to `.aidt/structure.md`. New code follows it from then on; old code moves through
  a normal `workflow` task, in reviewed sections, with moves and logic changes in separate commits.
- **Every task:** the planner places code by `.aidt/structure.md`, the builder follows it and the
  reviewer checks it. Without it, they follow the project's existing structure.

Nothing is refactored automatically: the toolkit proposes, the developer decides.
