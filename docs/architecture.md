# Architecture (one-pager)

**plan-stack** is a machine-local **speculative plan queue**: agents register multi-phase plans sized by estimated wait, then go silent while earlier remote work completes. Sibling to [wait-hub](https://github.com/dev-centr/wait-hub) (atomic wait-for-completion) — different concern.

## Hot path (v1)

```
Agents / harness panel / standalone UI / CLI
        │  upsert_plan · insert_phases · replace_phase · …
        ▼
   plan-stackd — plan graph + ETA stacks + recalc
        │
        ├── optional wait-hub bind (phase.waitHubId → poll completion)
        └── $CODE_ROOT/plan-stack.status.json
            $CODE_ROOT/plan-stack.events.jsonl
            $CODE_ROOT/plan-stack/plans/*.json
```

| Concern | Product |
| --- | --- |
| Speculative multi-phase plans, session columns, ETA cell height, insert/recalc UI | **plan-stack** |
| Atomic wait for CI / publish / deploy signal | **wait-hub** |
| Hive git remotes ahead/behind | **hive-watch** |
| Discussion vs worker desk modes | **harness** (embeds plan-stack as a dock panel) |

## UI model

- **Window** = one harness id
- **Column** = one agent session (plan) within that harness
- **Stack** = ordered phases (top = start, bottom = end); cell height ∝ `estimatedWaitMs`

## Not wait-hub

plan-stack does **not** invent forge adapters. When a phase waits on a catalogued remote job, bind `waitHubId` and let wait-hub own polling. See [ADR 0001](adr/0001-not-wait-hub.md).
