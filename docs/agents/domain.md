# Domain docs

## Shared context

Use one root `CONTEXT.md` for the domain shared across all apps.
Keep ADRs in the existing `docs/architecture/decisions/` directory,
including new decisions.

Before exploring the codebase, read `CONTEXT.md` and the ADRs relevant
to the work.

If the context file does not exist, proceed silently. Domain-modeling
work creates it when terminology and decisions are resolved.

## Vocabulary and decisions

Use domain terms as defined in `CONTEXT.md`. When a concept is missing,
check existing usage and identify any genuine gap for domain modeling.

Surface any conflict between a proposed change and an existing ADR,
including the decision and the reason for reconsidering it.
