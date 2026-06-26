/**
 * ID Photo Storage
 *
 * Stores government-issued ID photos via Cloudinary (preferred, works on Railway)
 * or falls back to GCS via Replit sidecar when running on Replit.
 *
 * Set CLOUDINARY_URL on Railway — format: cloudinary://api_key:api_secret@cloud_name
 * Photos are uploaded to the "id-photos" folder with restricted access.
 */

import { randomUUID } from "crypto";

// ── Cloudinary path ────────────────────────────────────────────────────────────

async function getCloudinary() {
  const { v2: cloudinary } = await import("cloudinary");
  const cloudinaryUrl = process.env.CLOUDINARY_URL;
  if (!cloudinaryUrl) return null;
  cloudinary.config({ secure: true }); // CLOUDINARY_URL is picked up automatically
  return cloudinary;
}

// ── GCS / Replit path ─────────────────────────────────────────────────────────

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function buildGCSStorage() {
  const { Storage } = require("@google-cloud/storage");
  const credentialsJson = process.env.GCS_CREDENTIALS;
  if (credentialsJson) {
    const credentials = JSON.parse(credentialsJson);
    return new Storage({ credentials, projectId: credentials.project_id });
  }
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
}

function getGCSBucketName(): string {
  const name = process.env.GCS_BUCKET_NAME ?? process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!name) throw new Error("No storage configured: set CLOUDINARY_URL or GCS_BUCKET_NAME");
  return name;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function uploadIdPhoto(buffer: Buffer, mimeType: string): Promise<string> {
  const cloudinary = await getCloudinary();
  if (cloudinary) {
    const b64 = buffer.toString("base64");
    const dataUri = `data:${mimeType};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "id-photos",
      public_id: randomUUID(),
      resource_type: "image",
      type: "private",
    });
    return result.public_id;
  }

  // GCS fallback
  const storage = buildGCSStorage();
  const bucketName = getGCSBucketName();
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const objectName = `id-photos/${randomUUID()}.${ext}`;
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);
  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({ metadata: { contentType: mimeType }, resumable: false });
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(buffer);
  });
  return objectName;
}

export async function downloadIdPhoto(objectName: string): Promise<{ buffer: Buffer; contentType: string }> {
  const cloudinary = await getCloudinary();
  if (cloudinary) {
    // Generate a signed URL and fetch the image
    const url = cloudinary.utils.private_download_url(objectName, "jpg", {
      resource_type: "image",
      type: "private",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cloudinary fetch failed: ${res.status}`);
    const ab = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return { buffer: Buffer.from(ab), contentType };
  }

  // GCS fallback
  const storage = buildGCSStorage();
  const bucketName = getGCSBucketName();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);
  const [metadata] = await file.getMetadata();
  const contentType = (metadata.contentType as string | undefined) ?? "image/jpeg";
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { buffer: Buffer.concat(chunks), contentType };
}

export async function deleteIdPhoto(objectName: string): Promise<void> {
  try {
    const cloudinary = await getCloudinary();
    if (cloudinary) {
      await cloudinary.uploader.destroy(objectName, { resource_type: "image", type: "private" });
      return;
    }
    const storage = buildGCSStorage();
    const bucketName = getGCSBucketName();
    const bucket = storage.bucket(bucketName);
    await bucket.file(objectName).delete({ ignoreNotFound: true });
  } catch (err: any) {
    console.error("[deleteIdPhoto] failed:", err?.message ?? err);
  }
}
