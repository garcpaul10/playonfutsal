import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

const EASTERN = "America/New_York";

export function toEasternISOString(localDatetimeString: string): string {
  if (!localDatetimeString) return localDatetimeString;
  return fromZonedTime(localDatetimeString, EASTERN).toISOString();
}

export function toEasternLocalString(utcIsoString: string): string {
  if (!utcIsoString) return utcIsoString;
  return formatInTimeZone(new Date(utcIsoString), EASTERN, "yyyy-MM-dd'T'HH:mm");
}

export function formatEastern(date: Date | string | number, formatStr: string): string {
  if (!date) return "";
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return formatInTimeZone(d, EASTERN, formatStr);
}
