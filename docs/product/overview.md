# Product Overview

## 1. Product Definition

The product is a Russian-language platform focused on Italian football.

The initial and primary product scope is **Serie A**. The product is designed for Russian-speaking fans who want a dedicated place to follow Serie A rather than using general sports websites.

The product provides two core forms of value:

* comprehensive Serie A information in one place, including matches, standings, statistics, clubs and players;
* content and community around Serie A through news, editorial articles and discussions.

Community participation, especially discussion around news, articles and matches, is a core part of the product rather than an auxiliary feature.

The product is not:

* a general sports portal;
* a platform covering football broadly;
* primarily a football statistics database;
* primarily an AI product.

Statistics and structured football data are important parts of the product, but exist alongside editorial content and community functionality.

Future expansion beyond Serie A is described in **Out of Scope / Later**.

---

## 2. Product Scope

### 2.1 Football

The product provides football information for the current Serie A season.

The public experience includes:

* current-round matches and match states;
* live and completed match scores;
* match pages with goalscorers, match events, text/live coverage, statistics and lineups;
* Serie A standings;
* season calendar with navigation by round;
* player statistics and rankings;
* current Serie A clubs;
* club information, squads, club fixtures and club statistics;
* player profiles and current-season statistics.

The main page provides a compact overview of the competition, including current-round matches, a shortened standings table, leading goalscorers and leading assist providers.

Detailed statistical metrics are defined separately when the available football data and implementation requirements are finalized.

### 2.2 News

News provides daily information about Serie A and related Italian football topics within the current product scope.

News:

* has its own News Categories;
* may be associated with relevant clubs, players and other tags;
* identifies its external source and provides a clickable link to the source website;
* supports user discussion through comments.

News Categories are independent from Article Categories and Tags / Taxonomy.

News content is prepared from external source material through the existing content-processing workflow and is published only after human editorial review.

Technical details of content acquisition and AI processing are defined in the architecture documentation.

### 2.3 Articles

Articles provide editorial and analytical content written by human authors.

Articles:

* have their own Article Categories;
* may contain images;
* may be associated with relevant clubs, players and other tags;
* display their author;
* may display clickable links to the author's external social channels;
* support user discussion through comments.

Article Categories are independent from News Categories and Tags / Taxonomy.

### 2.4 Comments

Comments provide discussion around:

* News;
* Articles;
* Matches.

Visitors may read comments without an Account.

An authenticated user may:

* publish comments;
* reply to existing comments;
* react to comments with like/dislike.

Replies may target comments within an existing discussion chain, while the UI keeps replies visually grouped under the root comment rather than creating progressively deeper visual indentation.

Comments are published without pre-moderation.

Authors cannot edit or delete their comments after publication.

Comments may be removed through staff moderation and may be automatically hidden based on dislikes. The exact automatic-hiding mechanism remains an open product question.

### 2.5 Voting / Polls

Polls are available in predefined product locations:

* home page;
* standings page;
* match page;
* statistics page.

Visitors may view polls and their results.

Only authenticated users may vote.

Each Account may cast one final vote in a poll; re-voting is not supported.

For each upcoming Serie A match, the product automatically provides a standard match prediction poll with:

* home win;
* draw;
* away win.

Other polls are managed manually by authorized staff and appear only in predefined product placements.

### 2.6 Identity / Account

Public content does not require registration.

An Account is required for community participation:

* commenting;
* replying to comments;
* like/dislike reactions;
* voting in polls.

Users have a personal account area for basic account management.

The product also supports reputation and badges. Their detailed rules are not yet defined.

There is no separate public profile page for ordinary users.

Writer profiles may additionally expose links to the author's external social channels.

Detailed identity, authorization and account ownership rules are defined in the domain model.

---

## 3. Public User Experience

The public product is accessible without registration.

A visitor can:

* browse all public football information;
* read News and Articles;
* view clubs, players, matches, standings, calendar and statistics;
* read comments;
* view polls and their results.

Authentication is required only when the user wants to participate:

* publish a comment;
* reply to a comment;
* like/dislike a comment;
* vote in a poll.

The initial product does not include user-facing personalization features such as favorites, subscriptions, notifications, saved content or personalized feeds.

---

## 4. Content and Editorial Experience

### Articles

Writers create and manage their own Articles.

A writer may:

* create an Article;
* save and review it as a draft;
* publish their own Article when they have publication permission.

The ability of a specific writer to publish independently may be restricted by `super_admin`.

### News

News enters the editorial process as prepared draft content.

Human editorial review is required before publication.

Initially this responsibility may be handled by `super_admin`; as the product grows, News editorial responsibilities can be delegated to staff through permissions.

The technical News processing pipeline is outside the scope of this document and is defined in the architecture documentation.

---

## 5. Staff / Admin Experience

`super_admin` has full administrative control over the product.

Administrative access is designed around flexible permissions rather than requiring every staff member to have the same fixed set of capabilities.

`super_admin` can delegate individual areas of responsibility to staff accounts and combine multiple responsibilities when necessary.

Examples of delegable responsibilities include:

* News editorial work;
* comment moderation;
* poll management;
* management or correction of football-related data.

The set of administrative permissions may expand as the product grows.

Writers have access to their own Articles and follow the publication permissions assigned to them.

Detailed authorization and permission implementation belongs to the domain and security documentation rather than this product overview.

---

## 6. Core Product Flows

### Follow Serie A

Visitor → opens the home page, match, standings, statistics, club or player page → receives current Serie A information.

### Consume Content

Visitor → opens News or Article → reads the material → explores related football entities or tags → reads the discussion.

### Participate in Discussion

Authenticated user → opens News, Article or Match → publishes a comment or replies to another comment → participates through like/dislike reactions.

### Participate in Polls

Authenticated user → sees a poll → casts one final vote → views the results.

### Publish an Article

Writer → creates an Article → saves/reviews the draft → publishes it when publication permission is available.

### Publish News

Prepared News draft → human editorial review by authorized staff → publication.

---

## 7. Initial Product Scope

The initial working product covers **Serie A** and includes:

* Football;
* News;
* Articles;
* Comments;
* Voting / Polls;
* Identity / Account;
* the editorial and administrative capabilities required to operate these areas.

The initial product should provide the complete core experience defined in this document rather than treating these areas as optional future additions.

---

## 8. Out of Scope / Later

The following football areas are planned for later expansion and are not part of the initial product scope:

* Coppa Italia;
* Serie B;
* European competitions in the context of Italian football;
* Italy national team.

Future user-facing AI capabilities are also outside the initial product scope.

Potential future capabilities include:

* AI chat;
* RAG over platform data;
* vector search and embeddings used for product-facing AI experiences;
* other AI workflows introduced when concrete product use cases are defined.

This does not include the existing AI-assisted News preparation workflow, which is part of the initial product.

---

## 9. Open Product Questions

The following questions intentionally remain unresolved:

### Football Statistics

The exact set of statistical metrics presented across general statistics, club, player and match experiences is not yet finalized.

### Comment Auto-Hiding

Automatic hiding of comments based on dislikes is required, but the exact threshold and mechanism are not yet defined.

### Reputation and Badges

Reputation and badges are planned product capabilities, but their rules, calculation and behavior are not yet defined.

These questions should remain open until explicitly resolved rather than being filled with assumed requirements.

---

## Related Documentation

This document is the high-level source of truth for product definition and product scope.

Detailed domain ownership, business invariants and authorization rules:

`../architecture/domain-model.md`

System and service architecture:

`../architecture/overview.md`

Technical architecture documents remain authoritative for implementation details and must not be duplicated here.
