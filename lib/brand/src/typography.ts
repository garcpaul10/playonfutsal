export const fontFamilies = {
  sans: "Outfit",
  sansFallback: "'Outfit', sans-serif",
  mono: "Menlo, monospace",
  serif: "Georgia, serif",
} as const;

export const fontWeights = {
  regular: "400",
  medium: "500",
  semiBold: "600",
  bold: "700",
  extraBold: "800",
  black: "900",
} as const;

export const fontWeightsNumeric = {
  regular: 400,
  medium: 500,
  semiBold: 600,
  bold: 700,
  extraBold: 800,
  black: 900,
} as const;

export const fontSizes = {
  xs: 11,
  sm: 12,
  base: 14,
  md: 15,
  lg: 16,
  xl: 18,
  "2xl": 20,
  "3xl": 24,
  "4xl": 28,
  "5xl": 36,
  "6xl": 48,
  "7xl": 60,
  "8xl": 72,
} as const;

export const lineHeights = {
  tight: 1.15,
  snug: 1.3,
  normal: 1.5,
  relaxed: 1.65,
} as const;

export const letterSpacings = {
  tight: -0.5,
  normal: 0,
  wide: 0.5,
  wider: 1,
  widest: 2,
} as const;

export const nativeFontFamilies = {
  regular: "Outfit_400Regular",
  medium: "Outfit_500Medium",
  semiBold: "Outfit_600SemiBold",
  bold: "Outfit_700Bold",
} as const;
