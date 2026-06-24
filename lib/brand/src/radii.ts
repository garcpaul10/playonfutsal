export const radii = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 14,
  "2xl": 16,
  "3xl": 20,
  full: 9999,
} as const;

export const webRadii = {
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.625rem",
  "2xl": "0.75rem",
  "3xl": "1rem",
  full: "9999px",
} as const;

export type RadiusKey = keyof typeof radii;
