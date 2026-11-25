import type { SupabaseClient } from "@supabase/supabase-js";
import type { Platform, TargetStatus, PlannedTarget } from "@bulk-socmed/shared";
export type { Platform };
import type { CachedMedia } from "../media-cache";

export interface StepTarget {
  id: number;
  post_id: number;
  platform: Platform;
  status: TargetStatus;
  step: string | null;
  attempt_count: number;
  external_id: string | null;
  external_state: Record<string, unknown>;
  idempotency_key: string;
}

export interface StepPost {
  id: number;
  title: string | null;
  caption: string;
  hashtags: string;
  video_object_path: string;
  thumbnail_object_path: string | null;
  due_at: string;
}

export interface StepContext {
  target: StepTarget;
  post: StepPost;
  now: Date;
  accessToken?: string;
  apiKey?: string;
  externalAccountId?: string;
  media: CachedMedia;
  supabase: SupabaseClient;
}

export interface StepError {
  code: string;
  message: string;
  isPermanent?: boolean;
  isAuthError?: boolean;
}

export interface StepResult {
  nextStatus: TargetStatus;
  nextStep: string | null;
  runAt?: Date | null;
  delayMinutes?: number;
  externalId?: string | null;
  externalState?: Record<string, unknown>;
  error?: StepError;
}

export interface ReconcileResult {
  resolvedStatus: "published" | "failed" | "scheduled";
  externalId?: string;
  requiresManualCheck?: boolean;
  notes?: string;
}

export interface Publisher {
  platform: Platform;
  plan(dueAt: Date, now: Date): PlannedTarget;
  advance(ctx: StepContext): Promise<StepResult>;
  reconcile(ctx: StepContext): Promise<ReconcileResult>;
  applyChanges(ctx: StepContext): Promise<void>;
  cancel(ctx: StepContext): Promise<void>;
}

export function createStepSuccess(
  nextStatus: TargetStatus,
  nextStep: string | null,
  options?: {
    runAt?: Date;
    delayMinutes?: number;
    externalId?: string | null;
    externalState?: Record<string, unknown>;
  }
): StepResult {
  return {
    nextStatus,
    nextStep,
    runAt: options?.runAt,
    delayMinutes: options?.delayMinutes,
    externalId: options?.externalId,
    externalState: options?.externalState,
  };
}

export function createStepError(
  code: string,
  message: string,
  options?: {
    isPermanent?: boolean;
    isAuthError?: boolean;
    externalState?: Record<string, unknown>;
  }
): StepResult {
  return {
    nextStatus: options?.isPermanent ? "failed" : "scheduled",
    nextStep: null,
    error: {
      code,
      message,
      isPermanent: options?.isPermanent,
      isAuthError: options?.isAuthError,
    },
    externalState: options?.externalState,
  };
}
