# Implementation Plan: Fase 4 — Operational Automation, Maintenance, Backup & Deployment

Phase 4 implements storage & cache cleanup, OAuth token auto-refresh, event pruning, daily JSON backups, resilient daemon lifecycle with graceful shutdown, Windows Task Scheduler scripts, pre-flight environment doctor, and full operational documentation.

---

## Task 1: Maintenance Engine (`apps/worker/src/maintenance.ts`)
- Storage & cache cleanup when all targets for a post reach terminal states and age > media_retention_days.
- OAuth token auto-refresh for tokens expiring within 24 hours.
- Event log pruning for events older than event_retention_days.
- Unit tests in `apps/worker/test/maintenance.test.ts`.

## Task 2: Daily JSON Backup Engine (`apps/worker/src/backup.ts`)
- Exports core tables to `data/backups/YYYY-MM-DD/*.json`.
- Rotates backups keeping the last 7 daily copies.
- Unit tests in `apps/worker/test/backup.test.ts`.

## Task 3: Worker Daemon Lifecycle & Graceful Shutdown (`apps/worker/src/daemon.ts` & `index.ts`)
- 30-second loop executing scheduler cycle, heartbeat, pending connection tests, and maintenance/backup checks.
- Signal handling for `SIGINT` / `SIGTERM` with clean shutdown.
- Unit tests in `apps/worker/test/daemon.test.ts`.

## Task 4: Automation Scripts & Environment Doctor (`scripts/`)
- `scripts/worker-task-scheduler.ps1` to register worker daemon in Windows Task Scheduler.
- `scripts/doctor.ts` for pre-flight environment and database check.

## Task 5: Complete Operations Guide (`docs/operations-guide.md`)
- Step-by-step zero-cost setup guide (Vercel, Supabase, Buffer).
- OAuth credentials configuration for Google & Meta.
- Laptop sleep prevention and disaster recovery instructions.

## Task 6: Final Monorepo Verification & Build
- Verify all workspace test suites (`pnpm -r test`).
- Production build validation (`pnpm --filter web build`).
