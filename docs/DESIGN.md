# PayBridge — Design System

> **Educational Sandbox — No Real Money Movement.**

The interface is a restrained B2B fintech product: a mostly neutral palette (slate text on white and `#F8FAFC`), one blue (`#2563EB`) for calls to action and active states, deep navy (`#0B1220`) for brand surfaces, and status colours that always travel with an icon and a label. Light theme only; a dark theme is not built.

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

Brand: [`brand.tsx`](../apps/web/src/components/brand.tsx) — an SVG mark of a P whose bowl continues as a bridge span into a currency-flow dot (optionally animated), used in the navbar, sign-in, app shell, favicon, loading state and video watermark. Icons are Lucide throughout. Charts ([`charts.tsx`](../apps/web/src/components/charts.tsx)) are a single-series line with a crosshair tooltip and a table view, and a status donut whose legend repeats each status as icon, label and count.

## Pages

- `/` — landing, told as a scroll story: hero with an animated demo payment (PB-2026-000421, AED 10,000 → INR 225,865) and a product video, the problem, the seven-stage flow, an interactive payment demo (lifecycle plus compliance, ledger, webhook and reconciliation tabs), FX quote, compliance, ledger with idempotency, webhooks, settlement, reconciliation, architecture, expandable engineering principles and a call to action. All demo values are fixed, fictional and labelled DEMO.
- Payment visuals shared by the app and the landing page live in [`payment-visuals.tsx`](../apps/web/src/components/payment-visuals.tsx): `Lifecycle` (horizontal, vertical on phones), `Checklist`, `LedgerTotals`, `WebhookPipeline`, `ReconciliationCompare`.
- Product video: `apps/web/public/demo/` (WebM, MP4, poster, WebVTT captions), recorded from the real local sandbox with `node e2e/record-demo.mjs <dir>` and encoded with ffmpeg.
- `/docs`, `/legal` — documentation and plain-language legal notes.
- `/login`, `/register` — split layout continuing the landing page; remember me, forgot-password guidance (no email in the sandbox), default, focus, loading, error, success and disabled states; one-click demo accounts.
- Application — sidebar shell with permission-aware navigation, live sandbox environment status and, on phones, a bottom navigation bar; dashboard with trend stats; searchable, sortable payments table with sticky headers and copyable IDs; payment detail with lifecycle, compliance checklist and ledger totals; webhook event stream; reconciliation comparison; settings.

## Checks

`apps/web/e2e/design.spec.ts` verifies in a real browser: no console errors, no horizontal overflow at 390px and 820px, navigation and calls to action, the sign-in states, an API error state with retry, and no serious or critical WCAG A/AA violations (axe) on the landing page, sign-in and dashboard. `node e2e/shots.mjs` captures screenshots for visual review.
