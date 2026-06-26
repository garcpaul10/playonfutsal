/**
 * ID Photo Storage
 *
 * Stores ID photos as base64 data URIs in the id_photo_url DB column.
 * No external storage service required.
 *
 * If CLOUDINARY_URL is set, photos are stored in Cloudinary instead.
 */

import { randomUUID } from "crypto";

// ── Cloudinary (optional) ──────────────────────────────────────────────────────

async function tryCloudinaryUpload(buffer: Buffer, mimeType: string): Promise<string | null> {
  const cloudinaryUrl = process.env.CLOUDINARY_URL;
  if (!cloudinaryUrl) return null;
  try {
    const { v2: cloudinary } = await import("cloudinary");
    cloudinary.config({ secure: true });
    const b64 = buffer.toString("base64");
    const dataUri = `data:${mimeType};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "id-photos",
      public_id: randomUUID(),
      resource_type: "image",
      type: "private",
    });
    return `cloudinary:${result.public_id}`;
  } catch (err: any) {
    console.error("[idPhotoStorage] Cloudinary upload failed, falling back to DB:", err?.message);
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function uploadIdPhoto(buffer: Buffer, mimeType: string): Promise<string> {
  // Try Cloudinary first if configured
  const cloudinaryResult = await tryCloudinaryUpload(buffer, mimeType);
  if (cloudinaryResult) return cloudinaryResult;

  // Fallback: store as base64 data URI directly in the DB column
  const b64 = buffer.toString("base64");
  return `data:${mimeType};base64,${b64}`;
}

export async function downloadIdPhoto(objectName: string): Promise<{ buffer: Buffer; contentType: string }> {
  // Inline base64 data URI
  if (objectName.startsWith("data:")) {
    const [header, b64] = objectName.split(",");
    const contentType = header.replace("data:", "").replace(";base64", "");
    return { buffer: Buffer.from(b64, "base64"), contentType };
  }

  // Cloudinary
  if (objectName.startsWith("cloudinary:")) {
    const publicId = objectName.replace("cloudinary:", "");
    const { v2: cloudinary } = await import("cloudinary");
    cloudinary.config({ secure: true });
    const url = cloudinary.utils.private_download_url(publicId, "jpg", {
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

  // Legacy GCS path
  const { Storage } = require("@google-cloud/storage");
  const credentialsJson = process.env.GCS_CREDENTIALS;
  let storage;
  if (credentialsJson) {
    const credentials = JSON.parse(credentialsJson);
    storage = new Storage({ credentials, projectId: credentials.project_id });
  } else {
    storage = new Storage({
      credentials: {
        audience: "replit", subject_token_type: "access_token",
        token_url: "http://127.0.0.1:1106/token", type: "external_account",
        credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
        universe_domain: "googleapis.com",
      } as any,
      projectId: "",
    });
  }
  const bucketName = process.env.GCS_BUCKET_NAME ?? process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
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
  if (objectName.startsWith("data:")) return; // nothing to delete for inline storage
  if (objectName.startsWith("cloudinary:")) {
    try {
      const { v2: cloudinary } = await import("cloudinary");
      cloudinary.config({ secure: true });
      await cloudinary.uploader.destroy(objectName.replace("cloudinary:", ""), { resource_type: "image", type: "private" });
    } catch (err: any) {
      console.error("[deleteIdPhoto] Cloudinary delete failed:", err?.message);
    }
  }
}
