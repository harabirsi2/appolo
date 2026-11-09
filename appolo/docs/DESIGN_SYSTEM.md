# Appolo design system

This documents the design language actually implemented in `apps/web/app/globals.css`,
`packages/ui`, and the components under `apps/web/components`. It is not an
aspirational style guide.

## 1. Direction

Editorial, dark-first media journal: near-black canvas, restrained mint accent, large
artwork, strong numeric/positional typography, thin hairlines instead of stacked cards.
The accent is used for action and ranking emphasis, never as a page-wide gradient.

Avoided deliberately: purple/blue gradients, glassmorphism everywhere, identical
feature-card grids, emoji as interface icons, random decorative blobs.

## 2. Colour tokens (Tailwind 4 `@theme`)

| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#000000` | Page canvas |
| `--color-surface` | `#101012` | Base surface |
| `--color-surface-2` | `#17171a` | Raised controls |
| `--color-elevated` | `#1c1c21` | Menus/sheets |
| `--color-border` | `#242428` | Default hairline |
| `--color-border-strong` | `#3a3a41` | Hover/emphasis |
| `--color-ink` | `#f6f6f7` | Primary text |
| `--color-muted` | `#a1a1aa` | Secondary text |
| `--color-muted-2` | `#6f6f78` | Metadata |
| `--color-brand` | `#4ade80` | Primary action / match |
| `--color-brand-strong` | `#22c55e` | Hover/pressed |
| `--color-brand-soft` | `#86efac` | Soft emphasis |
| `--color-success` | `#22c55e` | Positive |
| `--color-warn` | `#f59e0b` | Caution |
| `--color-danger` | `#ef4444` | Error/clash |
| `--color-gold` / `silver` / `bronze` | `#f5c451` / `#c9ccd6` / `#d08a5a` | Podium positions |

Body background adds one fixed radial mint wash from the top (`rgba(74,222,128,0.075)`)
so the page does not read as flat black. Selection uses a 38% brand mix.

## 3. Typography

- Family: `--font-sans` = system UI stack (ui-sans-serif, system-ui, Segoe UI, Roboto,
  Helvetica, Arial). No web font is loaded; there is currently no separate display face.
- Scale in use (px values from Tailwind arbitrary sizes):
  - Page title: `30px`, weight 800, tight tracking.
  - Section title: `17px`, weight 600.
  - Media/review title: `13–16px`, weight 500–600.
  - Body: `13–14px`.
  - Metadata: `10–12px`, muted, often uppercase with `0.14em` tracking.
  - Ranking numbers: large, weight 700–800, colour-coded by position.
- Numerals are rendered with the same family; score text uses tabular alignment where
  it appears in lists (`ScoreText`).

**Known gap:** the mandate asks for a deliberate display/body/mono pairing. The app
still uses a single system stack, so a real display face is roadmap work.

## 4. Spacing, radii, elevation

- Screen gutter: `px-5` (20px); rails use `scroll-padding-left: 1.25rem`.
- Vertical rhythm: sections `mt-6`, cards `p-2.5`–`p-4`, compact rows `gap-2`/`gap-3`.
- Radii: `rounded-lg` for form controls, `rounded-xl` for small cards, `rounded-2xl`
  for media/review cards, `rounded-full` for avatars, chips and the FAB.
- Borders are preferred to shadows: `border-white/[0.06]` cards, `border-white/10`
  controls, brand border for the active/featured state.
- Elevation tokens: `--shadow-card` (inset hairline + deep soft shadow) and
  `--shadow-float` for sheets/FAB. `shadow-xl`/`shadow-2xl` on the champion podium.

## 5. Components

| Component | File | Notes |
|---|---|---|
| Button/Input/Select/Textarea | `packages/ui/src/components.tsx` | Variants primary/secondary/ghost/danger; sizes sm/md/lg (32/40/44px) |
| MediaArt | `apps/web/components/media-art.tsx` | Deterministic hue fallback, kind icon, ANIME label, Elo WR badge on hover |
| KindIcon | `apps/web/components/kind-icon.tsx` | Seven line SVGs: movie, tv, music, podcast, book, game, anime sparkle |
| CompareCard | `apps/web/app/app/rate/[itemId]/finish-rating.tsx` | Head-to-head cards with VS marker |
| Podium / podium editor | `apps/web/components/podiums.tsx`, `podium-order-editor.tsx` | Gold/silver/bronze display, drag ordering |
| Profile screen | `apps/web/components/profile-screen.tsx` | Header, modes, pinned review, top five |
| Pod screens | `apps/web/components/pod-screen.tsx`, `pod-editor.tsx` | Collection cover grid and editing |
| Review engagement | `apps/web/components/review-engagement.tsx` | Reactions and comments |
| SpoilerText | `apps/web/components/spoiler-text.tsx` | Hidden until revealed |
| BottomNav | `apps/web/components/bottom-nav.tsx` | Five destinations + glowing centre FAB |
| EmptyState | `packages/ui` | Title/body/action, used across screens |
| Skeletons | `.skeleton` utility + `app/loading.tsx` | Shimmer placeholder |

## 6. Motion

- Entry: `.animate-rise` — 360ms, `cubic-bezier(0.22, 0.7, 0.3, 1)`, translateY(10px) + fade.
- Hover: `.card-hover` — 180ms border/background/translateY(-1px).
- Category pills: Framer Motion `layoutId` for the active indicator; horizontal rails
  with masked edges.
- FAB: mint pulse/glow ring; opens "Quick duel / manual rating".
- Reduced motion is **not** yet wired to a `prefers-reduced-motion` guard; the
  CSS animations are short, but this is an open accessibility item.

## 7. Layout and breakpoints

- Mobile-first; default screen container is single column with a `pb-24` allowance for
  the fixed bottom navigation and `safe-bottom` for the home indicator.
- Rails are horizontal scroll with snap (`snap-rail`) and hidden scrollbars
  (`.no-scrollbar`).
- Grids: 2-up for posters on phones (`grid-cols-2`), 3-up for compact score stats,
  denser grids appear from `sm`/`md` where used.
- Desktop: the same components widen; there is no separate desktop navigation shell
  yet — the mandate expects one.
- Touch targets: form controls are 40–44px; the new tie/undecided buttons are
  `min-h-11` (44px). The FAB and nav icons meet the 44px target.

**Open responsive checks:** 320px, 375px, 390px, 430px, tablet and desktop were not
systematically captured in this pass. The layout is `overflow-x` safe by construction
(rails scroll internally), but this is not a substitute for measuring.

## 8. Iconography

All media kinds use `KindIcon` line SVGs, not emoji. Interface icons in `podiums.tsx`
are inline SVG paths. Emoji remain only as **reactions** on reviews, where they are
content rather than chrome.

## 9. Honest gaps

- No display typeface; no token for numeric type beyond size/weight conventions.
- No light theme.
- No reduced-motion mode.
- No formal breakpoint tokens; Tailwind defaults are used directly.
- Desktop navigation shell and share-card art direction are not designed yet.
