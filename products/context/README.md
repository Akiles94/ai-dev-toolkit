# context

What every new AI session reads, kept short and checked. Details: [docs/context.md](../../docs/context.md).

```
.aidt/
├── status.md                  ← where the work stands now (from templates/status.md)
├── practices/
│   └── session-context.md     ← the layers, starting a session, closing a block
├── templates/
│   ├── status.md              ← the snapshot every session reads first
│   ├── summary.md             ← a closed block's record, read on demand
│   └── tasks-index.md         ← .aidt/tasks/README.md, one row per block
└── tasks/<task-id>/summary.md
```

`aidt context check` measures the rules files the tools load by themselves and the status against
`context.budget` in `.aidt/config.json`, and checks the status's «Read first» paths exist.
