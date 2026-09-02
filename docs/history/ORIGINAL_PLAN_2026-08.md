# Historical original planning document

> **Do not implement directly from this file.** This is the original planning input retained for traceability. It predates later decisions about Material UI, staff-only authentication, passwordless participant flows, declaration signing, waiting lists, public runner profiles, the `qa`/`main` Git flow, and GoDaddy Node.js Hosting. The current root documents are authoritative.

---

# Brașov Runners — Technical Decision & Architecture Document

**Status:** Initial architecture / planning
**Date:** August 2026
**Project:** Brașov Runners website + community + race registration platform
**Primary objective:** Build a modern, fast, SEO-first, low-cost custom platform for the Brașov Runners running community in Brașov, Romania.

---

# 1. Executive Summary

Brașov Runners will use a **custom-built web application**, not WordPress, Wix, or another traditional website builder.

The application will provide:

- Public website
- Upcoming running events
- Race/event pages
- User accounts
- Free event registration
- Custom race registration
- Participant management
- Admin interface
- News/articles
- Photo galleries
- Race results
- Strong SEO
- Email notifications
- Optional integrations with external race platforms such as Sportic / 42km
- Potential future integrations with Strava, Garmin, GPX/maps, etc.

The core philosophy is:

> **Build a simple monolith that one developer can understand and maintain, while delegating specialized infrastructure to managed services.**

The application should be cheap to run initially, ideally requiring only the domain and eventually some database/storage/hosting costs.

---

# 2. Key Architectural Decisions

## Decision 1 — Custom application

Use a custom Next.js application.

Do **not** use:

- WordPress
- Wix
- Squarespace
- a traditional CMS as the core application
- a separate .NET backend initially
- microservices
- Kubernetes
- VPS infrastructure
- custom authentication
- custom email infrastructure

The application should be a **modular monolith**.

---

## Decision 2 — Own registration system

Brașov Runners should have its **own registration system**.

Sportic / 42km should NOT be a hard dependency.

The site should be capable of:

- creating events
- accepting registrations
- managing participants
- closing registration
- handling capacity
- sending confirmation emails
- exporting participant lists

Sportic / 42km can remain an optional external provider for events where it makes sense.

This means the architecture should support:

```text
Event
  |
  +--> Internal registration
  |
  +--> External Sportic/42km registration
```

---

## Decision 3 — No payments initially

Initial registration will focus on **free events/races**.

Do not implement payment processing in V1.

If paid races become necessary later, design a proper payment system separately, including:

- payment provider
- webhooks
- refunds
- invoicing
- accounting
- GDPR
- Romanian tax/accounting requirements
- reconciliation

---

# 3. Final Technology Stack

| AreaTechnology        |                            |
| --------------------- | -------------------------- |
| Framework             | Next.js                    |
| Language              | TypeScript                 |
| Styling               | Tailwind CSS               |
| UI                    | shadcn/ui                  |
| ORM                   | Drizzle                    |
| Database              | PostgreSQL                 |
| DB provider           | Neon                       |
| Authentication        | Zitadel                    |
| Email                 | Mailgun                    |
| File storage          | Cloudflare R2              |
| DNS                   | Cloudflare                 |
| Hosting               | Vercel                     |
| Source control        | GitHub                     |
| AI coding             | OpenAI Codex + Claude Code |
| Maps                  | MapLibre GL JS, TBD        |
| Analytics             | Plausible or Umami, TBD    |
| External registration | Sportic / 42km, optional   |

---

# 4. High-Level Architecture

```text
                         <domain>
                                |
                         Cloudflare DNS
                                |
                                v
                             Vercel
                                |
                       Next.js + TypeScript
                                |
          +---------------------+---------------------+
          |                     |                     |
          v                     v                     v
       Zitadel                Neon              Cloudflare R2
        Auth              PostgreSQL           Photos / Files
          |                     |                     |
          |                     |                     |
          +---------------------+---------------------+
                                |
                              Mailgun
                                |
                              Email

                    GitHub Repository
                           |
              +------------+------------+
              |                         |
            Codex                  Claude Code
              |                         |
              +------------+------------+
                           |
                      Source Code
```

---

# 5. Application Architecture

The application should be one Next.js project.

```text
Next.js
│
├── Public website
│
├── User account area
│
├── Admin interface
│
├── Registration system
│
├── API / Route Handlers
│
├── Server Actions
│
├── SEO
│
└── Integrations
```

Do not create separate frontend/backend repositories unless a real requirement appears later.

---

# 6. Next.js

Use:

- Next.js App Router
- TypeScript
- Server Components
- Client Components only where required
- Server Actions where appropriate
- Route Handlers for APIs/webhooks
- SSR/SSG/ISR where appropriate

The public website should be primarily server-rendered.

This is especially important because SEO is a major requirement.

---

# 7. TypeScript

Use strict TypeScript.

Avoid unnecessary `any`.

Use shared types wherever possible.

Validation should happen at application boundaries.

Recommended:

- Zod
- TypeScript
- Drizzle schema types

---

# 8. Styling

Use:

**Tailwind CSS**

The design should be custom.

Do not use a generic pre-built WordPress-like theme.

---

# 9. UI

Use:

**shadcn/ui**

Use it as a component foundation, not as the complete visual identity.

The final design should feel like a modern running/sports community rather than a generic SaaS dashboard.

---

# 10. Visual Design Direction

The website should feel:

- modern
- athletic
- energetic
- community-oriented
- clean
- premium without being corporate
- visually strong
- mobile-first

Avoid:

- old-fashioned sports-club aesthetics
- generic WordPress layouts
- excessive gradients
- huge dashboards
- unnecessary animations
- overly corporate UI

Potential branding direction:

> **Run together. Run further.**

Final branding is TBD.

---

# 11. Public Routes

Initial public routes:

```text
/
 /events
 /events/[slug]

 /races
 /races/[slug]

 /news
 /news/[slug]

 /gallery
 /gallery/[slug]

 /results

 /about

 /login
 /profile
```

Additional routes may be added later.

---

# 12. Admin Routes

Initial admin structure:

```text
/admin

/admin/events
/admin/events/[id]

/admin/races
/admin/races/[id]

/admin/registrations

/admin/users

/admin/news
/admin/news/[id]

/admin/gallery
/admin/gallery/[id]

/admin/results
```

The admin system will be custom-built inside the same Next.js application.

---

# 13. Homepage

The homepage should focus on the community and upcoming activity.

Suggested structure:

```text
------------------------------------------------

BRAȘOV RUNNERS

Run together.
Run further.

NEXT RUN

Wednesday Trail Run #47
26 Aug · 19:00
12.4 km · 420m+

[ JOIN THE RUN ]

------------------------------------------------

UPCOMING EVENTS

[ Event ]
[ Event ]
[ Event ]

------------------------------------------------

LATEST FROM THE COMMUNITY

[ News ]
[ News ]

------------------------------------------------

RECENT PHOTOS

[ Gallery ]

------------------------------------------------
```

The exact design will evolve during implementation.

---

# 14. Event System

Events are a core entity.

Initial event model:

```text
events
------
id
title
slug
description
date
startTime
location
latitude
longitude
distance
elevation
difficulty
coverImage
gpxFile
capacity
registrationOpen
registrationClose
registrationType
externalRegistrationUrl
status
createdAt
updatedAt
```

Possible statuses:

```text
DRAFT
PUBLISHED
CANCELLED
COMPLETED
```

---

# 15. Event Types

Potential event types:

```text
COMMUNITY_RUN
TRAIL_RUN
INTERVAL_SESSION
LONG_RUN
RACE
OTHER
```

Exact enum values are TBD.

Do not overcomplicate the event model initially.

---

# 16. Own Registration System

The platform will support registration directly.

Basic flow:

```text
User
 |
 v
Event page
 |
 v
REGISTER
 |
 v
Zitadel login
 |
 v
Registration form
 |
 v
PostgreSQL
 |
 v
Mailgun confirmation
```

Example:

```text
Wednesday Trail Run #47

26 August 2026
19:00
12.4 km
420m+

[ REGISTER ]
```

After registration:

```text
You're registered!

Wednesday Trail Run #47
26 August · 19:00

[ Cancel registration ]
```

---

# 17. Registration Database

Initial model:

```text
registrations
-------------
id
eventId
userId
status
category
bibNumber
createdAt
updatedAt
```

Potential statuses:

```text
PENDING
CONFIRMED
WAITLIST
CANCELLED
CHECKED_IN
DNS
DNF
FINISHED
```

Exact lifecycle is TBD.

---

# 18. Registration Questions

The platform may eventually support custom questions.

Examples:

- T-shirt size
- Emergency contact
- Phone number
- Age/category
- Running club
- Consent
- Other race-specific information

Potential models:

```text
registration_questions
----------------------
id
eventId
label
type
required
options
sortOrder
```

```text
registration_answers
--------------------
id
registrationId
questionId
value
```

Do not implement this complexity until it is actually needed.

---

# 19. Race Management

The custom system should eventually support:

- registration
- participant list
- capacity
- categories
- bib numbers
- check-in
- DNS
- DNF
- finish status
- results
- CSV export

Potential admin view:

```text
Participants: 184 / 250

Search...

Name       Category   Status
--------------------------------
Ion Pop    M35        Confirmed
Maria I.   F30        Confirmed
Alex P.    M40        Checked-in

[ Export CSV ]
[ Email participants ]
[ Close registration ]
```

---

# 20. Sportic / 42km

Sportic / 42km should be treated as an **optional integration**.

The internal system must work without it.

Potential model:

```text
registrationType

INTERNAL
EXTERNAL
```

If `EXTERNAL`, the event can contain:

```text
externalRegistrationUrl
externalProvider
```

Example:

```text
Brașov Runners event
       |
       +--> Internal registration
       |
       +--> Sportic registration
```

This gives maximum flexibility.

---

# 21. Authentication

Use:

**Zitadel**

Do not implement password authentication manually.

Zitadel should handle:

- signup
- login
- Google login
- email verification
- password reset
- sessions
- identity
- MFA if needed later

Use OIDC/OAuth2.

The local application should store the Zitadel user ID.

---

# 22. User Model

Potential model:

```text
users
-----
id
zitadelUserId
email
displayName
firstName
lastName
phone
avatarUrl
createdAt
updatedAt
```

Do not store passwords.

---

# 23. Authorization

Initial roles:

```text
USER
EDITOR
ADMIN
```

### USER

Can:

- manage own profile
- register for events
- view registrations
- cancel registrations
- view results

### EDITOR

Can:

- create/edit events
- create/edit news
- manage galleries

### ADMIN

Can additionally:

- manage users
- manage roles
- manage registrations
- manage race settings
- access system configuration

Exact permissions are TBD.

---

# 24. Database

Use:

**PostgreSQL**

Provider:

**Neon**

Reasons:

- managed
- serverless-friendly
- easy Vercel integration
- no server maintenance
- good free tier
- sufficient for expected scale

The database is expected to remain relatively small.

The main storage concern will be images, not database size.

---

# 25. ORM

Use:

**Drizzle ORM**

Reasons:

- lightweight
- TypeScript-first
- good SQL transparency
- simple migrations
- good fit for a small-to-medium application

Potential structure:

```text
src/
  db/
    client.ts
    schema.ts
    migrations/
```

---

# 26. Initial Database Entities

Initial:

```text
users
events
registrations
registration_questions
registration_answers
news
gallery_albums
gallery_photos
results
```

Potential later:

```text
race_categories
check_ins
race_results
notifications
email_templates
audit_logs
routes
clubs
teams
```

Do not build future entities before they are needed.

---

# 27. File Storage

Use:

**Cloudflare R2**

Use R2 for:

- event images
- race images
- galleries
- GPX files
- PDFs
- logos
- other uploaded files

Do not store large files in PostgreSQL.

Database stores metadata and object keys.

R2 stores the actual file.

---

# 28. Photo Architecture

```text
Admin
 |
 v
Next.js
 |
 v
Cloudflare R2
 |
 +-- events/
 +-- gallery/
 +-- routes/
 +-- users/
```

Database:

```text
gallery_photos
--------------
id
albumId
storageKey
caption
sortOrder
createdAt
```

---

# 29. Email

Use:

**Mailgun**

Potential emails:

- registration confirmation
- registration cancellation
- event reminder
- event cancellation
- event changes
- waitlist notification
- admin notification
- contact form
- newsletter

Do not create a custom mail server.

---

# 30. DNS

Use:

**Cloudflare**

Primary role:

- DNS
- domain management
- basic security
- R2 integration

Do not unnecessarily put Cloudflare's reverse proxy in front of Vercel.

Preferred:

```text
<domain>
       |
Cloudflare DNS
       |
Vercel
```

---

# 31. Hosting

Use:

**Vercel**

Advantages:

- excellent Next.js support
- GitHub integration
- preview deployments
- automatic production deployment
- serverless infrastructure
- minimal operations

Target:

Free tier initially.

Upgrade only when actual usage requires it.

---

# 32. Repository

Use:

**GitHub**

Repository:

```text
brasov-runners
```

Initially:

**Private repository**

Possible future organization:

```text
github.com/brasov-runners/website
```

if the project becomes officially owned by the organization.

---

# 33. Development Workflow

Recommended:

```text
VS Code
   |
Git
   |
GitHub
   |
Vercel
```

Workflow:

```text
feature branch
      |
      v
development
      |
      v
pull request
      |
      v
preview deployment
      |
      v
merge
      |
      v
production
```

---

# 34. AI Coding Strategy

The project will be heavily vibe-coded.

Use:

### OpenAI Codex

Primary use:

- implementation
- backend
- database
- integrations
- tests
- refactoring
- larger tasks

### Claude Code

Primary use:

- UI/UX iteration
- design refinement
- architecture review
- code review
- refactoring
- second opinions

Both agents should operate against the same GitHub repository.

---

# 35. AI Agent Rules

Do not ask an AI:

> Build the entire Brașov Runners platform.

Instead work incrementally.

Recommended sequence:

```text
1. Project setup
2. Visual design
3. Homepage
4. Public events
5. SEO
6. Database
7. Authentication
8. Admin
9. Registration
10. Email
11. Storage
12. Results
13. External integrations
14. Production hardening
```

Agents must:

- inspect the repository before changing it
- understand existing architecture
- avoid unnecessary dependencies
- avoid overengineering
- avoid duplicate abstractions
- run lint/tests after meaningful changes
- never commit secrets
- explain significant architectural changes
- preserve existing conventions

---

# 36. Git / Agent Workflow

Do not have Codex and Claude Code edit the same branch simultaneously.

Preferred:

```text
Codex
 |
 commit
 |
Claude Code
 |
 review/fix
 |
 commit
 |
Codex
```

For parallel work, use separate branches/worktrees.

---

# 37. SEO

SEO is a first-class requirement.

Public content must be indexable.

Use:

- SSR
- static generation where appropriate
- metadata
- canonical URLs
- sitemap
- robots.txt
- Open Graph
- structured data
- semantic HTML
- optimized images
- Core Web Vitals
- internal linking
- clean URLs

---

# 38. SEO Targets

Potential search queries:

```text
brasov runners
alergare brasov
grup alergare brasov
club alergare brasov
alergare brasov miercuri
curse alergare brasov
trail running brasov
running club brasov
```

Individual event/race pages should be indexable.

Example:

```text
/events/wednesday-trail-run-47
```

should contain actual useful information, not just a registration link.

---

# 39. Event SEO

Each event should have:

- unique title
- unique description
- date
- time
- location
- distance
- elevation
- organizer
- registration information
- images
- relevant internal links

Example title:

```text
Wednesday Trail Run #47 — Brașov Runners
```

---

# 40. Structured Data

Use Schema.org JSON-LD.

Potential types:

```text
SportsEvent
Event
Organization
Article
BreadcrumbList
```

Example:

```json
{
  "@context": "https://schema.org",
  "@type": "SportsEvent",
  "name": "Brașov Runners Trail Run",
  "startDate": "2026-08-26T19:00:00+03:00",
  "organizer": {
    "@type": "Organization",
    "name": "Brașov Runners"
  }
}
```

Validate against current Google requirements before production.

---

# 41. Sitemap

Automatically generate:

```text
/sitemap.xml
```

Include:

- homepage
- events
- races
- news
- public gallery pages
- other public content

Exclude:

- admin
- login
- internal APIs
- private user pages

---

# 42. Robots

Generate:

```text
/robots.txt
```

Disallow private/admin areas.

---

# 43. Performance

Target:

```text
Performance: 90+
Accessibility: 95+
Best Practices: 95+
SEO: 100
```

Priorities:

- Server Components
- minimal client JS
- optimized images
- responsive images
- lazy loading
- caching
- minimal dependencies

---

# 44. Mobile

Mobile-first is mandatory.

The majority of users will likely access event/registration pages from phones.

Prioritize:

- fast loading
- large tap targets
- simple navigation
- readable typography
- fast registration
- minimal forms

---

# 45. Maps / GPX

Potential technology:

**MapLibre GL JS**

Potential functionality:

- route maps
- GPX uploads
- route previews
- distance
- elevation

Not required for V1.

---

# 46. Analytics

Use lightweight analytics.

Possible:

- Plausible
- Umami

Google Analytics is not required unless there is a specific reason to use it.

---

# 47. Admin Interface

Custom admin UI.

No WordPress-like CMS.

Admin dashboard:

```text
Dashboard

Events
Races
Registrations
Users
News
Gallery
Results
```

The admin UI should prioritize practical workflows rather than visual complexity.

---

# 48. Participant Management

Eventually support:

- search
- filtering
- category
- registration status
- bib number
- check-in
- DNS
- DNF
- finish status
- CSV export
- bulk email

---

# 49. Results

Potential result model:

```text
results
-------
id
eventId
userId
bibNumber
category
position
genderPosition
categoryPosition
finishTime
pace
status
```

Possible statuses:

```text
FINISHED
DNS
DNF
DSQ
```

Results are future scope.

---

# 50. Data Privacy / GDPR

The platform will store personal information.

Potential data:

- name
- email
- phone
- emergency contact
- registration details
- race information

Requirements:

- minimize collected data
- protect admin routes
- never expose private participant data
- use HTTPS
- secure database
- secure secrets
- define retention policies
- privacy policy
- terms/consent where appropriate
- GDPR review before production

Do not expose participant lists publicly unless explicitly intended and legally appropriate.

---

# 51. Secrets

Never commit:

```text
DATABASE_URL
ZITADEL_CLIENT_SECRET
MAILGUN_API_KEY
R2_ACCESS_KEY
R2_SECRET_KEY
```

Use:

```text
.env.local
```

Commit only:

```text
.env.example
```

Production secrets belong in Vercel/environment secret management.

---

# 52. Cost Strategy

Target extremely low operating costs.

Expected initial architecture:

```text
Domain                 Paid
Vercel                 Free tier
Neon                   Free tier
Zitadel                Free tier
Mailgun                Free/low usage
Cloudflare DNS         Free
Cloudflare R2          Free/low usage
GitHub                 Free
```

The main unavoidable cost is expected to be the domain.

Potential future costs:

- database beyond free tier
- image storage
- hosting beyond free tier
- email volume
- paid services required by increased traffic

Do not assume free tiers will remain unlimited forever.

---

# 53. Why Not WordPress?

WordPress was considered but rejected.

Reasons:

- unnecessary complexity for this developer
- less control over architecture
- plugin/theme dependency
- harder to keep the frontend exactly as desired
- less enjoyable development experience
- custom registration system would still require substantial customization
- performance/SEO can be good, but would require additional work
- developer already has strong React/TypeScript skills

Custom Next.js provides better control and is expected to be more enjoyable to build and maintain.

---

# 54. Why Not Wix?

Wix was rejected because:

- limited custom application architecture
- poor fit for custom authentication
- custom registration requirements
- less control
- developer prefers coding
- future extensibility is important

---

# 55. Why Not a Traditional .NET Backend?

The developer has strong .NET experience, but a separate:

```text
Next.js frontend
+
.NET API
+
database
```

would introduce unnecessary infrastructure for V1.

Next.js can handle:

- server-side rendering
- server actions
- APIs
- authentication integration
- database access
- webhooks
- business logic

A .NET backend can be introduced later only if the application genuinely requires it.

---

# 56. Why Neon Instead of Supabase?

Supabase is a valid alternative.

However, the architecture already uses:

- Zitadel for auth
- Cloudflare R2 for storage

Therefore Supabase would mainly provide PostgreSQL.

Neon is preferred because it provides a focused managed PostgreSQL service with a good fit for the architecture.

---

# 57. Why Drizzle Instead of Prisma?

Drizzle is preferred because:

- lightweight
- SQL-oriented
- TypeScript-native
- transparent
- simple for this project

Prisma remains a valid alternative if requirements change.

---

# 58. Why R2?

Cloudflare R2 is intended for object/file storage.

Use it for:

- images
- galleries
- GPX
- PDFs
- uploads

Do not use PostgreSQL to store image binaries.

This is especially important because a running community can accumulate a very large number of photos.

---

# 59. Architecture Philosophy

The key principle:

> **Keep it simple, but not disposable.**

The entire application should ideally remain understandable by one developer.

Prefer:

```text
One Next.js application
One PostgreSQL database
Managed specialized services
```

Avoid:

```text
microservices
multiple backend applications
Kubernetes
self-hosted infrastructure
```

unless there is a concrete requirement.

---

# 60. V1 Scope

## Public

- homepage
- events
- event details
- races
- race details
- news
- gallery
- about
- responsive design
- SEO

## Authentication

- signup
- login
- Google login
- profile

## Admin

- event CRUD
- race CRUD
- news CRUD
- gallery management

## Registration

- free event registration
- free race registration
- confirmation email
- cancellation
- participant list
- CSV export

## Infrastructure

- Vercel
- Neon
- Zitadel
- Mailgun
- R2
- Cloudflare
- GitHub

---

# 61. V2 Scope

Potential additions:

- waitlists
- custom registration forms
- bib assignment
- check-in
- race results
- leaderboards
- GPX maps
- recurring events
- attendance history
- personal running statistics
- community profiles
- club rankings
- race calendars
- photo tagging
- automatic reminders
- calendar/ICS integration
- Strava integration
- Garmin integration

---

# 62. Long-Term Vision

The project may eventually become more than a website.

Potential future platform:

```text
Users
 |
 +-- Events
 |
 +-- Races
 |
 +-- Registrations
 |
 +-- Results
 |
 +-- Personal history
 |
 +-- Routes
 |
 +-- Photos
 |
 +-- Community
```

However:

> **Do not build the future platform before the current community needs it.**

---

# 63. Development Roadmap

Recommended implementation order:

### Phase 1 — Foundation

- Next.js
- TypeScript
- Tailwind
- shadcn/ui
- GitHub
- Vercel
- basic project structure

### Phase 2 — Design

- branding
- typography
- colors
- navigation
- homepage
- mobile design

### Phase 3 — Public Content

- events
- races
- news
- gallery
- about

### Phase 4 — SEO

- metadata
- sitemap
- robots
- structured data
- canonical URLs
- Open Graph
- performance optimization

### Phase 5 — Database

- Neon
- Drizzle
- schema
- migrations
- seed data

### Phase 6 — Authentication

- Zitadel
- user profile
- roles

### Phase 7 — Admin

- event management
- race management
- news
- gallery

### Phase 8 — Registration

- registration forms
- participant management
- cancellation
- capacity
- confirmation

### Phase 9 — Email

- Mailgun
- templates
- registration emails
- event updates

### Phase 10 — Storage

- R2
- uploads
- image galleries
- GPX

### Phase 11 — Results

- results model
- results admin
- public results pages

### Phase 12 — External Integrations

- Sportic/42km where useful
- future Strava/Garmin integrations

### Phase 13 — Production Hardening

- security
- GDPR
- backups
- monitoring
- error handling
- performance
- accessibility
- SEO audit

---

# 64. Development Rules

When adding a feature:

1. Does the community need it?
2. Can an existing service handle it?
3. Does it introduce unnecessary infrastructure?
4. Does it affect SEO?
5. Does it affect GDPR/security?
6. Can it remain inside the existing Next.js application?
7. Can one developer maintain it?
8. Can it be implemented incrementally?

If the answer to #6 is yes, prefer keeping it inside the monolith.

---

# 65. Final Decision

The project is:

> **A custom, SEO-first Next.js running-community and race-registration platform for Brașov Runners.**

Final intended stack:

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
Drizzle
Neon PostgreSQL
Zitadel
Mailgun
Cloudflare R2
Cloudflare DNS
Vercel
GitHub
Codex
Claude Code
```

Registration:

```text
Custom internal registration
+
optional Sportic/42km integration
```

Hosting philosophy:

```text
Serverless / managed
Minimal operations
Free tiers initially
Pay only as usage grows
```

Development philosophy:

```text
AI-assisted
Incremental
Simple
SEO-first
Mobile-first
No unnecessary infrastructure
```

The most important architectural rule:

> **Brașov Runners owns the application and its registration data. External services should provide specialized capabilities, not become dependencies that define the entire platform.**