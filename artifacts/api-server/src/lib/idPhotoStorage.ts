/**
 * ID Photo Storage
 *
 * Server-side helper for storing government-issued ID photos in a private
 * GCS bucket and generating time-limited signed read URLs for admin viewing.
 *
 * Photos are stored under the prefix "id-photos/<uuid>" within the private
 * object directory. They are never publicly accessible.
 */

import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const storage = new Storage({
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
  },
  projectId: "",
});

function getBucketName(): string {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID env var is not set");
  return bucketId;
}

/**
 * Upload an ID photo buffer to private GCS storage.
 * Returns the GCS object name (path within the bucket), stored as id_photo_url.
 * Photos are stored under id-photos/<uuid>.<ext> — never publicly accessible
 * without a signed URL.
 */
export async function uploadIdPhoto(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
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
 * Used to proxy the image through the API server — avoids signed URLs,
 * which require service account credentials not available in this environment.
 */
export async function downloadIdPhoto(
  objectName: string,
): Promise<{ buffer: Buffer; contentType: string }> {
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
    const bucketName = getBucketName();
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.delete({ ignoreNotFound: true });
  } catch (err: any) {
    console.error("[deleteIdPhoto] Failed to delete ID photo:", err?.message ?? err);
  }
}
