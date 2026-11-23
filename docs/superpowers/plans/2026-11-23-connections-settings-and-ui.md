# Implementation Plan: Fase 3 — Connections, Settings, Post Operations & UI Integration

Phase 3 implements OAuth2 connection handling, Buffer API integration, settings endpoints, post detail/edit/cancel/retry operations, worker connection testing, and the complete Web UI pages.

---

## Task 1: Shared Crypto, Zod Schemas & Types (`packages/shared`)
- Move AES-256-GCM token encryption and key parsing into `packages/shared/src/crypto.ts`.
- Export `parseEncryptionKey`, `encryptToken`, `decryptToken`.
- Add validation schemas for:
  - `BufferConnectionInputSchema`: `{ buffer_api_key: string, buffer_channel_id?: string }`
  - `SettingsSchema`: Zod schema for application settings
  - `PostUpdateSchema`: `{ title?: string, caption?: string, hashtags?: string }`
- Re-export everything cleanly in `packages/shared/src/index.ts`.
- Write unit tests in `packages/shared/test/crypto.test.ts` and `packages/shared/test/validation.test.ts`.

## Task 2: Connections & OAuth Route Handlers (`apps/web`)
- Create:
  - `apps/web/src/app/api/v1/connections/route.ts` (GET)
  - `apps/web/src/app/api/v1/connections/[platform]/authorize/route.ts` (POST)
  - `apps/web/src/app/api/v1/connections/[platform]/test/route.ts` (POST)
  - `apps/web/src/app/api/v1/connections/[platform]/route.ts` (DELETE)
  - `apps/web/src/app/api/v1/connections/tiktok/route.ts` (PUT)
  - `apps/web/src/app/api/v1/connections/tiktok/channels/route.ts` (GET)
  - `apps/web/src/app/api/oauth/[platform]/callback/route.ts` (GET)

## Task 3: Settings Route Handlers (`apps/web`)
- Create:
  - `apps/web/src/app/api/v1/settings/route.ts` (GET, PATCH)

## Task 4: Post Detail, Edit, Cancel & Retry Handlers (`apps/web`)
- Create:
  - `apps/web/src/app/api/v1/posts/[id]/route.ts` (GET, PATCH, DELETE)
  - `apps/web/src/app/api/v1/posts/[id]/retry/route.ts` (POST)

## Task 5: Worker Connection Testing & Daemon Resilience (`apps/worker`)
- Update `apps/worker/src/scheduler.ts` to process connection tests and ping platforms.
- Add unit tests in `apps/worker/test/scheduler.test.ts`.

## Task 6: UI Pages & Navigation (`apps/web`)
- Navigation header in `apps/web/src/app/layout.tsx`
- Connections page in `apps/web/src/app/connections/page.tsx`
- Post Detail page in `apps/web/src/app/posts/[id]/page.tsx`
- Settings page in `apps/web/src/app/settings/page.tsx`
