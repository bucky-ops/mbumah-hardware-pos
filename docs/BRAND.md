# Mbumah Hardware — Brand System (BRAND.md)

> Version: v2.18.2 · Owner: Mbumah Hardware · Source artwork: `public/logo.svg`
> Reference card: `/mnt/data/Mbumah_Store_Card.jpeg` (official store card)

## 1. Identity

**Mbumah Hardware** — "YOUR BUILDING PARTNER IN JUJA"

The mark is a **navy gear** (industrial precision) carrying an **orange house**
(building materials) with a **silver trowel** (craftsmanship, orange handle)
flanked by **two vertical rebar pillars** (reinforcement, strength).

## 2. Color Palette

| Token | Hex | Usage |
|---|---|---|
| `navy` | `#12243D` | Gear, wordmark, primary brand navy |
| `navy-3d` | `#1a2a4a → #0F1E33` gradient | 3D depth on gear/wordmark |
| `navy-deep` | `#0F1E33` | Bottom category bar, dark chrome |
| `console-navy` | `#0f172a` | Console header / dark surfaces |
| `orange` | `#FF8C00` | House, accents, CTAs, alerts |
| `orange-soft` | `#C68A3D` | Tagline gold-orange |
| `steel` | `#C0C7D1` (gradient `#E8ECF2 → #9AA3B2`) | Trowel blade, rebar |
| Semantic (console) | emerald `#10b981`, blue `#3b82f6`, red `#ef4444`, amber `#f59e0b`, slate `#64748b` | KPI states, health, alerts |

## 3. Assets

| File | Size | Use |
|---|---|---|
| `public/logo.svg` | vector, 512 viewBox | Full card logo (master) |
| `public/logo.png` | 512×512 PNG | Print, social, OG images |
| `public/logo.webp` | 200×200 WebP | Console 200px render |
| `src/app/icon.svg` | mark-only | Header 48×48, tab icon |
| `src/app/favicon.ico` | 32×32 ICO | Browser favicon |

Header usage: `<img src="/logo.webp">` inside a **white `rounded-xl`** tile on
the dark `#0f172a` header; 48×48 in the top bar.

## 4. Typography

- Console/UI: **Inter** (`ui-sans-serif` stack), 16px base grid.
- Wordmark: extra-bold, +2 tracking; HARDWARE: bold, +11 tracking, orange.
- No serif anywhere; numbers use tabular figures in tables.

## 5. Taglines & Copy

- Tagline: **YOUR BUILDING PARTNER IN JUJA**
- Promise strip: **QUALITY PRODUCTS • EXPERT SERVICE • STRONGER BUILDINGS • BETTER FUTURE**
- Categories bar: Tools · Hardware · Paints · Plumbing · Electrical · Building Materials

## 6. Contacts

- Phone: **0795 191 909** / **0759 963 601** (WhatsApp)
- Email: **mbumahhardware@gmail.com**
- Location: **Juja Town** (flagship: Juja Main)

## 7. Rules

1. Never recolor the gear; navy stays `#12243D`, orange stays `#FF8C00`.
2. Minimum logo size: 32px (mark) / 120px (full card).
3. White rounded tile (`rounded-xl`, `p-1.5`) when logo sits on dark chrome.
4. No drop shadows on the mark; gradients only from the provided ramps.
5. Domain expert modules use semantic colors (§2) — never brand navy for
   danger states (debt/overdue = red family).
