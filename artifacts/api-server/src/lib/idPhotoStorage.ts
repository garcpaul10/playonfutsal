/**
 * ID Photo Storage
 *
 * Server-side helper for storing government-issued ID photos in a private
 * GCS bucket and generating time-limited signed read URLs for admin viewing.
 *
 * Photos are stored under the prefix "id-photos/<uuid>" within the private
 * object directory. They are never publicly accessible.
 *
 * Credentials (in priority order):
 *  1. GCS_CREDENTIALS env var — JSON string of a GCS service account key (Railway / any host)
 *  2. Replit sidecar — used automatically when running on Replit
 */

import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function buildStorage(): Storage {
  const credentialsJson = process.env.GCS_CREDENTIALS;
  if (credentialsJson) {
    try {
      const credentials = JSON.parse(credentialsJson);
      return new Storage({ credentials, projectId: credentials.project_id });
    } catch (err) {
      throw new Error("GCS_CREDENTIALS env var is set but is not valid JSON");
    }
  }

  // Fallback: Replit sidecar (only works when running on Replit)
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: "json",
          subject_token_field_name: "access_token",
        },
      },
      universe_domain: "googleapis.com",
    } as any,
    projectId: "",
  });
}

function getBucketName(): string {
  const bucketId = process.env.GCS_BUCKET_NAME ?? process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("GCS_BUCKET_NAME env var is not set");
  return bucketId;
}

/**
 * Upload an ID photo buffer to private GCS storage.
 * Returns the GCS object name (path within the bucket), stored as id_photo_url.
 */
export async function uploadIdPhoto(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const storage = buildStorage();
  const bucketName = getBucketName();
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "jpg";
  const objectName = `id-photos/${randomUUID()}.${ext}`;

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);

  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({
      metadata: { contentType: mimeType },
      resumable: false,
    });
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(buffer);
  });

  return objectName;
}

/**
 * Download an ID photo from GCS and return its buffer + content type.
 * Used to proxy the image through the API server.
 */
export async function downloadIdPhoto(
  objectName: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const storage = buildStorage();
  const bucketName = getBucketName();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);

  const [metadata] = await file.getMetadata();
  const contentType =
    (metadata.contentType as string | undefined) ?? "image/jpeg";

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return { buffer: Buffer.concat(chunks), contentType };
}

/**
 * Delete an ID photo from GCS storage.
 * Silently succeeds if the object doesn't exist.
 */
export async function deleteIdPhoto(objectName: string): Promise<void> {
  try {
    const storage = buildStorage();
    const bucketName = getBucketName();
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.delete({ ignoreNotFound: true });
  } catch (err: any) {
    console.error("[deleteIdPhoto] Failed to delete ID photo:", err?.message ?? err);
  }
}
