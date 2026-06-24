export function friendlyDenialReason(msg: string): string {
  const m = (msg ?? "").toLowerCase();
  if (m.includes("already")) return "Already checked in";
  if (m.includes("not currently active") || m.includes("not currently active"))
    return "Check-in window is not open for this event";
  if (
    m.includes("not registered") ||
    m.includes("no registration") ||
    m.includes("not found") ||
    m.includes("not on roster")
  ) return "Not registered for this session";
  if (m.includes("unpaid") || m.includes("payment") || m.includes("balance"))
    return `Payment outstanding — ${msg}`;
  if (m.includes("qr") || m.includes("code not") || m.includes("unrecognized") || m.includes("invalid"))
    return "QR code not recognised";
  return msg || "Check-in denied";
}

export function friendlyTimingReason(windowStart?: string | null): string {
  if (!windowStart) return "Check-in is not open yet";
  try {
    const d = new Date(windowStart);
    const h = d.getHours();
    const min = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    const mm = min.toString().padStart(2, "0");
    return `Check-in opens at ${h12}:${mm} ${ampm} (30 min before start)`;
  } catch {
    return "Check-in is not open yet";
  }
}
