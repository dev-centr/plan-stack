<div align="center">

<a href="https://github.com/dev-centr/plan-stack/graphs/contributors"><img src="https://img.shields.io/github/contributors/dev-centr/plan-stack.svg?style=for-the-badge" alt="Contributors"></a>
<a href="https://github.com/dev-centr/plan-stack/network/members"><img src="https://img.shields.io/github/forks/dev-centr/plan-stack.svg?style=for-the-badge" alt="Forks"></a>
<a href="https://github.com/dev-centr/plan-stack/stargazers"><img src="https://img.shields.io/github/stars/dev-centr/plan-stack.svg?style=for-the-badge" alt="Stargazers"></a>
<a href="https://github.com/dev-centr/plan-stack/issues"><img src="https://img.shields.io/github/issues/dev-centr/plan-stack.svg?style=for-the-badge" alt="Issues"></a>
<a href="https://github.com/dev-centr/plan-stack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/dev-centr/plan-stack.svg?style=for-the-badge" alt="MIT License"></a>

# plan-stack

Speculative agentic wait queue — ETA-sized plan stacks, session columns, live insert when estimates break.

[Architecture](docs/architecture.md) · [Changelog](CHANGELOG.adoc) · [wait-hub](https://github.com/dev-centr/wait-hub) · [harness](https://github.com/dev-centr/harness)

</div>

<details>
<summary>Table of contents</summary>

- [About](#about)
- [Getting started](#getting-started)
- [CLI](#cli)
- [UI model](#ui-model)
- [Related](#related)
- [License](#license)

</details>

## About

Most agent wall-clock time is **waiting** on CI or other remote work. Agents can still plan ahead. **plan-stack** keeps that speculative plan as a fixed visual queue: phases stack top→start / bottom→end with cell height proportional to estimated wait. Subagents insert or replace phases; when an expectation breaks, dependents show a recalculating state, then new steps animate into the gap.

This is **not** [wait-hub](https://github.com/dev-centr/wait-hub). wait-hub is the atomic wait/event bus. plan-stack owns multi-phase plans and the overview UI; it may bind a phase to a wait-hub id for completion. See [ADR 0001](docs/adr/0001-not-wait-hub.md).

<p align="right">(<a href="#plan-stack">back to top</a>)</p>

## Getting started

Prerequisites: Node 20+.

```powershell
git clone https://github.com/dev-centr/plan-stack.git "$env:code\github.com\dev-centr\plan-stack"
cd "$env:code\github.com\dev-centr\plan-stack"
node bin/plan-stackd.js --write-config --code-root $env:code
node bin/plan-stackd.js --serve
```

IPC + UI: `http://127.0.0.1:17358` (wait-hub uses `17357`).

In another shell:

```powershell
node bin/plan-stack.js seed
node bin/plan-stack.js overview
```

Artifacts (machine-local, not committed):

| Path | Role |
| --- | --- |
| `$CODE_ROOT/plan-stack.config.json` | Port, paths, wait-hub URL |
| `$CODE_ROOT/plan-stack.status.json` | Summary for trays / harness |
| `$CODE_ROOT/plan-stack.events.jsonl` | Append-only events |
| `$CODE_ROOT/plan-stack/plans/*.json` | Per-session plans |

<p align="right">(<a href="#plan-stack">back to top</a>)</p>

## CLI

```powershell
node bin/plan-stack.js health
node bin/plan-stack.js upsert --harness devcentr-harness --session s1 --title "My session"
node bin/plan-stack.js complete <planId> <phaseId>
```

Harness client id example: `devcentr-harness`.

<p align="right">(<a href="#plan-stack">back to top</a>)</p>

## UI model

| Layer | Meaning |
| --- | --- |
| Window | One harness |
| Column | One agent session (h-scroll) |
| Stack cell | One phase; height ∝ `estimatedWaitMs` |

Dock the same overview inside [DevCentr harness](https://github.com/dev-centr/harness) as a cross-cutting panel (not a Linear/Grid/Tree peer). Teaching demo: [HCI-Nerdz plan-stack](https://hci-nerdz.github.io/plan-stack/).

<p align="right">(<a href="#plan-stack">back to top</a>)</p>

## Related

- [wait-hub](https://github.com/dev-centr/wait-hub) — wait-for-completion bus
- [harness](https://github.com/dev-centr/harness) — desk modes + plan-queue dock
- [hive-watch](https://github.com/dev-centr/hive-watch) — hive remotes status
- [HCI-Nerdz plan-stack demo](https://hci-nerdz.github.io/plan-stack/) — interactive explainer

<p align="right">(<a href="#plan-stack">back to top</a>)</p>

## License

MIT — see [LICENSE](LICENSE).

## Contact

Dev-Centr — [github.com/dev-centr](https://github.com/dev-centr)
