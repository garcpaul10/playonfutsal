export const AGE_GROUPS = [
  { value: "u8", label: "U8" },
  { value: "u9", label: "U9" },
  { value: "u10", label: "U10" },
  { value: "u11", label: "U11" },
  { value: "u12", label: "U12" },
  { value: "u13", label: "U13" },
  { value: "u14", label: "U14" },
  { value: "u15", label: "U15" },
  { value: "u16", label: "U16" },
  { value: "u17", label: "U17" },
  { value: "u18", label: "U18" },
  { value: "adult", label: "Adult" },
  { value: "all_ages", label: "All Ages" },
] as const;

export type AgeGroupValue = typeof AGE_GROUPS[number]["value"];
