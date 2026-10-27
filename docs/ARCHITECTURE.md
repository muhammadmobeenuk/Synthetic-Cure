# Architecture

Phone/tablet/desktop React → same-origin authenticated /api/v1 → validated domain commands → PostgreSQL + private file adapter. Express serves Vite middleware in development and built assets in production. Query client holds server state. IndexedDB holds explicit user-scoped drafts only. Immutable events support traceability. Database-backed jobs produce reviewable exports; OCR remains unconfigured. UTC event timestamps; date-only preparation/delivery dates with an explicit configurable company timezone (JadeSun: Europe/London).
PostgreSQL production through pg; persistent PGlite development through common parameterized query/transaction boundary. SQL migrations versioned. See DECISIONS.md and OPERATIONS.md.

## Platform foundation
Retain the modular monolith and parameterized PostgreSQL adapter. Composite company foreign keys supplement API object authorization; no connection-global tenant/RLS context is used. PLATFORM-002 adds explicit company memberships and warehouse grants with server-validated active contexts; see ACCESS.md for legacy provenance and remaining lifecycle limits. Typed configuration and immutable revisions are separate from inventory. Preparation policy JSON is a bounded historical snapshot, not executable rules. Persistent PGlite remains development-only.

## PLATFORM-002 authorization

Global identity → explicit company membership → selected authorized warehouse. Actor resolution runs at request entry; transactional commands revalidate/lock current membership and warehouse grant before replay/state mutation. Fixed SQL workspace queries carry warehouse scope; object services and composite foreign keys guard referenced objects. No SQL-text tenant rewriting or connection-global RLS context is used. Access edits acquire company lock before membership locks to keep concurrent administrator changes ordered. See ACCESS.md.

## Product CSV imports
PLATFORM-003 uses a synchronous bounded domain service (500 rows/256 KiB) for review/commit; no speculative queue. Originals are private database text, not public assets. Company catalogue scope and warehouse review provenance remain distinct. See IMPORTS.md.
