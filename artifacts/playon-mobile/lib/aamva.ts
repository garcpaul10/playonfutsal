/**
 * AAMVA PDF417 barcode parser for US driver's licenses.
 * Spec: AAMVA DL/ID Card Design Standard (DL/ID-2020)
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

/**
 * Extract a subfile element value by its 3-character element identifier.
 * Elements are separated by newlines or carriage returns.
 */
function extractField(subfile: string, elementId: string): string | null {
  const regex = new RegExp(`${elementId}([^\n\r]*)`);
  const match = subfile.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Parse an AAMVA date string (MMDDYYYY or YYYYMMDD) into a Date.
 */
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
    // Try YYYYMMDD
    const y2 = parseInt(s.substring(0, 4), 10);
    const m2 = parseInt(s.substring(4, 6), 10);
    const d2 = parseInt(s.substring(6, 8), 10);
    if (!isNaN(y2) && !isNaN(m2) && !isNaN(d2)) {
      return new Date(y2, m2 - 1, d2);
    }
  }
  return null;
}

/**
 * Parse a raw PDF417 barcode string from a US driver's license.
 * Returns structured AAMVA data or an error.
 */
export function parseAamvaBarcode(raw: string): ParseResult {
  if (!raw || typeof raw !== "string") {
    return { success: false, error: "Empty barcode data" };
  }

  // AAMVA barcodes start with "@" followed by "\n\rANSI " or similar
  // Find the DL subfile header
  const ansiIdx = raw.indexOf("ANSI ");
  if (ansiIdx === -1) {
    return { success: false, error: "Not a valid AAMVA barcode (missing ANSI header)" };
  }

  // Work with the subfile content (everything after the header line)
  const subfile = raw.substring(ansiIdx);

  // First name: DAC (given name) or DCT (name in full)
  let firstName = extractField(subfile, "DAC") ?? extractField(subfile, "DCT");
  // Last name: DCS (family name)
  let lastName = extractField(subfile, "DCS");

  // Some states encode full name in DAA as "LAST,FIRST MIDDLE"
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

  // Middle name: DAD
  const middleName = extractField(subfile, "DAD") ?? undefined;

  // Date of birth: DBB (MMDDYYYY)
  const dobRaw = extractField(subfile, "DBB");
  if (!dobRaw) {
    return { success: false, error: "Could not parse date of birth from barcode" };
  }
  const dateOfBirth = parseAamvaDate(dobRaw);
  if (!dateOfBirth) {
    return { success: false, error: `Invalid date of birth format: ${dobRaw}` };
  }

  // Address: DAG (street address)
  const addressLine1 = extractField(subfile, "DAG");
  if (!addressLine1) {
    return { success: false, error: "Could not parse address from barcode" };
  }

  // City: DAI
  const city = extractField(subfile, "DAI");
  if (!city) {
    return { success: false, error: "Could not parse city from barcode" };
  }

  // State: DAJ
  const state = extractField(subfile, "DAJ");
  if (!state) {
    return { success: false, error: "Could not parse state from barcode" };
  }

  // ZIP: DAK (may include zip+4, e.g. "404220000" or "40422-0000")
  const zipRaw = extractField(subfile, "DAK");
  if (!zipRaw) {
    return { success: false, error: "Could not parse ZIP from barcode" };
  }
  // Normalize: take first 5 digits
  const zip = zipRaw.replace(/\D/g, "").substring(0, 5);

  // Capitalize names properly (driver licenses often use all caps)
  const capitalize = (s: string) =>
    s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    success: true,
    data: {
      firstName: capitalize(firstName),
      lastName: capitalize(lastName),
      middleName: middleName ? capitalize(middleName) : undefined,
      dateOfBirth,
      addressLine1: capitalize(addressLine1),
      city: capitalize(city),
      state: state.toUpperCase().substring(0, 2),
      zip,
    },
  };
}

/**
 * Calculate age in years from a date of birth.
 */
export function getAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const m = today.getMonth() - dateOfBirth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Returns true if the given date of birth is 18 or older today.
 */
export function isAdult(dateOfBirth: Date): boolean {
  return getAge(dateOfBirth) >= 18;
}
