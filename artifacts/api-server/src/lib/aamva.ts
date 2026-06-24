/**
 * Server-side AAMVA PDF417 barcode parser for US driver's licenses.
 * Mirrors artifacts/playon-mobile/lib/aamva.ts — keep in sync.
 */

export type AamvaData = {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: Date;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
};

type ParseResult =
  | { success: true; data: AamvaData }
  | { success: false; error: string };

function extractField(subfile: string, elementId: string): string | null {
  const regex = new RegExp(`${elementId}([^\n\r]*)`);
  const match = subfile.match(regex);
  return match ? match[1].trim() : null;
}

function parseAamvaDate(raw: string): Date | null {
  if (!raw || raw.length < 8) return null;
  const s = raw.trim();
  if (s.length === 8) {
    const mm = parseInt(s.substring(0, 2), 10);
    const dd = parseInt(s.substring(2, 4), 10);
    const yyyy = parseInt(s.substring(4, 8), 10);
    if (!isNaN(mm) && !isNaN(dd) && !isNaN(yyyy) && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return new Date(yyyy, mm - 1, dd);
    }
    const y2 = parseInt(s.substring(0, 4), 10);
    const m2 = parseInt(s.substring(4, 6), 10);
    const d2 = parseInt(s.substring(6, 8), 10);
    if (!isNaN(y2) && !isNaN(m2) && !isNaN(d2)) {
      return new Date(y2, m2 - 1, d2);
    }
  }
  return null;
}

export function parseAamvaBarcode(raw: string): ParseResult {
  if (!raw || typeof raw !== "string") {
    return { success: false, error: "Empty barcode data" };
  }
  const ansiIdx = raw.indexOf("ANSI ");
  if (ansiIdx === -1) {
    return { success: false, error: "Not a valid AAMVA barcode (missing ANSI header)" };
  }
  const subfile = raw.substring(ansiIdx);

  let firstName = extractField(subfile, "DAC") ?? extractField(subfile, "DCT");
  let lastName = extractField(subfile, "DCS");

  if (!firstName || !lastName) {
    const daa = extractField(subfile, "DAA");
    if (daa) {
      const commaParts = daa.split(",");
      if (commaParts.length >= 2) {
        lastName = commaParts[0].trim();
        const rest = commaParts[1].trim().split(" ");
        firstName = rest[0] ?? "";
      }
    }
  }

  if (!firstName || !lastName) {
    return { success: false, error: "Could not parse name from barcode" };
  }

  const dobRaw = extractField(subfile, "DBB");
  if (!dobRaw) return { success: false, error: "Could not parse date of birth from barcode" };
  const dateOfBirth = parseAamvaDate(dobRaw);
  if (!dateOfBirth) return { success: false, error: `Invalid date of birth format: ${dobRaw}` };

  const addressLine1 = extractField(subfile, "DAG");
  if (!addressLine1) return { success: false, error: "Could not parse address from barcode" };

  const city = extractField(subfile, "DAI");
  if (!city) return { success: false, error: "Could not parse city from barcode" };

  const state = extractField(subfile, "DAJ");
  if (!state) return { success: false, error: "Could not parse state from barcode" };

  const zipRaw = extractField(subfile, "DAK");
  if (!zipRaw) return { success: false, error: "Could not parse ZIP from barcode" };
  const zip = zipRaw.replace(/\D/g, "").substring(0, 5);

  const capitalize = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    success: true,
    data: {
      firstName: capitalize(firstName),
      lastName: capitalize(lastName),
      middleName: extractField(subfile, "DAD") ? capitalize(extractField(subfile, "DAD")!) : undefined,
      dateOfBirth,
      addressLine1: capitalize(addressLine1),
      city: capitalize(city),
      state: state.toUpperCase().substring(0, 2),
      zip,
    },
  };
}

export function getAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const m = today.getMonth() - dateOfBirth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dateOfBirth.getDate())) age--;
  return age;
}

export function isAdult(dateOfBirth: Date): boolean {
  return getAge(dateOfBirth) >= 18;
}

export function isAtLeast13(dateOfBirth: Date): boolean {
  return getAge(dateOfBirth) >= 13;
}
