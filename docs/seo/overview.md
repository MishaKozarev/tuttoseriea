# SEO and Indexing

This document defines the technical SEO and indexing rules for the project.

For overall architecture, see `../architecture/overview.md`.

For bulk/system operations, see `../jobs/overview.md`.

For deployment and production verification, see `../operations/overview.md`.

## Purpose

SEO-sensitive behavior is part of the application architecture.

Changes to URLs, canonicalization, indexability, redirects, robots rules or sitemap generation can affect already indexed pages and organic traffic.

Such changes must therefore be treated as functional behavior rather than presentation-only changes.

## Stable URLs

Each indexable entity should have one stable preferred URL.

Published URLs should not be changed without a concrete reason.

Slug generation must be deterministic according to the rules of the corresponding entity.

Do not casually regenerate or mutate existing slugs as a side effect of:

- editing content;
- changing titles;
- refactoring routing;
- importing updated external data.

When URL structure or slug behavior changes, consider the effect on existing indexed URLs before implementation.

## Canonical URLs

Indexable pages should expose the intended canonical URL.

If the same content is technically accessible through multiple URLs, canonical metadata identifies the preferred version for search engines.

Canonical is a signal, not an absolute guarantee that a search engine will select that URL as canonical.

Do not use canonical metadata as a substitute for eliminating unnecessary duplicate URLs.

When strict URL consolidation is required, use the appropriate redirect rather than relying only on canonical metadata.

Canonical URLs should normally:

- point to the preferred stable URL;
- avoid unnecessary tracking/query variants;
- be internally consistent with routing and sitemap generation.

## Redirects

When an existing public/indexed URL is intentionally replaced by another URL, preserve continuity with the appropriate redirect where required.

Do not silently remove or change established public URLs without considering redirect behavior.

Redirects are preferred over canonical-only handling when the old URL should no longer remain independently accessible.

Redirect behavior must avoid:

- redirect loops;
- unnecessary redirect chains;
- redirects to unrelated content.

The exact redirect implementation depends on the concrete routing change.

## Indexability

Indexability must be intentional.

Pages intended for search indexing should be technically indexable and expose consistent canonical metadata.

Pages that should not appear in search results must use an appropriate indexing policy.

Typical non-indexable areas may include, depending on the implemented feature:

- admin pages;
- authenticated/private pages;
- internal utility pages;
- temporary or duplicate representations;
- pages intentionally excluded from search.

These examples do not define a universal list. Indexability is decided according to the responsibility of the concrete route.

Do not accidentally make internal or low-value generated pages indexable merely because they are publicly reachable.

## `noindex`

Use `noindex` when a reachable page should not be indexed by search engines.

`noindex` and crawling control are different concerns.

Do not assume that blocking a URL in `robots.txt` is equivalent to applying `noindex`.

If a crawler is prevented from fetching a page, it may be unable to observe page-level indexing directives.

Therefore, use the mechanism appropriate to the actual goal rather than treating `robots.txt` as a universal indexing-control tool.

## `robots.txt`

`robots.txt` controls crawler access behavior.

It is not the project's primary mechanism for:

- canonicalization;
- removing an indexed page;
- expressing page-level `noindex`.

Robots rules should be deliberate and should not accidentally prevent crawlers from accessing pages/resources required for correct indexing.

The project should use the Next.js-supported robots mechanism rather than maintaining unrelated ad-hoc implementations.

## Sitemap

Sitemaps should contain URLs that the project intentionally presents as preferred indexable URLs.

Do not intentionally include:

- non-indexable pages;
- duplicate URL variants;
- URLs whose canonical points elsewhere;
- internal/admin/private routes;
- obsolete URLs replaced by redirects.

Sitemap generation should use application/domain data rather than depend directly on external providers at request/generation time where the data is already persisted by the project.

The project should use the Next.js-supported sitemap mechanism.

## Next.js metadata

Use Next.js App Router metadata mechanisms for SEO metadata where applicable.

Prefer framework-supported mechanisms such as:

- Metadata API;
- metadata generation;
- `sitemap.ts`;
- `robots.ts`.

Do not introduce arbitrary manual `<head>` management when the framework provides the required mechanism.

SEO metadata should remain consistent with actual routing and domain state.

## Dynamic entities

SEO-sensitive dynamic entities such as news, articles, matches, teams, players or competitions may require entity-specific rules for:

- slug generation;
- canonical URL construction;
- metadata;
- indexability;
- sitemap inclusion.

Those concrete rules should be introduced with the corresponding feature rather than inventing universal SEO behavior for entities that do not yet exist.

Once a public URL contract exists, changing it becomes a compatibility concern.

## Duplicate and parameterized URLs

Do not create multiple indexable URL variants for the same logical content without a concrete requirement.

When query parameters or alternate routes produce equivalent content, explicitly consider:

- whether the variant should exist;
- whether it should be indexable;
- canonical behavior;
- redirect behavior where appropriate;
- sitemap inclusion.

Do not assume canonical metadata alone makes uncontrolled URL proliferation harmless.

## Mass indexable page creation

Mass creation of search-indexable pages is a bulk operation.

Examples may include:

- generating large historical archives;
- creating pages for imported entities;
- exposing previously non-indexable route sets;
- changing a large route family from `noindex` to indexable.

Implementing the mechanism does not authorize executing the operation.

Before execution, determine and report:

- which pages/routes will become indexable;
- approximate scale where it can be determined;
- canonical/URL behavior;
- sitemap impact;
- whether existing indexed URLs are affected.

Execution requires the explicit approval required for bulk operations in root `AGENTS.md`.

Detailed bulk-operation rules are documented in `../jobs/overview.md`.

## SEO-sensitive changes

Treat a change as SEO-sensitive when it modifies behavior such as:

- route structure;
- existing slug generation;
- canonical URLs;
- redirects;
- indexability;
- `noindex`;
- robots rules;
- sitemap generation;
- large-scale creation/removal of public pages.

Such changes require explicit verification of the affected SEO behavior rather than being treated as ordinary UI refactoring.

Relevant automated tests should be added where the behavior is stable and testable.

## Production verification

After an SEO-sensitive deployment, verification should focus on the behavior changed by that deployment.

Depending on the change, this may include checking:

- final public URL;
- HTTP status/redirect;
- canonical metadata;
- robots directives;
- indexability metadata;
- sitemap output.

Do not perform uncontrolled mass crawling or external side-effect operations merely as a deployment smoke check.

## Documentation

When a feature introduces a stable SEO contract that requires more detail than this project-wide policy, document it in the relevant area or add a focused detail document under `docs/seo/`.

Keep this `overview.md` as the stable entry point.

Do not duplicate feature-specific SEO documentation here unless it represents a project-wide invariant.

## Open Questions

The following details remain open until concrete product routes and SEO requirements establish them:

- exact slug rules for each domain entity;
- final canonical URL patterns for each entity type;
- exact sitemap partitioning strategy if the site grows beyond a single practical sitemap;
- which dynamic entity types should be indexable;
- indexing policy for pagination/filter/search pages;
- handling of historical or removed entities;
- whether future scale requires additional sitemap/SEO operational tooling.

These questions must be resolved from concrete product and indexing requirements rather than by generating large sets of indexable pages in advance.