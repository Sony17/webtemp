# OpenIdea Design Tokens

The source of truth for tokens is `src/app/globals.css` (CSS variables) consumed via
`tailwind.config.ts`. This file documents intent.

## Color

| Token        | Light            | Meaning                          |
| ------------ | ---------------- | -------------------------------- |
| primary      | `#2563EB`        | Brand blue, primary actions      |
| accent       | blue-100/700     | Subtle highlights, chips         |
| success      | green-500        | Delivered / paid states          |
| destructive  | red-500          | Errors, cancel, remove           |
| muted        | slate-100/500    | Secondary surfaces & text        |
| border       | slate-200        | Hairline separators              |

Neutral scale is slate-based grayscale. Dark mode is fully tokenized (`.dark`).

## Radius

`--radius: 0.75rem` → cards use `rounded-xl` (≈1rem), controls use `rounded-lg`.

## Elevation

- `shadow-soft` — resting cards
- `shadow-soft-lg` — hover / floating surfaces (sheets, popovers)

## Spacing & layout

Generous whitespace. Page gutters `px-4 sm:px-6`, content max-width `1280px`,
section vertical rhythm `space-y-8` / `py-8`.

## Motion

- `animate-fade-in` — content entrance
- `transition-all duration-200` — hover/press affordances
- `hover:-translate-y-0.5` + shadow lift on interactive cards

## Type

System sans (`var(--font-sans)` → Geist when available). Tight tracking on headings,
`text-balance` on hero copy.
