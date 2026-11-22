import dotenv from "dotenv";
import os from "node:os";
import { parseEncryptionKey } from "./crypto.js";

// Load .env from workspace root or current directory
dotenv.config({ path: "../../.env" });
dotenv.config();

export interface WorkerConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  tokenEncKey: Buffer;
  workerId: string;
  ownerId?: string;
  hostName: string;
}

export function loadConfig(): WorkerConfig {
  const supabaseUrl =
    process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const tokenEncKeyHex = process.env["TOKEN_ENC_KEY"];
  const workerId = process.env["WORKER_ID"] ?? "laptop-01";
  const ownerId = process.env["OWNER_ID"];
  const hostName = os.hostname();

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required in environment");
  }
  if (!supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required in environment");
  }
  if (!tokenEncKeyHex) {
    throw new Error("TOKEN_ENC_KEY is required in environment");
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    tokenEncKey: parseEncryptionKey(tokenEncKeyHex),
    workerId,
    ownerId,
    hostName,
  };
}
