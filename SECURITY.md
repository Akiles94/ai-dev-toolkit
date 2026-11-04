# Security

## What the toolkit does and does not do

- **No runtime dependencies.** The published package contains its own compiled code and plain
  Markdown/JSON files, nothing else.
- **No install scripts, no network calls, no telemetry.** `aidt` reads and writes files in your
  repository and runs `git`. Only `aidt stack submit` talks to your code host, through the `gh` or
  `glab` CLI you already have, and only when you run it.
- **No model calls.** The CLI never calls an AI model. The agents run inside the AI tool you already
  use, with the permissions that tool gives them.
- **You own the copied files.** `aidt add` copies plain files into `.aidt/`; review them like any
  other code. They can also be copied by hand, without installing anything.
- **Signed provenance.** Releases are published from GitHub Actions with npm provenance, so you can
  check that a version was built from this repository (`npm audit signatures`).

## Supported versions

Only the latest minor release receives security fixes while the project is in `0.x`.

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** in this repository.
Do not open a public issue. You will get an answer within 7 days, and a fix or a mitigation plan
as soon as the issue is confirmed.
