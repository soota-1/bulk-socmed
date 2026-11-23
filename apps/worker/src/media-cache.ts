import path from "node:path";
import fs from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Ensure the media files (video and optional thumbnail) for a post are cached locally.
 * Downloads from Supabase Storage only if the file is not already cached.
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
    const { data, error } = await supabase.storage.from("videos").download(videoObjectPath);
    if (error || !data) {
      throw new Error(`Failed to download video from storage (${videoObjectPath}): ${error?.message}`);
    }
    const arrayBuffer = await data.arrayBuffer();
    await fs.writeFile(videoFilePath, Buffer.from(arrayBuffer));
  }

  // 2. Thumbnail file (optional)
  let thumbFilePath: string | undefined;
  if (thumbObjectPath) {
    const thumbExt = path.extname(thumbObjectPath) || ".jpg";
    thumbFilePath = path.join(postDir, `thumbnail${thumbExt}`);

    if (!(await fileExists(thumbFilePath))) {
      const { data, error } = await supabase.storage.from("thumbnails").download(thumbObjectPath);
      if (error || !data) {
        throw new Error(`Failed to download thumbnail from storage (${thumbObjectPath}): ${error?.message}`);
      }
      const arrayBuffer = await data.arrayBuffer();
      await fs.writeFile(thumbFilePath, Buffer.from(arrayBuffer));
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
