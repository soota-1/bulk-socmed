import { z } from "zod";
import {
  MAX_TITLE_LENGTH,
  MAX_VIDEO_SIZE_BYTES,
  MAX_THUMBNAIL_SIZE_BYTES,
  SUPPORTED_VIDEO_TYPES,
  SUPPORTED_THUMBNAIL_TYPES,
} from "./constants";

// ---------------------------------------------------------------------------
// Upload request schema (used by POST /api/v1/uploads)
// ---------------------------------------------------------------------------

const VideoMetadataSchema = z
  .object({
    duration_ms: z.number().int().nonnegative().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .optional();

export const UploadRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video"),
    filename: z.string().min(1),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(MAX_VIDEO_SIZE_BYTES, {
        message: `size_bytes must not exceed ${MAX_VIDEO_SIZE_BYTES} bytes (50 MB)`,
      }),
    content_type: z.enum(SUPPORTED_VIDEO_TYPES),
    metadata: VideoMetadataSchema,
  }),
  z.object({
    kind: z.literal("thumbnail"),
    filename: z.string().min(1),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(MAX_THUMBNAIL_SIZE_BYTES, {
        message: `size_bytes must not exceed ${MAX_THUMBNAIL_SIZE_BYTES} bytes (8 MB)`,
      }),
    content_type: z.enum(SUPPORTED_THUMBNAIL_TYPES),
    metadata: VideoMetadataSchema,
  }),
]);

export type UploadRequest = z.infer<typeof UploadRequestSchema>;

// ---------------------------------------------------------------------------
// Schedule sub-schema
// ---------------------------------------------------------------------------

const ScheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("next_free") }),
  z.object({ type: z.literal("slot"), slot_key: z.string().regex(/^\d{4}-\d{2}-\d{2}@\d{2}:\d{2}$/) }),
  z.object({ type: z.literal("custom"), due_at: z.string().datetime() }),
]);

// ---------------------------------------------------------------------------
// Post create schema (used by POST /api/v1/posts)
// ---------------------------------------------------------------------------

export const PostCreateSchema = z.object({
  video_upload_id: z.string().uuid(),
  thumbnail_upload_id: z.string().uuid().optional(),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  caption: z.string().min(1, { message: "Caption tidak boleh kosong" }),
  hashtags: z.string().optional(),
  schedule: ScheduleSchema.optional(),
  mode: z.enum(["schedule", "draft"]).optional().default("schedule"),
});

export type PostCreate = z.infer<typeof PostCreateSchema>;

// ---------------------------------------------------------------------------
// Post update schema (used by PATCH /api/v1/posts/{id})
// ---------------------------------------------------------------------------

export const PostUpdateSchema = z
  .object({
    title: z.string().max(MAX_TITLE_LENGTH).optional(),
    caption: z.string().min(1).optional(),
    hashtags: z.string().optional(),
    thumbnail_upload_id: z.string().uuid().nullable().optional(),
    schedule: ScheduleSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Minimal satu field harus diubah",
  });

export type PostUpdate = z.infer<typeof PostUpdateSchema>;

// ---------------------------------------------------------------------------
// Settings schema (used by PATCH /api/v1/settings)
// ---------------------------------------------------------------------------

export const SettingsSchema = z.object({
  grace_minutes: z.number().int().min(5).max(1440).optional(),
  tiktok_window_days: z.number().int().min(1).max(14).optional(),
  buffer_queue_limit: z.number().int().min(1).max(100).optional(),
  retry_backoff_minutes: z
    .array(z.number().int().min(1).max(120))
    .length(3)
    .refine(([a, b, c]) => a !== undefined && b !== undefined && c !== undefined && a < b && b < c, {
      message: "retry_backoff_minutes harus 3 angka naik",
    })
    .optional(),
  instagram_prepare_lead_minutes: z.number().int().min(5).max(60).optional(),
  min_lead_minutes: z.number().int().min(5).max(120).optional(),
  media_retention_days: z.number().int().min(1).max(30).optional(),
  event_retention_days: z.number().int().min(30).max(730).optional(),
  quota_warn_percent: z.number().int().min(50).max(95).optional(),
  storage_quota_mb: z.number().int().positive().optional(),
  egress_quota_mb: z.number().int().positive().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
