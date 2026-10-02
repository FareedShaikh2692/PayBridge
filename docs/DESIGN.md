# PayBridge — Design System

> **Educational Sandbox — No Real Money Movement.**

The interface is a restrained B2B fintech product: one deep navy for calls to action and active states, cool neutrals, and status colours that always travel with an icon and a label. Light theme only; a dark theme is not built.

## Tokens

Defined once as CSS variables in [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) and mapped to Tailwind in [`tailwind.config.ts`](../apps/web/tailwind.config.ts). Components never use raw colour values.

| Group | Tokens |
|---|---|
| Surfaces | `--background`, `--card`, `--muted`, `--border` |
| Text | `--foreground`, `--muted-foreground`, `--faint` |
| Brand | `--primary`, `--primary-hover`, `--primary-soft`, `--primary-foreground`, `--navy-900/800/700`, `--info` |
| Status | `--success`, `--warning`, `--error` and their `-soft` backgrounds |
| Charts | `--chart-1`, `--signal` |
| Shape and depth | `--radius-sm/md/lg/xl` (6/8/12/16px), `--shadow-sm/md/lg` |

Typography is Inter with tabular numerals for every amount (`.num`). Spacing follows the 4px scale (4, 8, 12, 16, 24, 32, 48, 64, 80, 96). Content sits in one container (max 1240px). Motion is 150–300ms and is disabled for `prefers-reduced-motion`.

## Components

All in [`apps/web/src/components/ui.tsx`](../apps/web/src/components/ui.tsx): `Button` (primary, secondary, ghost, destructive, link; loading and disabled states), `Badge`, `StatusBadge`, `Card`, `Container`, `Section`, `Input`, `Select`, `Field`, `Modal`, `Tooltip`, `Stat`/`StatCard`, `DataTable`, `Timeline`, `EmptyState`, `ErrorState`, `Skeleton`, `SkeletonRows`, `Spinner`, `PageLoader`, `Alert`, `ToastProvider`/`useToast`, `Pagination`, `Rows`, `Money`. `QueryState` gives every data view its loading (skeleton), error (with retry), empty and loaded states.

Brand: [`brand.tsx`](../apps/web/src/components/brand.tsx) — an SVG mark of two spans over a deck (a bridge between two places), legible from 16px, plus the wordmark. Icons are Lucide throughout. Charts ([`charts.tsx`](../apps/web/src/components/charts.tsx)) are a single-series line with a crosshair tooltip and a table view, and a status donut whose legend repeats each status as icon, label and count.

## Pages

- `/` — landing: sticky navbar, hero with an animated payment flow, why it exists, how it works, feature grid, interactive payment lifecycle, dashboard preview, security, call to action, footer.
- `/docs`, `/legal` — documentation and plain-language legal notes.
- `/login`, `/register` — split layout continuing the landing page; default, focus, loading, error, success and disabled states; one-click demo accounts.
- Application — sidebar shell with permission-aware navigation, and the screens listed in the README.

## Checks

`apps/web/e2e/design.spec.ts` verifies in a real browser: no console errors, no horizontal overflow at 390px and 820px, navigation and calls to action, the sign-in states, an API error state with retry, and no serious or critical WCAG A/AA violations (axe) on the landing page, sign-in and dashboard. `node e2e/shots.mjs` captures screenshots for visual review.
