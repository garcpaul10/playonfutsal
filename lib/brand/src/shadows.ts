export const shadows = {
  none: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  xs: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 12,
  },
  crimsonglow: {
    shadowColor: "#dc2626",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

export const webShadows = {
  sm: "0px 2px 4px rgba(0,0,0,0.06)",
  md: "0px 4px 8px rgba(0,0,0,0.10)",
  lg: "0px 8px 16px rgba(0,0,0,0.14)",
  xl: "0px 16px 32px rgba(0,0,0,0.20)",
  card: "0 8px 32px rgba(0,0,0,0.6)",
  cardHover: "0 16px 48px rgba(0,0,0,0.8), 0 0 0 1px rgba(239,68,68,0.2)",
  crimsonglow: "0 0 30px rgba(220,38,38,0.4)",
  crimsonText: "0 0 60px rgba(239,68,68,0.6)",
} as const;
