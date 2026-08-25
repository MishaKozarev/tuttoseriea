# Project Documentation

This directory contains the detailed project documentation referenced by the repository `AGENTS.md`.

`AGENTS.md` contains mandatory Codex instructions and key invariants.
Detailed product, architecture, development, testing, security and operational knowledge belongs here.

## Documentation structure

    docs/
    ├── README.md
    ├── product/
    │   └── overview.md
    ├── architecture/
    │   ├── overview.md
    │   ├── domain-model.md
    │   ├── database.md
    │   ├── ai-service.md
    │   ├── integrations.md
    │   └── content-pipeline.md
    ├── development/
    │   ├── overview.md
    │   └── local-setup.md
    ├── testing/
    │   └── overview.md
    ├── jobs/
    │   └── overview.md
    ├── seo/
    │   └── overview.md
    ├── security/
    │   └── overview.md
    ├── operations/
    │   ├── overview.md
    │   ├── deployment.md
    │   └── monitoring.md
    └── git-workflow.md

## Stable entry points

Each expandable documentation area uses:

`docs/<area>/overview.md`

as its stable entry point.

Root `AGENTS.md` should reference these stable entry points rather than individual detail documents whenever the area may grow over time.

Examples:

- `docs/architecture/overview.md`
- `docs/product/overview.md`
- `docs/development/overview.md`
- `docs/testing/overview.md`
- `docs/jobs/overview.md`
- `docs/seo/overview.md`
- `docs/security/overview.md`
- `docs/operations/overview.md`

`git-workflow.md` remains a standalone document because it currently represents one focused responsibility.

`docs/operations/deployment.md` may be referenced directly where deployment mechanics specifically matter.

## Documentation rules

- Do not rename or move an existing `overview.md` without an explicit documentation-architecture decision.
- Add new detail documents inside the relevant existing area and link them from that area's `overview.md`.
- Do not create a new top-level `docs/<area>/` directory without a real new responsibility.
- Adding a new top-level documentation area requires updating the routing in root `AGENTS.md` when Codex needs to discover that area.
- Do not duplicate detailed rules across multiple documents without a concrete reason.
- Prefer links between documents when one area depends on another.
- Split a document when mixed responsibilities or size cause Codex to load substantial irrelevant context for typical tasks.
- Documentation must describe the actual project state. Do not document planned implementation as if it already exists.
- Open questions are collected in a dedicated `## Open Questions` section at the end of the relevant document.
- Do not resolve an open question in code, configuration or documentation without an explicit user decision.
- When implementation changes documented architecture, setup, contracts or operations, update the relevant documentation in the same PR.
- `AGENTS.md` must not duplicate detailed content from `docs/`; it contains only routing, key invariants and mandatory Codex rules. If a rule requires detailed context to be understood or applied correctly, the details belong in `docs/`.

## Growth principle

Documentation grows primarily **downward inside an existing area**, not by continuously adding new top-level areas.

For example:

    docs/architecture/
    ├── overview.md
    ├── database.md
    ├── ai-service.md
    ├── integrations.md
    ├── content-pipeline.md
    └── <new-detail>.md

Adding a detail document does not require changing root `AGENTS.md`.

The area's `overview.md` is updated to route Codex to the new document.

A new top-level documentation area should be introduced only when the project gains a genuinely separate responsibility that cannot reasonably belong to an existing area.