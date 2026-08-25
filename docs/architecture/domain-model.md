# Domain Model

This document describes the confirmed bounded contexts of the domain owned by `web/`,
following a strategic DDD process (domain analysis → subdomains → bounded contexts).

A bounded context here is a logical boundary, not necessarily a separate service or deployment.
Splitting a bounded context into a separate physical service is a distinct decision, made only
when a real need is demonstrated (see root `AGENTS.md`).

See `overview.md` for the system-level runtime architecture (`web/`, `ai-service/`, database,
external providers).

## Football
Owns match, team, player, coach, standings and football statistics data.

Data originates from an external Football API, is written to PostgreSQL, and served to the
public site from PostgreSQL (directly or via cache). The public application does not depend on
the external provider at request time.

Football data can conflict with manually corrected data (for example, a coach change reported
late by the provider). This is an open implementation question: see Open Questions.

Comments, voting and tags reference Football entities but are not part of this context.

## Article

Owns editorial articles and article categories. Article categories are distinct from News
categories and from Tags / Taxonomy.

Articles are authored manually by people (writers/bloggers).

Distinct from `News` in data model, creation process and publication rules — confirmed as a
separate bounded context, not a content type within one context.

Each article is linked to its author via `Article.author_account_id` (see Identity).
Object-level authorization rule: a writer may edit an article only if they are its author,
independent of role-based access.

## News

Owns news items and news categories. News categories are distinct from Tags / Taxonomy.

News items are sourced from external content and produced via the AI service (translation and
adaptation for a Russian-speaking audience).

The AI service prepares a draft; only a human publishes it. This matches the existing principle
in `overview.md` that AI processing prepares content for editorial review and does not
independently authorize publication.

## Identity

Owns accounts, roles, permissions, public profiles and staff invitations.

```
Identity
├─ Account       — one account per person (id, email, auth, status)
├─ PublicProfile — display_name, avatar, reputation, badges
├─ Roles         — writer, admin, super_admin
├─ Permissions   — authorization, separate from authentication (RBAC)
└─ Invitations   — mechanism for granting staff roles
Writer profiles may additionally include `social_links`, used to display links to the author's external channels or profiles on Article pages.
```

There is exactly one `Account` per person. Public registration and staff access must not create
two independent account records for the same person.

A user's `display_name` is chosen during registration and cannot be changed by the user afterward.

**Invitation flow:**
- Public registration creates an `Account` with no staff roles.
- A staff invitation (created by someone already authorized to do so) either attaches a role to
  an existing `Account` (matched by email) or creates a new one.
- There is no separate "admin registration" form; the admin-facing registration screen is an
  invitation-acceptance flow, not an independent signup.

**Object-level authorization:** role-based access alone is not sufficient. A writer's access to
`/admin/articles` must additionally be scoped to articles they authored
(`Article.author_account_id = current_account.id`).

## Comments

Owns comments left on Football, Article and News pages.

Data model: comment (with `parent_id` for nesting), author (`account_id`, references Identity),
and an internal `CommentReaction` sub-entity (like/dislike, one reaction per account per
comment). Reactions are not a separate bounded context — they only exist in relation to a
comment and follow its lifecycle; they are not reused anywhere else in the system.

Rules distinct from Article/News: comments cannot be edited or deleted by their author after
publication; there is no pre-moderation, comments are published immediately; comment moderation
is permission-based, with `super_admin` having full access and specific moderation permissions
grantable to other staff accounts; a comment may be auto-hidden once it crosses a dislike
threshold (see Open Questions).

Lifecycle: created → visible → (possibly auto-hidden by dislikes) → (possibly removed by a
moderator). Independent of the Article/News publication lifecycle.

References Football, Article, News and Identity, but does not own their data.

## Voting

Owns polls: a question with a fixed set of answer options and per-account votes.

Distinct from `CommentReaction`: a vote is a choice among multiple defined options (not a binary
reaction to existing content), a vote is final (no re-voting), and votes are not tied to a
comment.

Two creation modes: automatic (a standard "who will win" poll generated for match pages, with
home win / draw / away win options derived from the match) and manual (for predefined product
placements such as the home page, standings page and statistics page).

References Football for auto-generated match polls, but does not own football data.

## Tags / Taxonomy

Not a bounded context by current information — treated as a cross-cutting classification
mechanism used by Article, News and Football (match pages), not a domain with its own rules or
lifecycle beyond "create a tag and attach it to content".

```
Tag
- id
- type: player | club | topic
- source_entity_id?   — set for player/club, references the Football entity
- name_override?
- image_override?
- target_url?
- created_by: auto | manual
```

`player` and `club` tags are created automatically when the corresponding entity appears in
Football, and must not duplicate the entity's name/image as independent data — they reference
the Football entity as the source of truth. `topic` tags (e.g. a competition, "Trophies",
"Transfers") are created manually and do own their own name, image and target URL, since no
corresponding entity exists elsewhere in the system.

Status may change to a bounded context if dedicated business rules or a lifecycle (moderation,
merging tags, popularity) are introduced later — not the case currently.

## Translation / Localization

Not a bounded context — a technical capability (via `ai-service`), used differently inside two
already-confirmed contexts. The site is not planned to become multilingual; this is a narrow
EN→RU capability, not general i18n.

- **News** — translation/adaptation is part of the existing draft creation process; both the
  original and the translated/adapted text are stored.
- **Football** — club and player names require a dedicated localized field
  (`name_en` / `name_ru`), not a one-off manual correction. `name_en` is updated by the API
  import; `name_ru` follows its own lifecycle and must not be overwritten by a subsequent
  import.
- **Article** — no translation needed; articles are written directly in Russian.

## Cross-cutting technical mechanisms

Not bounded contexts — they act on top of the contexts above rather than owning their own model.

- **Admin** — management/access surface over the bounded contexts and cross-cutting mechanisms
  that require administrative operations; it does not own their domain models.
- **SEO** — policy applied to Article, News and Football.
- **Background jobs** — deliver data from external providers into the relevant bounded contexts
  (not "into the database" undifferentiated).

## Technical service without its own business model

- **ai-service** — supports News (translation, adaptation) and may support other bounded
  contexts as AI use cases are introduced. It is a technical service, not currently
  identified as a bounded context or subdomain.

## Open Questions

- **Football** — no confirmed mechanism yet for protecting manually corrected provider-owned
  fields from being overwritten by subsequent API imports.
  is itself sufficient without an explicit role.
- **Comments** — exact dislike threshold/mechanism for auto-hiding a comment is not defined.
- **Tags / Taxonomy** — no business rules or lifecycle defined yet (moderation, merging tags,
  popularity); if such rules emerge, this may need to be reassessed as a bounded context.

Not addressed yet:

- How a future mobile API client fits into this domain model.
- Whether `web/` should be physically split into public/admin surfaces — not raised as a real
  need so far.

## Still being worked through

Domain analysis for the candidates below (Comments, Voting, Tags/Taxonomy,
Translation/Localization) has been completed and is reflected above. This section is currently
empty of unresolved candidates — remaining items are implementation-level open questions listed
above, not undecided domain boundaries.