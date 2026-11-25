import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type MediaFolder = "videos" | "thumbnails";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicDomain?: string;
}

const MAX_SIGV4_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days max for SigV4

function isPlaceholder(val?: string): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  return !trimmed || trimmed.startsWith("<") || trimmed.includes("...");
}

/**
 * Load Cloudflare R2 configuration from environment variables.
 * Returns null when required R2 credentials are not configured.
 */
export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  const publicDomain = process.env.R2_PUBLIC_DOMAIN?.trim();

  if (
    isPlaceholder(accountId) ||
    isPlaceholder(accessKeyId) ||
    isPlaceholder(secretAccessKey) ||
    isPlaceholder(bucketName)
  ) {
    return null;
  }

  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucketName: bucketName!,
    publicDomain: isPlaceholder(publicDomain) ? undefined : publicDomain,
  };
}

/**
 * Check whether Cloudflare R2 environment credentials are configured.
 */
export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

function requireR2Config(): R2Config {
  const cfg = getR2Config();
  if (!cfg) {
    throw new Error(
      "Konfigurasi Cloudflare R2 belum lengkap (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)."
    );
  }
  return cfg;
}

/**
 * Create an S3-compatible client configured for Cloudflare R2.
 */
export function createR2Client(config?: R2Config): S3Client {
  const cfg = config ?? requireR2Config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    // Avoid automatic CRC32 query params that fail browser presigned PUT CORS requests
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * Normalize an object key inside the R2 bucket under `videos/` or `thumbnails/`.
 */
export function getR2ObjectKey(folder: MediaFolder, objectPath: string): string {
  const clean = objectPath.replace(/^\/+/, "");
  if (clean.startsWith(`${folder}/`)) {
    return clean;
  }
  return `${folder}/${clean}`;
}

/**
 * Generate a presigned PUT URL for direct browser upload to Cloudflare R2.
 */
export async function createR2SignedUploadUrl(params: {
  folder: MediaFolder;
  objectPath: string;
  contentType: string;
  expiresInSeconds?: number;
  config?: R2Config;
}): Promise<string> {
  const cfg = params.config ?? requireR2Config();
  const client = createR2Client(cfg);
  const key = getR2ObjectKey(params.folder, params.objectPath);

  const command = new PutObjectCommand({
    Bucket: cfg.bucketName,
    Key: key,
    ContentType: params.contentType,
  });

  return getSignedUrl(client, command, {
    expiresIn: params.expiresInSeconds ?? 3600,
  });
}

/**
 * Generate a presigned GET URL (or public domain URL if configured) for reading media from R2.
 */
export async function createR2SignedDownloadUrl(params: {
  folder: MediaFolder;
  objectPath: string;
  expiresInSeconds?: number;
  config?: R2Config;
}): Promise<string> {
  const cfg = params.config ?? requireR2Config();
  const key = getR2ObjectKey(params.folder, params.objectPath);

  if (cfg.publicDomain) {
    const base = cfg.publicDomain.replace(/\/+$/, "");
    const encodedKey = key
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `${base}/${encodedKey}`;
  }

  const client = createR2Client(cfg);
  const expiresIn = Math.min(
    Math.max(Math.round(params.expiresInSeconds ?? 600), 60),
    MAX_SIGV4_EXPIRY_SECONDS
  );

  const command = new GetObjectCommand({
    Bucket: cfg.bucketName,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Check if an object exists in Cloudflare R2.
 */
export async function headR2Object(
  folder: MediaFolder,
  objectPath: string,
  config?: R2Config
): Promise<boolean> {
  const cfg = config ?? requireR2Config();
  const client = createR2Client(cfg);
  const key = getR2ObjectKey(folder, objectPath);

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: cfg.bucketName,
        Key: key,
      })
    );
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound" || err?.Code === "NoSuchKey") {
      return false;
    }
    throw err;
  }
}

/**
 * Download an object from Cloudflare R2 as a Node.js Buffer.
 */
export async function downloadR2Object(
  folder: MediaFolder,
  objectPath: string,
  config?: R2Config
): Promise<Buffer> {
  const cfg = config ?? requireR2Config();
  const client = createR2Client(cfg);
  const key = getR2ObjectKey(folder, objectPath);

  const res = await client.send(
    new GetObjectCommand({
      Bucket: cfg.bucketName,
      Key: key,
    })
  );

  if (!res.Body) {
    throw new Error(`Empty response body when downloading R2 object: ${key}`);
  }

  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Delete an object from Cloudflare R2.
 */
export async function deleteR2Object(
  folder: MediaFolder,
  objectPath: string,
  config?: R2Config
): Promise<void> {
  const cfg = config ?? requireR2Config();
  const client = createR2Client(cfg);
  const key = getR2ObjectKey(folder, objectPath);

  await client.send(
    new DeleteObjectCommand({
      Bucket: cfg.bucketName,
      Key: key,
    })
  );
}
