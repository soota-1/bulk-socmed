// Core domain types for bulk-socmed scheduler

export type Platform = "youtube" | "instagram" | "tiktok";

export type ConnectionStatus = "active" | "needs_reauth" | "disabled" | "not_connected";

export type ConnectionProvider = "youtube_api" | "instagram_graph" | "buffer" | "tiktok_direct" | "tiktok_api";

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

export interface PlatformMetadataOverride {
  title?: string;
  caption?: string;
  hashtags?: string;
}

export interface PlannerOptions {
  tiktokWindowDays?: number;
  instagramPrepareLeadMinutes?: number;
  platforms?: Platform[];
}

export interface NextFreeSlotResult {
  candidate: Date;
  key: string;
}
