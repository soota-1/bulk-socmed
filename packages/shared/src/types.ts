// Core domain types for bulk-socmed scheduler

export type Platform = "youtube" | "instagram" | "tiktok";

export type ConnectionStatus = "active" | "needs_reauth" | "disabled" | "not_connected";

export type ConnectionProvider = "youtube_api" | "instagram_graph" | "buffer";

export type TargetStatus =
  | "draft"
  | "scheduled"
  | "uploading"
  | "awaiting_platform"
  | "published"
  | "failed"
  | "missed"
  | "cancelled";

export type PostState = "draft" | "active" | "cancelled";

export type PendingAction = "retry" | "cancel" | "sync_changes";

export interface PlannedTarget {
  platform: Platform;
  dispatch_at: Date;
}

export interface PlannerOptions {
  tiktokWindowDays?: number;
  instagramPrepareLeadMinutes?: number;
}

export interface NextFreeSlotResult {
  candidate: Date;
  key: string;
}
