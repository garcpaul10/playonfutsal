# PlayOn Brand Design System

`@workspace/brand` is the single source of truth for all visual design tokens used across PlayOn's web app, mobile app, and admin panel. Any value defined here propagates to all surfaces — import from this package instead of hardcoding hex values or numbers.

---

## Color Palette (`palette`)

### Crimson — Primary Brand Color
| Token | Hex | Usage |
|---|---|---|
| `crimson900` | `#3D0510` | Deep backgrounds, overlays |
| `crimson800` | `#5C0A1A` | Pressed states |
| `crimson700` | `#740D2A` | **Primary brand color** — buttons, active states, links |
| `crimson600` | `#921236` | Hover states |
| `crimson500` | `#B83D5A` | Dark-mode tint |
| `crimsonAccent` | `#dc2626` | Hero CTAs, glows, price badges |
| `crimsonAccentLight` | `#ef4444` | Icon accents, inline highlights |
| `crimsonAccentDark` | `#b91c1c` | Button hover in dark/hero context |

### Ink — Dark Background Scale
Used for hero sections, dark cards, and deep UI backgrounds.
| Token | Hex | Usage |
|---|---|---|
| `inkDeepest` | `#050508` | Hero section background |
| `inkDeeper` | `#0a0a10` | Section backgrounds in dark pages |
| `inkDark` | `#111118` | Card backgrounds in dark context |
| `inkCard` | `#1a1a24` | Inner cards in dark context |

### Teal — Dark Neutral Scale
Drives the dark mode background and card system.
| Token | Hex | Usage |
|---|---|---|
| `teal900` | `#1E2829` | Dark mode page background |
| `teal800` | `#222E2E` | Dark mode card background |
| `teal700` | `#2A3838` | Muted/secondary surfaces |
| `teal600` | `#2E3D3D` | Accent surfaces in dark mode |
| `teal500` | `#323D3D` | Input backgrounds in dark mode |

### Neutral — Light Neutral Scale
| Token | Hex | Usage |
|---|---|---|
| `neutral50` | `#FAF9F9` | Light mode page background |
| `neutral100` | `#EAEAEA` | Light mode muted surfaces / dark mode text |
| `neutral200` | `#E0DADA` | Borders in light mode |
| `neutral500` | `#979D9D` | Muted text in dark mode |
| `neutral600` | `#585E5E` | Muted text in light mode |

### Semantic Status Colors
| Token | Hex | Usage |
|---|---|---|
| `success` | `#22C55E` | Upcoming/available status |
| `info` | `#3B82F6` | Active/informational status |
| `warning` | `#F59E0B` | Warning states |
| `error` | `#EF4444` | Error / cancelled states |

---

## Semantic Tokens (`semantic`)

### `semantic.light` — Light Mode
Maps raw palette values to UI roles for light-mode surfaces.

### `semantic.dark` — Dark Mode
Maps raw palette values to UI roles for dark-mode surfaces.

### `semantic.hero` — Hero / Deep Dark Context
Used for landing pages, hero sections, and promotional screens with full ink backgrounds.

---

## Typography (`fontFamilies`, `fontSizes`, `fontWeights`, `nativeFontFamilies`)

- **Primary font:** Outfit (all weights 400–900)
- **Usage:** headings use weight 700–900, body uses 400–600
- Native font family strings: `nativeFontFamilies.regular` → `"Outfit_400Regular"`, etc.
- Web CSS: `font-family: 'Outfit', sans-serif` (already loaded via Google Fonts in index.css)

### Font Size Scale (px)
`xs(11) · sm(12) · base(14) · md(15) · lg(16) · xl(18) · 2xl(20) · 3xl(24) · 4xl(28) · 5xl(36) · 6xl(48) · 7xl(60) · 8xl(72)`

---

## Spacing (`spacing`)

4px grid system. Key values:
`0 · 0.5(2px) · 1(4px) · 2(8px) · 3(12px) · 4(16px) · 6(24px) · 8(32px) · 12(48px) · 16(64px) · 24(96px)`

---

## Border Radii (`radii`, `webRadii`)

| Token | Native px | Web rem |
|---|---|---|
| `xs` | 4 | 0.25rem |
| `sm` | 6 | 0.375rem |
| `md` | 8 | 0.5rem (default) |
| `lg` | 12 | 0.75rem |
| `xl` | 14 | — |
| `2xl` | 16 | 1rem |
| `3xl` | 20 | — |
| `full` | 9999 | 9999px |

---

## Shadows (`shadows`, `webShadows`)

Native shadow objects follow the React Native `shadow*` + `elevation` pattern.
Web shadow strings are CSS `box-shadow` values.

Notable entries:
- `shadows.crimsonglow` — red glow for primary action buttons on mobile
- `webShadows.card` / `webShadows.cardHover` — dark card elevation pattern
- `webShadows.crimsonglow` — `box-shadow` for hero CTA buttons

---

## Platform Integration

### Web (Tailwind v4 / CSS Variables)
The web app's `index.css` defines `@theme inline` and CSS custom properties that map 1-to-1 to brand tokens:
- `--primary` (HSL) → `semantic.light.primary` → `#740D2A`
- `--background` → `semantic.light.background` → `#FAF9F9`
- Extra `--brand-*` properties are defined for hero/ink colors not in the shadcn token system.

Import for inline styles or logic: `import { palette, semantic } from "@workspace/brand"`

### Mobile (React Native / Expo)
`artifacts/playon-mobile/constants/colors.ts` re-exports from `@workspace/brand`. Components consume tokens via the `useColors()` hook — no direct hex strings in component files.

### Admin Panel
Uses the same web Tailwind + CSS variable system. The primary crimson token (`--primary`) and background/foreground tokens apply throughout automatically. Hero-pattern backgrounds use the `semantic.hero` tokens via inline styles where needed.

---

## Adding New Tokens

1. Add the value to the appropriate file in `lib/brand/src/`
2. Export it from `lib/brand/src/index.ts`
3. Update `BRAND.md` with the new token name, value, and intended usage
4. On web: add a CSS variable to `index.css` if it should be part of the Tailwind theme
5. On mobile: reference via `useColors()` or direct import
