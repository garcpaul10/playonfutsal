/**
 * AES-256-GCM symmetric encryption for sensitive ID fields stored at rest.
 * Key is read from ID_ENCRYPTION_KEY (32-byte value as hex or base64).
 * Ciphertext format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env["ID_ENCRYPTION_KEY"];
  if (!raw) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("ID_ENCRYPTION_KEY is required in production");
    }
    console.warn("[encrypt] ID_ENCRYPTION_KEY not set — using insecure dev key. Set this in production.");
    return scryptSync("playon-dev-key-do-not-use-in-prod", "salt", 32);
  }

  // Accept hex (64 chars) or base64 (44 chars for 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const fromBase64 = Buffer.from(raw, "base64");
  if (fromBase64.length === 32) {
    return fromBase64;
  }
  // Fall back to scrypt derivation from the raw string (any length)
  return scryptSync(raw, "playon-id-salt", 32);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
    throw new Error("Invalid encrypted field lengths");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function encryptOrNull(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return encrypt(value);
}

export function decryptOrNull(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}
