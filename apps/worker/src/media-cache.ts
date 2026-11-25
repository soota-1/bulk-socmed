import path from "node:path";
import fs from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  downloadR2Object,
  isR2Configured,
  type MediaFolder,
} from "@bulk-socmed/shared/r2";

const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), "data/cache");

export interface CachedMedia {
  videoFilePath: string;
  thumbFilePath?: string;
}

/**
 * Check if a file exists on disk.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function isNotFoundError(err: any): boolean {
  const status = err?.$metadata?.httpStatusCode;
  return status === 404 || err?.name === "NoSuchKey" || err?.Code === "NoSuchKey" || err?.name === "NotFound";
}

/**
 * Download media object from Cloudflare R2 (primary) or Supabase Storage (fallback).
 */
async function downloadMediaBuffer(
  supabase: SupabaseClient,
  folder: MediaFolder,
  objectPath: string
): Promise<Buffer> {
  if (isR2Configured()) {
    try {
      return await downloadR2Object(folder, objectPath);
    } catch (r2Err) {
      if (!isNotFoundError(r2Err)) {
        throw new Error(
          `Failed to download ${folder} from R2 (${objectPath}): ${
            r2Err instanceof Error ? r2Err.message : String(r2Err)
          }`
        );
      }
      // Fallback to Supabase Storage for older items uploaded before R2 migration
    }
  }

  const { data, error } = await supabase.storage.from(folder).download(objectPath);
  if (error || !data) {
    throw new Error(`Failed to download ${folder} from storage (${objectPath}): ${error?.message}`);
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Ensure the media files (video and optional thumbnail) for a post are cached locally.
 * Downloads from Cloudflare R2 / Supabase Storage only if the file is not already cached.
 */
export async function ensureMediaCache(
  supabase: SupabaseClient,
  postId: number,
  videoObjectPath: string,
  thumbObjectPath?: string | null,
  cacheDir = DEFAULT_CACHE_DIR
): Promise<CachedMedia> {
  const postDir = path.join(cacheDir, String(postId));
  await fs.mkdir(postDir, { recursive: true });

  // 1. Video file
  const videoExt = path.extname(videoObjectPath) || ".mp4";
  const videoFilePath = path.join(postDir, `video${videoExt}`);

  if (!(await fileExists(videoFilePath))) {
    const buffer = await downloadMediaBuffer(supabase, "videos", videoObjectPath);
    await fs.writeFile(videoFilePath, buffer);
  }

  // 2. Thumbnail file (optional)
  let thumbFilePath: string | undefined;
  if (thumbObjectPath) {
    const thumbExt = path.extname(thumbObjectPath) || ".jpg";
    thumbFilePath = path.join(postDir, `thumbnail${thumbExt}`);

    if (!(await fileExists(thumbFilePath))) {
      const buffer = await downloadMediaBuffer(supabase, "thumbnails", thumbObjectPath);
      await fs.writeFile(thumbFilePath, buffer);
    }
  }

  return {
    videoFilePath,
    thumbFilePath,
  };
}

/**
 * Clean up local media cache for a completed/cancelled post.
 */
export async function cleanMediaCache(
  postId: number,
  cacheDir = DEFAULT_CACHE_DIR
): Promise<void> {
  const postDir = path.join(cacheDir, String(postId));
  await fs.rm(postDir, { recursive: true, force: true }).catch(() => {});
}
