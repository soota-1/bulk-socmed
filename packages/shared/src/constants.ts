export const TIMEZONE_WIB = "Asia/Jakarta";

export const DEFAULT_SLOT_TIMES = ["06:00", "12:00", "16:00", "19:00"] as const;

export const DEFAULT_MIN_LEAD_MINUTES = 15;
export const DEFAULT_INSTAGRAM_PREPARE_LEAD_MINUTES = 10;
export const DEFAULT_TIKTOK_WINDOW_DAYS = 2;
export const DEFAULT_GRACE_MINUTES = 120;

export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_THUMBNAIL_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_TITLE_LENGTH = 100;

export const SUPPORTED_VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
export const SUPPORTED_THUMBNAIL_TYPES = ["image/jpeg", "image/png"] as const;
