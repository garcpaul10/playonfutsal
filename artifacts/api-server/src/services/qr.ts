/**
 * qr.ts — QR code generation helpers for PlayOn.
 *
 * Generates QR codes as base64 PNG data URIs suitable for inline embedding in HTML emails.
 */

import QRCode from "qrcode";

/**
 * Renders a string as a QR code PNG and returns it as a base64 data URI.
 * The data URI can be used directly in an <img src="..."> tag.
 */
export async function generateQrDataUri(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 256,
    margin: 2,
    color: {
      dark: "#111118",
      light: "#ffffff",
    },
    errorCorrectionLevel: "M",
  });
}
