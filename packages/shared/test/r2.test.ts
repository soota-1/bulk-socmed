import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getR2Config,
  isR2Configured,
  getR2ObjectKey,
  createR2SignedUploadUrl,
  createR2SignedDownloadUrl,
} from "../src/r2";

describe("Cloudflare R2 helper", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
    delete process.env.R2_PUBLIC_DOMAIN;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns null / false when R2 env vars are missing or placeholders", () => {
    expect(isR2Configured()).toBe(false);
    expect(getR2Config()).toBeNull();

    process.env.R2_ACCOUNT_ID = "<account-id>";
    process.env.R2_ACCESS_KEY_ID = "abc";
    process.env.R2_SECRET_ACCESS_KEY = "def";
    process.env.R2_BUCKET_NAME = "bucket";
    expect(isR2Configured()).toBe(false);
  });

  it("loads valid R2 config from env", () => {
    process.env.R2_ACCOUNT_ID = "acc123";
    process.env.R2_ACCESS_KEY_ID = "key123";
    process.env.R2_SECRET_ACCESS_KEY = "secret123";
    process.env.R2_BUCKET_NAME = "bulk-socmed-media";

    expect(isR2Configured()).toBe(true);
    expect(getR2Config()).toEqual({
      accountId: "acc123",
      accessKeyId: "key123",
      secretAccessKey: "secret123",
      bucketName: "bulk-socmed-media",
      publicDomain: undefined,
    });
  });

  it("normalizes object keys under videos/ or thumbnails/", () => {
    expect(getR2ObjectKey("videos", "user-1/id-1/clip.mp4")).toBe("videos/user-1/id-1/clip.mp4");
    expect(getR2ObjectKey("videos", "/videos/user-1/id-1/clip.mp4")).toBe(
      "videos/user-1/id-1/clip.mp4"
    );
    expect(getR2ObjectKey("thumbnails", "user-1/id-2/cover.jpg")).toBe(
      "thumbnails/user-1/id-2/cover.jpg"
    );
  });

  it("generates SigV4 presigned PUT upload URL pointing to r2.cloudflarestorage.com", async () => {
    const url = await createR2SignedUploadUrl({
      folder: "videos",
      objectPath: "u1/123/test.mp4",
      contentType: "video/mp4",
      config: {
        accountId: "myaccount",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        bucketName: "my-bucket",
      },
    });

    const parsed = new URL(url);
    expect(parsed.hostname).toBe("myaccount.r2.cloudflarestorage.com");
    expect(parsed.pathname).toBe("/my-bucket/videos/u1/123/test.mp4");
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    // Should not inject CRC32 checksum query parameters that break browser PUT CORS
    expect(parsed.searchParams.has("x-amz-checksum-crc32")).toBe(false);
  });

  it("generates presigned GET URL clamped to 7 days or uses publicDomain when set", async () => {
    const presigned = await createR2SignedDownloadUrl({
      folder: "videos",
      objectPath: "u1/123/test.mp4",
      expiresInSeconds: 99999999,
      config: {
        accountId: "myaccount",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        bucketName: "my-bucket",
      },
    });
    const parsed = new URL(presigned);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("604800");

    const pub = await createR2SignedDownloadUrl({
      folder: "thumbnails",
      objectPath: "u1/123/cover image.jpg",
      config: {
        accountId: "myaccount",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        bucketName: "my-bucket",
        publicDomain: "https://media.example.com/",
      },
    });
    expect(pub).toBe("https://media.example.com/thumbnails/u1/123/cover%20image.jpg");
  });
});
