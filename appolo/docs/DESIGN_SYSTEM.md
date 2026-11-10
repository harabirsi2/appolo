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

Deliberate pairing:

- **Display:** Fraunces (variable Google font, loaded through `next/font` with a metric
  fallback) for the wordmark, page titles and the landing masthead. Applied by a base
  `h1` rule and the `.font-display` utility. The serif carries the editorial, journal
  identity; it is never used for body copy or controls.
- **Body/UI:** `--font-sans` system stack (ui-sans-serif, system-ui, Segoe UI, Roboto,
  Helvetica, Arial). No Inter dependency; the app renders instantly with native UI text.
- **Numerics:** `.num` sets tabular, lining figures with tight tracking; used by
  `ScoreText`. Ranking positions keep the sans face at heavy weight so they read as data,
  not headlines.
- Logo: lowercase `appolo` with a mint dot, set in Fraunces on the app home (mobile) and
  in the desktop sidebar. The landing page uses `appolo.` with a mint period.

Scale in use (px values from Tailwind arbitrary sizes):
  - Page title: `30px`, weight 800, tight tracking.
  - Section title: `17px`, weight 600.
  - Media/review title: `13–16px`, weight 500–600.
  - Body: `13–14px`.
  - Metadata: `10–12px`, muted, often uppercase with `0.14em` tracking.
  - Ranking numbers: large, weight 700–800, colour-coded by position.
- Numerals use tabular alignment where they appear in lists (`ScoreText`, ranking
  rows); `.num` is the single token for this.
- Base `h1` sets `line-height: 1.05`, `letter-spacing: -0.02em` and optical sizing; page
  components may still override size/weight for hierarchy.

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
- Reduced motion **is** wired: a global `prefers-reduced-motion: reduce` guard collapses
  animations/transitions to 0.01ms and disables smooth scrolling. Motion is CSS-only
  (no Framer Motion runtime), so the guard covers every animation in the app.
- Focus: `:focus-visible` draws a 2px mint outline with a 2px offset on all interactive
  elements, independent of hover styling.

## 7. Layout and breakpoints

- Mobile-first; default screen container is single column with a `pb-24` allowance for
  the fixed bottom navigation and `safe-bottom` for the home indicator.
- Rails are horizontal scroll with snap (`snap-rail`) and hidden scrollbars
  (`.no-scrollbar`).
- Grids: 2-up for posters on phones (`grid-cols-2`), 3-up for compact score stats,
  denser grids appear from `sm`/`md` where used.
- Desktop (`lg`, ≥1024px): a 232px sticky sidebar replaces the bottom navigation.
  It contains the serif wordmark, primary destinations (Home, Browse, Search, Rankings,
  Taste, You), the primary Rate action and Settings. Content is capped at 768px inside a
  1000px container. The bottom nav is `lg:hidden`; the home header wordmark is
  `lg:hidden` so it is not duplicated.
- Touch targets: form controls are 40–44px; nav tabs, the notification button, the avatar
  link and tie/undecided controls are 44px (`min-h-11`/`h-11`).

Landing page (marketing surface): a left-aligned editorial hero with a hairline media
rail (real kind icons, no emoji), then an asymmetric 6/6 split for the three product
pillars — one lead essay in display type, two stacked entries with hairline dividers.
The old three-equal-card and ✓-list pattern is gone.

**Responsive audit (this pass):** measured 320, 390, 768 and 1280px in a real browser.
`documentElement.scrollWidth - clientWidth` was `0` at every width; the sidebar appears
only at 1280 and the bottom nav hides there. Screenshots: `appolo-df-home-serif.png`
(512px), `appolo-df-rankings-320.png` (320px), `appolo-df-desktop-1280.png` (1280px).
Landing: `appolo-landing-512.png`, `appolo-landing-1280.png`.
The 430px case is covered by the same single-column rules as 390/512.

## 8. Iconography

All media kinds use `KindIcon` line SVGs, not emoji. Interface icons in `podiums.tsx`
are inline SVG paths. Emoji remain only as **reactions** on reviews, where they are
content rather than chrome.

## 9. Honest gaps

- Poster grids remain two-up on desktop; a wider editorial grid is not implemented.
- No light theme (deliberate for now; the identity is dark-first).
- Reduced-motion is respected, but there are no bespoke low-motion transitions beyond
  removing animation.
- Visual regression is manual screenshots; there is no automated screenshot suite.
- No light theme.
- No reduced-motion mode.
- No formal breakpoint tokens; Tailwind defaults are used directly.
- Desktop navigation shell and share-card art direction are not designed yet.
