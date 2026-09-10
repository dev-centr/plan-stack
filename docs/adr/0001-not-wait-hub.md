# ADR 0001 — plan-stack is not wait-hub

## Status

Accepted (2026-09-10)

## Context

Agents spend wall-clock time waiting on CI and other remote operations. A thin wait bus ([wait-hub](https://github.com/dev-centr/wait-hub)) already registers atomic waits. Separately, agents can speculate ahead and need a **visual fixed reference** for multi-phase plans that grow, shrink, and recalculate when estimates break.

## Decision

Ship **plan-stack** as its own daemon + UI:

- Owns harness windows, session columns, phase stacks, ETA sizing, insert/replace/recalc
- **Consumes** wait-hub when a phase binds `waitHubId`
- Does not absorb forge adapters, webhook ingest, or wait registry semantics

## Consequences

- Two localhost ports: wait-hub `17357`, plan-stack `17358`
- Harness docks plan-stack as a cross-cutting panel; wait-hub remains the wait backend
- Standalone plan-stack UI can show multi-harness activity without embedding wait-hub chrome
