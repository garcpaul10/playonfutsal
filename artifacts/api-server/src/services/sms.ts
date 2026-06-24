const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

export const smsConfigured = !!(accountSid && authToken && fromNumber);

export async function sendSms(
  to: string,
  body: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!smsConfigured) {
    console.warn("[SMS] Twilio credentials not configured — skipping SMS send to", to);
    return { sent: false, error: "SMS not configured" };
  }

  const e164 = normalizePhone(to);
  if (!e164) {
    console.warn("[SMS] Invalid phone number — skipping:", to);
    return { sent: false, error: "Invalid phone number" };
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: e164,
          From: fromNumber!,
          Body: body,
        }).toString(),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("[SMS] Twilio API error:", err);
      return { sent: false, error: "Twilio API error" };
    }

    return { sent: true };
  } catch (e) {
    console.error("[SMS] Network error:", e);
    return { sent: false, error: "Network error" };
  }
}

export async function sendSmsBulk(
  recipients: { phone: string; name?: string }[],
  body: string,
): Promise<{ total: number; sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    const result = await sendSms(r.phone, body);
    if (result.sent) {
      sent++;
    } else {
      failed++;
    }
  }

  return { total: recipients.length, sent, failed };
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}
