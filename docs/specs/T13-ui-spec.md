> **Provenance.** Versioned copy of a Phase 1 durable specification: UI specification (T13). Promoted from `.salvaops-agent-evidence/T13-ui-spec/ui-spec.md` (git-ignored, no remote backup before this copy) by WU-P1-B-authority-docs on 2026-10-01, base commit `b6dc5b1` (Roadmap 7.4.4, audit AUD-025).
>
> - Source sha256: `a3e883d393df0e4a47071359dea2b291842548e1691e8f6f745f5e91ac93c13b`
> - Source size: 72015 bytes
> - Everything below the marker line is byte-for-byte identical to the source. Verify with `tail -c 72015 <this file> | sha256sum`, which must print the source sha256.
> - Authority: derived specification under the Master and ADR-001 (cited by ADR-001 Amendment 1 and by code as SEC-nnn). A change needs a new version, not an in-place edit. Platform facts that changed afterwards (hosting, scheduler, client IP) are in ADR-002.

<!-- BEGIN VERBATIM SOURCE -->
# RUNIIS WEB V1 -- UI Spec (T13-ui-spec)

Labels: [given]=stated verbatim in Master Section181-191/Section228 or ADR-001/Amendment1; [resolved]=this agent fixed an axis the Master left open, using the given tokens/rules as constraint; [assumed]=no source states it, flagged, non-material unless noted. Basis: Master Sections 36,53,57-58,85,113-114,181-191,228-230; ADR-001 Decisions.13, Amendment1 A9; UX spec T12 (IA, journeys J1-J13, state inventory, open questions OQ-1..5). No product UI exists (app/ has only a bootstrap page plus /api/health, no components/ui, no Tailwind/shadcn installed, no components.json) -- every layout below is new construction, not a refresh. visual_inspection: not_run -- nothing rendered to capture; agent-browser/Playwright not invoked for that reason (not a tool failure).

Update note: this spec was drafted, then the orchestrator flagged that T12-ux-spec was finalized (335 lines, all open questions resolved). Re-read in full before finalizing; three changes carried through below: (1) pass replacement is staff-only in V1 -- ParticipantPassView never shows a self-service replace action, only a support-contact message; the admin pass detail view carries "Reemplazar codigo"; (2) Guardian verification at the scanner is a specific dialog (guardian name/relationship read-only, verification_method select, optional notes, Verificar/Rechazar, automatic check-in retry on Verificar); (3) the S178 error/outcome catalogue and RBAC matrix (ADMIN GLOBAL vs ADMIN EDITION-scoped vs OPERATOR vs CHECKIN vs MODERATOR) are now confirmed and used for FormField/Error, Alert/Callout and admin-shell nav-gating specs below.

## 1. Direction (frontend-design plan, reviewed against brief)

Subject: a Mexican running-events platform -- discover a race, register self plus friends plus guests plus minors, get a QR pass, get scanned race day, see verified km/ranking. Audience: runners (mobile-first, often mid-planning on a phone) and a small ops/staff team (desktop dense tables, race-day tablets/phones outdoors). Job of the UI: read as timing-and-results software, not a generic events SaaS template.

Color (from the given base only, no new hues invented for surfaces): paper #F6F7F3 (page), ink #0B0D0E (text/primary surfaces), signal lime #D7FF3F (accent -- never text on paper, verified below), divider #D6DBDE, control #7C878D. Neutrals and semantics are derived from these four, not from a generic gray ramp.

Type: Archivo Narrow (condensed, editorial, reads like a results board or bib number) for display/H1/H2 and every large number (countdown, price, km, ranking position) -- big numbers are the hero content of a race site, not decoration. Inter for everything read at length (body, forms, tables, admin).

Layout: left-aligned, grid-driven, editorial column rhythm (Master grid Section185, not a floating card-kit). Borders-before-shadows (Master Section187) -- flat bordered blocks like a results sheet; shadows are reserved for true overlays (modal/drawer/toast). Numbers get tabular alignment so lists of times/distances/rankings read like a results table even outside a literal table element.

Principle -- the one bold move: Archivo Narrow condensed numerals set in ink on paper, with signal lime reserved exclusively for things that are live, actionable or yours -- an open registration CTA's focus ring, a countdown accent bar, "your rank" highlight, the scanner's VALID state, the Runline underline. Lime never fills large areas and never carries text on light surfaces, matching the brand's own name for it (a signal, not a wash). Everything else stays quiet -- ink/paper/neutrals, no gradients, no soft SaaS card shadows, no stock-photo hero unless it is a real race photo.

Self-check against the skill's known-cliche list: no cream-plus-terracotta (palette is fixed and is not terracotta); no all-caps labels as decoration (StatusBadge/labels use sentence case; "RUNIIS" itself is a literal proper-noun wordmark, not a styled label); no numbered 01/02/03 markers except the Stepper and the route Agenda, both of which are real sequences; no identical-rounded-card-kit (radii are role-differentiated -- control 12, card 16, panel 20, overlay 24 -- not one radius everywhere); no single-word-bolded headline tell; motion is one deliberate moment per surface, never scattered hover/entrance animation on every card.

## 2. Tokens

### 2.1 Color -- primitives

| token | value | role |
|---|---|---|
| color-paper | #F6F7F3 | page canvas |
| color-paper-raised | #FFFFFF | cards/panels above the canvas |
| color-paper-sunken | #ECEEE8 | input fields, sunken wells, table stripe |
| color-ink | #0B0D0E | primary text, primary dark surfaces |
| color-ink-80 | #3A4145 | secondary text |
| color-ink-60 | #62696D | muted text/icon (captions, metadata) |
| color-ink-35 | #9AA1A4 | disabled text/icon only (exempt from contrast, never used on enabled content) |
| color-divider | #D6DBDE | 1px dividers/rules [given, Master Section187] |
| color-control | #7C878D | 1px control/input borders [given, Master Section187] |
| color-lime | #D7FF3F | signal accent [given, Master Section181] -- fills/underlines/rings only, never text on light surfaces |
| color-lime-deep | #4B6B12 | text-safe derivative of lime [resolved] -- links, "verified" ticks, selected-state text/border where AA text contrast is required |
| color-lime-soft | #EEFAC2 | lime tint background for subtle highlight chips, paired with ink text only |

### 2.2 Color -- semantic tokens plus contrast table (WCAG 2.2 AA, relative-luminance formula, script in contrast.log)

Semantic base tokens: color-success #1B7A43 / color-success-tint #E3F6EA / color-success-border #8FCFA9. color-warning #92600B / color-warning-tint #FDF0DC / color-warning-border #E7B65E. color-danger #B3261E / color-danger-tint #FBEAEA / color-danger-border #E39992. color-info #205493 / color-info-tint #E8F0FB / color-info-border #9DC2ED.

| pair | ratio | AA needed | pass |
|---|---|---|---|
| ink / paper (body text) | 18.10 | 4.5 | yes |
| paper / ink (inverse text) | 18.10 | 4.5 | yes |
| ink / white | 19.48 | 4.5 | yes |
| ink-80 / paper | 9.65 | 4.5 | yes |
| ink-80 / white | 10.39 | 4.5 | yes |
| ink-60 / paper | 5.19 | 4.5 | yes |
| ink-60 / white | 5.58 | 4.5 | yes |
| ink-35 / paper (disabled) | 2.44 | n/a | exempt -- disabled content only |
| lime / paper | 1.07 | 4.5 | FAIL -- lime is never text on paper or white |
| lime / white | 1.15 | 4.5 | FAIL -- same rule |
| ink / lime (ink text on lime fill) | 16.94 | 4.5 | yes -- this is how lime carries text |
| lime / ink (lime text/icon on ink fill) | 16.94 | 4.5 | yes -- scanner VALID state, dark-surface accents |
| control #7C878D / paper | 3.42 | 3.0 (UI component) | yes |
| control / paper-sunken | 3.15 | 3.0 | yes |
| control / white | 3.68 | 3.0 | yes |
| lime-deep / paper | 5.72 | 4.5 | yes |
| lime-deep / white | 6.16 | 4.5 | yes |
| lime-deep / lime-soft | 5.60 | 4.5 | yes |
| ink / lime-soft | 17.71 | 4.5 | yes |
| success / paper | 4.99 | 4.5 | yes |
| success / success-tint | 4.76 | 4.5 | yes |
| warning / paper | 5.00 | 4.5 | yes |
| warning / warning-tint | 4.79 | 4.5 | yes |
| danger / paper | 6.07 | 4.5 | yes |
| danger / danger-tint | 5.62 | 4.5 | yes |
| info / paper | 7.09 | 4.5 | yes |
| info / info-tint | 6.65 | 4.5 | yes |
| ink / any tint (success/warning/danger/info) | 16.75 to 17.32 | 4.5 | yes -- heading/value text on a tinted card |
| success/warning/danger/info -border tokens / paper | 1.67 to 2.11 | 3.0 | FAIL as a standalone signal -- these soft borders are decorative only; status is always carried by icon plus text (mandatory per Master Section183/190 regardless), never by the border alone. Where a border alone must be identifiable (a selected filter chip outline), use the full-strength semantic color or ink/lime-deep, never the -border tint. |

Binding rule for salvaops-frontend: lime is a fill/ring/stroke color only. Any text, icon-only-button glyph, or link rendered directly on paper/white/paper-sunken must never be color-lime; use ink, ink-80, or lime-deep instead.

Domain-to-semantic mapping [resolved -- Master names the states, not the colors]:
AVAILABLE -> success. LOW -> warning. TEMPORARILY_UNAVAILABLE -> info, explicitly not danger (UX copy rule 2: never say "Agotado" for a hold-only block). SOLD_OUT -> danger ("Agotado"). CLOSED / NOT_OPEN / FINISHED -> neutral (ink-60 text, paper-sunken chip, no semantic color -- not failures). CANCELED -> danger. POSTPONED -> warning. Pending registration request ("apartado") -> warning-toned chip with a clock icon; copy never says "pagado" or "confirmado" (UX copy rule 1). Scanner outcomes use their own mapping (Section 3.6) because full-screen legibility needs stronger fills than a small badge.

No dark theme (Master Section181 "No dark mode global V1"). ink-surface sections (footer, scanner full-screen states, an optional hero overlay band) are a deliberate high-signal accent, not a theme -- they always pair with paper/lime text per the ink/lime and lime/ink rows above, and are never toggled by a user preference.

### 2.3 Typography tokens [given values, Tailwind mapping resolved]

Families: font-display = "Archivo Narrow" (weight 700 used); font-body = "Inter" (weights 400/600/650/700 used). Loaded via next/font (ADR Decisions.13), font-display swap, latin subset, variable font file where available to respect the fonts budget (<=140KB, Master Section191).

| role | family | mobile size/lh/weight | desktop size/lh | fluid clamp | notes |
|---|---|---|---|---|---|
| display-xl | Archivo Narrow | 48/46 700 | 80/76 | clamp(48px,6vw,80px) | hero only |
| h1 | Archivo Narrow | 40/42 700 | 56/58 | clamp(40px,4.5vw,56px) | |
| h2 | Archivo Narrow | 32/36 700 | 44/48 | clamp(32px,3.5vw,44px) | |
| h3 | Inter | 26/32 700 | 32/38 | none (body is not fluid) | |
| h4 | Inter | 22/28 650 | 24/30 | none | |
| body-lg | Inter | 18/28 400 | same | none | |
| body | Inter | 16/24 400 | same | none | |
| body-sm | Inter | 14/20 400 | same | none | |
| label | Inter | 14/18 600 | same | none | sentence case, never all-caps |
| caption | Inter | 12/16 400 | same | none | metadata; use ink-60 (5.19:1, passes AA) |
| button | Inter | 15/20 600 | same | none | |
| display-num [resolved] | Archivo Narrow 700 | context-sized, matches the h1/h2/h3/h4 scale at its placement | same scale | inherits the parent clamp if any | every large number: countdown, price, km/distance, ranking position, podium rank, stat tiles -- always paired with tabular-nums |

Tabular numerals [given, Section182]: font-variant-numeric: tabular-nums (Tailwind class tabular-nums) on prices, km/distances, rankings, dates/times and dashboard metrics whenever it aids legibility -- operationalized as: any number inside StatusBadge, CountdownStatus, RankingRow, Podium, AdminTaskItem age column, DataTable numeric columns, and every price display. Never applied to running body prose.

### 2.4 Spacing [given, Section186]

Base unit 4. Scale: 0=0, 1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48, 16=64, 20=80, 24=96, 32=128.
Aliases: control-inline=8, control-stack=12, field-stack=16, field-group=24, card-mobile=16, card-desktop=24, section-mobile=48, section-desktop=80, page-top-mobile=24, page-top-desktop=48.

### 2.5 Radii, borders, shadow [given, Section187]

Radii: xs=6, sm=10, control=12, card=16, panel=20, overlay=24, hero=28, full=999.
Borders before shadows: the default component boundary is a 1px color-divider or color-control border, not a shadow. selected=2px border, color=ink by default, color=lime-deep for a brand-signal selected state such as an active filter chip -- never raw lime, which is a fill/ring role, not a border-carrying-meaning role at small stroke widths either (same AA reasoning).
Shadows -- used only for true overlay elevation (Modal, Drawer, Toast, dropdown/menu, sticky-CTA lift), never for flat cards: shadow-sm 0 1px 2px rgba(11,13,14,.06) (sticky bar lift); shadow-md 0 8px 24px rgba(11,13,14,.10) (dropdown/menu); shadow-lg 0 20px 56px rgba(11,13,14,.16) (modal/drawer).

### 2.6 Motion [given durations, easing curves resolved -- Master gives ms only, not curves]

Durations: 70ms micro-response (checkbox tick, button press); 110ms fast-state (hover fill, focus ring appear); 150ms control transition (select open, tab switch); 240ms panel/card (drawer slide, modal scale-in, accordion expand); 400ms major transition, exceptional (route stepper step change, closure progress sequence steps).
Easing [assumed, standard curves, non-material]: ease-standard = cubic-bezier(.2,0,0,1) (decelerate -- entrances, expansions, focus ring); ease-exit = cubic-bezier(.4,0,1,1) (accelerate -- exits, collapses, dismiss).
Rules [given]: respect prefers-reduced-motion: reduce (see the per-component fallback in Section 3); no infinite ornamental motion; motion never delays state comprehension -- a StatusBadge/ScannerFeedback state is legible at frame 0, animation is a polish layer on top, never a gate; Scanner feedback is instant (icon/text/color render on the same frame the outcome is known; only a background pulse may animate after, purely decorative, never delaying the text).

### 2.7 Breakpoints, grid, containers [given, Section185]

Breakpoints: base 0-479, sm 480-767, md 768-1023, lg 1024-1279, xl 1280-1439, 2xl >=1440.
Public grid: base 4 cols / margin16 / gutter12. sm 4 cols / margin24 / gutter16. md 8 cols / margin32 / gutter20. lg 12 cols / margin40 / gutter24. xl 12 cols / max1280 / gutter24 (2xl inherits xl's 12/1280/24, page centers with extra outer margin).
Containers: container-public max1280. container-reading max760 (FAQ, legal, article-style content). container-registration max1040 (builder, review). container-modal-form max640. container-admin fluid, recommended max1600.

### 2.8 Focus ring [resolved -- Master Section187 "Focus no se comunica solo con sombra"]

outline: 2px solid var(--ring); outline-offset: 2px -- drawn with the CSS outline property, never box-shadow-only, so it is always a crisp ring unaffected by the component's own border-radius or overflow, and stacks correctly over any fill.
--ring = color-ink on any light-canvas context (paper, white, paper-sunken, any tint background -- the outline sits on the page canvas around the control, so the ink/paper 18.10 ratio governs regardless of the control's own fill, including a lime-filled button). --ring = color-lime inside an ink-surface context (scanner full-screen states, footer) -- lime/ink is 16.94, the highest-contrast pair available there. Both exceed the 3:1 non-text/focus-indicator minimum by a wide margin. Never rely on a hover/active color shift alone as the focus signal.

### 2.9 Z-index layers [assumed -- standard stacking scale, non-material, no Master value exists]

base=0, sticky-header=10, sticky-cta=20 (mobile bottom bar, event page), dropdown=30, drawer=40 (filter bottom sheet, admin mobile nav), modal-backdrop=50 / modal=51, toast=60, tooltip=70, scanner-feedback=80 (full-screen takeover, above everything in the scanner shell), skip-link=100 (keyboard-only, visually hidden until focused).

### 2.10 Tailwind v4 @theme block (paste target for salvaops-frontend, app/globals.css)

```css
@import "tailwindcss";

@theme {
  /* color primitives */
  --color-paper: #F6F7F3;
  --color-paper-raised: #FFFFFF;
  --color-paper-sunken: #ECEEE8;
  --color-ink: #0B0D0E;
  --color-ink-80: #3A4145;
  --color-ink-60: #62696D;
  --color-ink-35: #9AA1A4;
  --color-divider: #D6DBDE;
  --color-control: #7C878D;
  --color-lime: #D7FF3F;
  --color-lime-deep: #4B6B12;
  --color-lime-soft: #EEFAC2;

  /* semantic */
  --color-success: #1B7A43;
  --color-success-tint: #E3F6EA;
  --color-success-border: #8FCFA9;
  --color-warning: #92600B;
  --color-warning-tint: #FDF0DC;
  --color-warning-border: #E7B65E;
  --color-danger: #B3261E;
  --color-danger-tint: #FBEAEA;
  --color-danger-border: #E39992;
  --color-info: #205493;
  --color-info-tint: #E8F0FB;
  --color-info-border: #9DC2ED;

  /* focus */
  --color-ring-light: var(--color-ink);
  --color-ring-dark: var(--color-lime);

  /* type */
  --font-display: "Archivo Narrow", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter", ui-sans-serif, system-ui, sans-serif;
  --text-display-xl: clamp(3rem, 6vw, 5rem);
  --text-display-xl--line-height: 0.95;
  --text-h1: clamp(2.5rem, 4.5vw, 3.5rem);
  --text-h1--line-height: 1.05;
  --text-h2: clamp(2rem, 3.5vw, 2.75rem);
  --text-h2--line-height: 1.1;
  --text-h3: 1.625rem;
  --text-h3--line-height: 1.23;
  --text-h4: 1.375rem;
  --text-h4--line-height: 1.27;
  --text-body-lg: 1.125rem;
  --text-body-lg--line-height: 1.56;
  --text-body: 1rem;
  --text-body--line-height: 1.5;
  --text-body-sm: 0.875rem;
  --text-body-sm--line-height: 1.43;
  --text-label: 0.875rem;
  --text-label--line-height: 1.29;
  --text-caption: 0.75rem;
  --text-caption--line-height: 1.33;
  --text-button: 0.9375rem;
  --text-button--line-height: 1.33;

  /* spacing (base 4) */
  --spacing-0: 0px;
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
  --spacing-10: 40px;
  --spacing-12: 48px;
  --spacing-16: 64px;
  --spacing-20: 80px;
  --spacing-24: 96px;
  --spacing-32: 128px;

  /* radii */
  --radius-xs: 6px;
  --radius-sm: 10px;
  --radius-control: 12px;
  --radius-card: 16px;
  --radius-panel: 20px;
  --radius-overlay: 24px;
  --radius-hero: 28px;
  --radius-full: 999px;

  /* shadow (overlay elevation only) */
  --shadow-sm: 0 1px 2px rgba(11,13,14,.06);
  --shadow-md: 0 8px 24px rgba(11,13,14,.10);
  --shadow-lg: 0 20px 56px rgba(11,13,14,.16);

  /* motion */
  --ease-standard: cubic-bezier(.2,0,0,1);
  --ease-exit: cubic-bezier(.4,0,1,1);
  --duration-micro: 70ms;
  --duration-fast: 110ms;
  --duration-control: 150ms;
  --duration-panel: 240ms;
  --duration-major: 400ms;

  /* breakpoints (Tailwind v4 default `sm/md/lg/xl/2xl` names reused with Master's own pixel values) */
  --breakpoint-sm: 480px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
  --breakpoint-2xl: 1440px;

  /* containers */
  --container-public: 1280px;
  --container-reading: 760px;
  --container-registration: 1040px;
  --container-modal-form: 640px;
}

@layer base {
  :root {
    color-scheme: light only; /* Master Section181: no dark mode global V1 */
  }
  body {
    background-color: var(--color-paper);
    color: var(--color-ink);
    font-family: var(--font-body);
  }
  :focus-visible {
    outline: 2px solid var(--color-ring-light);
    outline-offset: 2px;
  }
  .surface-ink :focus-visible {
    outline-color: var(--color-ring-dark);
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      transition-duration: 0.001ms !important;
    }
  }
}
```

### 2.11 shadcn/Radix variable mapping [resolved -- no components.json exists yet; this is what salvaops-frontend maps on init]

The stack is decided (ADR Decisions.13: shadcn/Radix primitives restyled to tokens) but shadcn has not been initialized (no components.json in the repo). On init, alias shadcn's expected CSS variables to the Foundations tokens above rather than accepting shadcn's own default theme -- shadcn is a source of accessible Radix-based primitives here, never a visual system of its own:

```css
@layer base {
  :root {
    --background: var(--color-paper);
    --foreground: var(--color-ink);
    --card: var(--color-paper-raised);
    --card-foreground: var(--color-ink);
    --popover: var(--color-paper-raised);
    --popover-foreground: var(--color-ink);
    --primary: var(--color-ink);
    --primary-foreground: var(--color-paper);
    --secondary: var(--color-paper-sunken);
    --secondary-foreground: var(--color-ink);
    --muted: var(--color-paper-sunken);
    --muted-foreground: var(--color-ink-60);
    --accent: var(--color-lime);
    --accent-foreground: var(--color-ink);
    --destructive: var(--color-danger);
    --destructive-foreground: var(--color-paper);
    --border: var(--color-divider);
    --input: var(--color-control);
    --ring: var(--color-ring-light);
    --radius: 0.75rem; /* radius-control, shadcn's own scale maps to radius-control by default; override per component to card/panel/overlay as specified in Section 3 */
  }
}
```

Do not use shadcn's default `slate`/`zinc` base-color palette or its default radius scale; every shadcn component pulled in must be restyled to the table above at import time, per ADR Decisions.13. `components.json` style: "new-york" (sharper, borders-first, closest starting point to Section 1's direction) with `cssVariables: true`, `baseColor` irrelevant once the above overrides are applied.

## 3. Components (Master Section228 inventory, resolution order: project system -> shadcn registry -> JIT resource -> new-from-tokens)

Resolution note: no project design system exists yet (this is the first spec); components.json does not exist, so shadcn is not yet initialized -- (b) below is a build instruction for salvaops-frontend, not evidence of a component already present. No JIT visual resource is required anywhere in this inventory (see Section 7); every component resolves to (b) shadcn/Radix restyled or (d) new-from-tokens. MapLibre and qrcode are already architectural dependencies (ADR Decisions.13, package.json), not new JIT additions.

Shared interactive-state recipe (applies to every control below unless a component overrides it in its own row): default = 1px divider/control border, paper/paper-raised fill, ink text. hover = border darkens to ink-60, no shadow. focus-visible = the Section 2.8 outline ring, always, regardless of mouse hover state. active/pressed = fill shifts to paper-sunken (light controls) or 8% darker (filled controls), 70ms micro-response. loading = content replaced by a Skeleton shimmer or an inline spinner (button keeps its width, label replaced by a spinner, aria-busy true, never a layout shift). disabled = ink-35 text/icon, divider border, paper-sunken fill, cursor not-allowed, exempt from contrast (Section 2.2). error = border becomes danger, an inline message appears below via FormField/Error, aria-invalid true, aria-describedby pointing at the message. success = border becomes success briefly (110ms) then settles, or a persistent success check icon for saved-state fields. Touch target: effective hit area at least 44x44px (Master Section189) even when the visible control is smaller (e.g. a 24px icon button gets 10px of invisible padding); dense admin table row actions may use 32px visible controls but must still resolve a 44px hit target via padding, never a bare 32px tap target.

### 3.1 Standard base components

| component | anatomy | variants | sizes | states beyond the shared recipe | a11y |
|---|---|---|---|---|---|
| Button | label, optional leading/trailing Lucide icon 20px | primary ink fill paper text, secondary paper-raised fill ink border, ghost no fill ink text, danger fill paper text | sm 36 md 44 lg 52 | loading replaces label with a spinner same width | role button, icon-only Button requires aria-label |
| IconButton | single Lucide icon 20-24px | ghost default, filled ink fill paper icon | 36/44/52 hit area | | mandatory aria-label |
| TextField | label input helper error text optional leading icon | text email tel number password never used | 44 default 36 dense | success check icon for async validated fields | label always visible, error linked via aria-describedby |
| Select | trigger plus listbox | native single-select, searchable variant for long lists | 44 trigger | open state uses dropdown z-layer shadow-md radius-control | Radix Select semantics, role listbox |
| Checkbox | 20x20 box radius-xs label | single, indeterminate | 20 box inside 44 hit target | checked fill ink with paper check glyph never lime | role checkbox, indeterminate via aria-checked mixed |
| Radio | 20x20 circle | single-select group | 20 inside 44 hit target | selected ink ring plus ink center dot | role radiogroup radio, arrow-key nav |
| DateInput | text input dd/mm/aaaa plus calendar IconButton | date only, no time-only variant | 44 h | invalid format shows error inline never silent reformat | native date input fallback, visible mask Spanish dd/mm/aaaa |
| SearchInput | leading search icon input trailing clear IconButton | people search, event library search, admin table search | 44 h | loading spinner replaces leading icon while query in flight | role searchbox, results count announced live |
| FormFieldError | label control slot helper text error text | | | reserved fixed-height helper slot, never shifts layout on error | error id referenced by control aria-describedby |
| AlertCallout | icon title body optional action link | info success warning danger per Section2.2 triad | inline and dismissible toast-adjacent | dismissible variant has close IconButton | role alert for danger/warning, role status for info |
| Tabs | tab list, active-tab Runline underline 2px signal sliding 150ms, panel | Ranking Weekly Monthly Historical, Event Page level anchors desktop | 44 h tab hit target | reduced-motion underline jumps instead of sliding | Radix Tabs, selected state also conveyed by aria-selected plus text-weight change |
| Stepper | numbered step, connecting Runline track 4px neutral incomplete signal-strong complete rounded caps | Registration builder five steps: Participantes, Modalidad y kit, Legal, Revision, Resultado | | current step is a display-num number in an ink circle, completed is a check glyph | each step reachable by keyboard in visual order, aria-current step on active one |
| Modal | backdrop rgba ink 40 percent, panel radius-overlay shadow-lg container-modal-form for forms, title body actions | confirm-dialog Reopen bulk NO_SHOW DQ disposition guardian verification replace-credential always states the consequence and affected count or name first | | 240ms scale plus fade in, ease-exit out, reduced-motion opacity only | focus trapped inside, moves to first field or title on open, returns to trigger on close |
| Drawer | slide-in panel, bottom sheet mobile below lg, side sheet desktop | filter bottom sheet, admin mobile nav | full width mobile, 360 desktop side sheet | 240ms slide, reduced-motion fade only | same focus-trap rules as Modal, explicit close IconButton always exists |
| Toast | icon message optional action auto-dismiss | success error info per Section2.2 | | enters from top mobile so it never covers the sticky bottom CTA, bottom-right desktop, 5s auto-dismiss pauses on hover, error toast never auto-dismisses | role status for success info, role alert for error |
| Pagination | prev next IconButton, page indicator display-num tabular or cursor Cargar mas | offset pagination public library, cursor based admin large tables | 44 controls | disabled prev on page one, disabled next at end | current page announced |
| EmptyState | single Lucide icon 40 to 48px ink-60, title, one line body, optional CTA | the nine distinct S56 variants plus per-screen empties | | never shares copy across variants | icon hidden from screen reader, heading is a real heading level |
| Skeleton | shimmer block matching the real content shape | card skeleton, row skeleton, text-line skeleton | | shimmer sweeps paper-sunken to paper 1.2s loop, reduced-motion static fill no sweep | one live announcement not per block |
| Avatar | circular image or initials fallback, optional status ring | 512x512 canonical source rendered 24 32 40 64 96 | | pending review is a dashed warning ring, suspended is a desaturated overlay with a lock glyph | alt is the runner display name |
| ProfileHeader | Avatar, display name, achievement badge strip, primary stat line | own profile with edit action versus public profile, no PRIVATE selector | | | name is an h1 on the public profile page |
| FriendAction | button swapping label and state per Friendship state | Agregar amigo, then Solicitud enviada disabled, then Aceptar Rechazar pair for incoming, then Amigos with remove on hover | 36 inline row | loading spinner replaces label during the request | state change announced live on the row |
| RegistrationParticipantCard | name and avatar, kind badge, modality plus category plus kit selects, per row acceptance status, conflict reason | self, Friend, Guest, minor under guardian, each shows only fields relevant to that kind | | disabled row shows the reason inline, not removed from the list | disabled reason is programmatically associated not just a tooltip |
| KitStatus | icon plus text plus color chip | ASSIGNED info, READY info, DELIVERED success, CANCELED neutral, EXCEPTION danger | | | never color only |
| AttendanceStatus | icon plus text plus color chip | PRESENT success, PENDING warning, NO SHOW neutral, EXCLUDED danger, plus a second independent chip for eligibility never merged | | | two chips side by side each naming its own axis |
| FileUpload | dropzone dashed control border radius-card, file type and size hint, progress bar, preview summary | avatar image upload, GPX route import | | error names the exact rejection reason inline, never a generic failure message | dropzone is a real file input operable by keyboard |

### 3.2 StatusBadge

Anatomy: Lucide icon 16 to 20px, label text, semantic color triad (text, tint background, border), radius-full pill, label type role. Never color alone, Master Section183/190/228 and UX copy rules 1-2.

| domain state | icon | color | label |
|---|---|---|---|
| AVAILABLE | circle-check | success | Disponible |
| LOW | triangle-alert | warning | Pocos lugares |
| TEMPORARILY_UNAVAILABLE | clock | info | Temporalmente no disponible |
| SOLD_OUT | ban | danger | Agotado |
| CLOSED or NOT_OPEN or FINISHED | minus-circle | neutral, ink-60 text paper-sunken bg control border | Inscripciones cerradas, Proximamente, or Evento realizado |
| CANCELED | x-circle | danger | Cancelado |
| POSTPONED | calendar-clock | warning | Aplazado |
| Registration pending, apartado | clock | warning | Apartado |
| Registration confirmed | circle-check | success | Confirmado |
| RankingPeriod OPEN | radio, static under reduced motion | info | Proyeccion en vivo |
| RankingPeriod CONSOLIDATING | loader-circle, static icon, spin is decorative only never the sole signal | warning | En consolidacion |
| RankingPeriod CLOSED | shield-check | success | Resultado oficial |

States beyond the base pill: none interactive, StatusBadge is read-only, no hover focus active, unless used as a filter chip in FilterBar, in which case it adopts the Checkbox-like selected treatment, 2px lime-deep border when selected per Section 2.5, plus aria-pressed.

### 3.3 CountdownStatus

Anatomy: display-num time remaining, Archivo Narrow tabular-nums, format HH:MM:SS or Dd HH:MM beyond 24 hours, a small label above reading Tiempo restante, a lime 2px Runline accent bar beneath the number while live, never beneath an expired countdown. Computed client side every second from a server-provided expires_at, never from local status per UX F1 and J1 step 9, and re-derives on every mount or visibility change so a backgrounded tab never shows stale time. At now greater than or equal to expires_at it swaps instantly to a static Expirada state, Alert-danger tone, no more ticking, the Runline accent disappears, without waiting for a server round trip. Reduced motion: the numbers still update since they are informational not decorative, but any pulsing or blinking emphasis in the final minute is removed and replaced by a static warning tint on the last 5 minutes. Also used for the OTP resend cooldown, smaller size at body scale rather than display-num, no Runline accent since that accent is reserved for the registration hold.

### 3.4 ParticipantPassView and QRCodeView

ParticipantPassView anatomy: event name and date at top in h4, holder name, kind badge per Section 3.5, registration_number in small display-num, public_code as always-visible text in Inter with tabular letter spacing rather than a monospace face, a Ver codigo QR Button, and only in the staff admin pass-detail context a Reemplazar codigo Button, danger-toned, confirm required. The end-user view never shows a replace action anywhere. Pass replacement is staff-only in V1 per the finalized UX spec J3 step 3 and ADR A3. The end-user copy is exactly: Crees que alguien mas vio tu codigo? Contacta a soporte, with a support link, no button.

QRCodeView opens from Ver codigo QR as a Modal sized to container-modal-form. Loading state is a radius-card skeleton square while the server performs the private decrypt and render, never a cached client image per ADR A1 through A3, private no-store. Rendered state shows the QR image centered with public_code repeated as text directly beneath it, both in the same accessible region, so it remains usable when the QR cannot be scanned, printed, or displayed. Error state, render failed, shows an inline Alert-danger inside the modal reading No pudimos generar tu codigo. Intenta de nuevo, with a retry button; public_code text stays visible regardless since it does not depend on the QR render call. Every open of this modal is a fresh request, no already-loaded shortcut across sessions or devices.

### 3.5 Kind badge, PROFILE versus GUEST

A small label-scale pill, neutral ink-80 text on paper-sunken fill, no icon needed since kind is a category not a status: Cuenta for PROFILE versus Invitado for GUEST. Rendered identically in RegistrationParticipantCard, the Review step, ParticipantPassView where it reads tuyo or de <nombre>, a tu cargo, and the admin Participants DataTable name column. Never merged into StatusBadge semantic-color system since kind is not a status.

### 3.6 ScannerFeedback (all 11 outcomes, S85, verbatim enum)

Full-screen takeover, z-layer scanner-feedback, fills the whole viewport including the safe area on mobile. Anatomy: large Lucide icon at 64px (larger than the 28 to 32px important-status size in Section183 because this is the single most important legibility moment in the product, seen outdoors), a display-num-scale or h2-scale short text label, a full-bleed background fill in the semantic tone at roughly 12 percent tint over paper for warning and info so the icon and text (rendered in the full-strength semantic color, not just the tint) remain the primary carriers of meaning, never a saturated full-bleed fill that could wash out legibility in sunlight. Renders on the same frame the outcome is known, 0ms entrance for the icon and text; a background tint may fade in over 110ms after, purely decorative. Auto-clears back to the scan-ready state after a fixed dwell time appropriate to the outcome, informational outcomes like ALREADY_CHECKED_IN clear faster than outcomes requiring the operator to route someone to the manual desk.

| outcome | icon | color | label |
|---|---|---|---|
| VALID | circle-check | success | Acceso valido |
| ALREADY_CHECKED_IN | info | info | Ya registrado |
| REVOKED_CREDENTIAL | shield-x | danger | Codigo revocado |
| REPLACED_CREDENTIAL | shield-x | danger | Este codigo ya no es valido, se reemplazo |
| WRONG_EVENT | ban | danger | Este pase no es de este evento |
| REGISTRATION_NOT_CONFIRMED | triangle-alert | warning | Inscripcion no confirmada aun |
| GUARDIAN_VERIFICATION_REQUIRED | user-check | warning | Requiere verificar guardian |
| UNKNOWN_PASS | circle-help | danger | Codigo no reconocido |
| CANCELED_REGISTRATION | x-circle | danger | Inscripcion cancelada |
| NOT_YET_ALLOWED | clock | warning | Aun no es hora de ingreso |
| OTHER_REVIEW | flag | warning | Revisar manualmente |

GUARDIAN_VERIFICATION_REQUIRED opens the guardian verification dialog on top of the feedback screen per the finalized UX spec, form 10.7: guardian name and relationship_type shown read-only from the active GuardianAssignment, a verification_method Select, an optional notes TextField, and two actions, Verificar and Rechazar, sized for one-handed thumb reach at the bottom of the dialog on mobile. Verificar writes GuardianEventVerification VERIFIED and the check-in retries automatically, transitioning the same screen to the VALID outcome without a second scan. Rechazar writes REJECTED with the note as reason and the screen settles on a blocked state naming that the minor cannot check in without verification.

Additional scanner-shell states beyond the 11 outcomes, per the finalized UX spec state inventory: session-setup-incomplete blocks scanning entirely until Edition, station, and operation type are chosen, shown as a required three-field form before the camera view ever opens; offline or network-error shows a distinct sin conexion, reintenta state and never accepts an unverified scan as valid, the retry action is large and reachable one-handed.

Reduced motion: the 0ms icon and text entrance is unaffected since it is not decorative; only the optional background tint fade and any dwell-time pulsing are removed.

### 3.7 RankingRow and Podium

RankingRow: rank number in display-num (tabular-nums, so a column of ranks aligns), avatar 32px, display name, primary metric (km verified) in display-num tabular, a lime-deep left accent bar of 3px reserved for the current viewer's own row only, everyone else has no accent bar, this is the one place a signal color marks you specifically rather than a generic top position. Tie handling: equal ranks render the identical rank number on consecutive rows with a competition-ranking skip afterward, for example 1, 1, 3, never renumbered to 1, 2, 3; a thin lime-deep tick or shared rank badge groups the tied rows visually without implying a false distinction between them.

Podium: top-3 layout that must remain legible with more than 3 occupants when ties push extra people into rank 1 to 3, per the finalized UX spec AC-J6-2. Resolution: the podium keeps its editorial three-block visual shape at exactly three or fewer occupants, center-tallest layout, Archivo Narrow big rank numerals; the moment ties produce more than three occupants at ranks 1 to 3, the component switches to a single ranked list styled like RankingRow but with podium-scale type for just those tied rows, avoiding a broken or overlapping three-pedestal graphic. A CONSOLIDATING or OPEN period always shows the Alert-info banner Proyeccion, no resultado oficial above the podium; CLOSED periods show the immutable snapshot with names and avatars frozen at snapshot time, never the current profile (UX J6 step 3), with a small ink-60 caption stating the snapshot date.

### 3.8 AchievementBadge

Anatomy: a fixed-size icon tile, radius-card, Lucide icon at 28 to 32px per the important-status size band in Section183, name label beneath in label scale, ACTIVE achievements shown in full ink-on-paper-raised treatment with a lime-deep thin border, REVOKED achievements never render on a public profile at all per the finalized UX spec (no proactive notification, the profile simply reflects the state change) so there is no visible revoked variant on the public surface; the admin Community Admin surface, by contrast, needs a visible revoked-with-reason variant for reconciliation review, rendered desaturated with an ink-35 tile and a small history icon opening the revocation reason and audit trail.

### 3.9 AdminTaskItem

Anatomy: blocking_level marker (icon plus color, INFORMATION neutral, ACTION_REQUIRED warning, EVENT_DAY_BLOCKER danger with a small clock-race icon, CLOSURE_BLOCKER danger with a lock icon), title, Edition context link, assigned_role or staff avatar, status chip (OPEN, IN_PROGRESS, WAITING_EXTERNAL, RESOLVED, WAIVED), a Resolver action. Resolver never just flips the status client-side, per the finalized UX spec J12 step 5 and the anti-pattern list, so the button label is Revisar y resolver, opening the underlying real surface, for example the attendance workspace for an attendance-finalization task, rather than a bare checkbox; the task only shows RESOLVED after that underlying condition is actually satisfied, confirmed by a fresh recomputation. Filterable list container (FilterBar) by priority, blocking_level, Edition, category, status, assignee, matching the Task Center field list.

### 3.10 RouteMap and RouteEditorToolbar

RouteMap: MapLibre canvas, radius-card, restyled with a custom style layer so water, parks, and roads use the paper and ink-60 neutral palette rather than a default colorful basemap, route line in ink with a lime-deep casing for the active or selected route, POI markers as small Lucide-icon pins. Lazy-loaded per ADR Decisions.13 and never part of the initial public bundle. Fallback per the finalized UX spec OQ-5 resolution: when tiles fail to load, or as the default accessible text rendering, the map canvas area is replaced by a structured text block, distance, elevation if available, start and finish names, a POI list, and the venue address, styled as a simple bordered panel rather than a broken map placeholder, never a blank gray box.

RouteEditorToolbar: desktop and tablet first, matching the finalized UX spec J13 step 7 tool list verbatim, add vertex, move vertex, insert vertex, delete vertex, undo, redo, configure start, configure finish, POIs, calculate distance, warnings, errors, preview, laid out as an IconButton group with tooltips, grouped by function with dividers, a running computed_distance_m readout in display-num tabular next to the toolbar, and a persistent distinction between computed_distance_m, shown live, and official_distance_m, a separate explicit staff-set field never silently overwritten by the computed value, per the anti-pattern list. Mobile renders the map read-only with the toolbar hidden, per the finalized UX spec's mobile-limited editing rule. Warnings render as an inline warning Alert list, non-blocking; errors render as a danger Alert list and disable the publish action until resolved, matching the blocking-versus-non-blocking distinction in the finalized UX spec J13 step 9.

### 3.11 PublicationReadinessPanel

Anatomy: an explicit pass or fail checklist, never a single toggle, one row per condition with an icon, success check or danger cross, and the exact condition text. Two instances: Publication Readiness (valid Event and Edition, event_type, slug, timezone, city, a known date, at least one Modality, a main image or fallback, minimum description, coherent states) and Registration Readiness (Edition PUBLISHED, execution_state SCHEDULED, a valid schedule date, registration_open_at satisfied, registration_close_at in the future, at least one Modality ACTIVE, valid capacity, valid price or explicit FREE, eligibility rules, a required versioned form, an effective WhatsApp number if EXTERNAL_WHATSAPP, required legal documents published), both listed verbatim per the finalized UX spec J13 steps 1 to 2. The panel recomputes live rather than caching a stale pass state, and the Publish or Open Registration action stays disabled while any row fails, with the failing rows visually grouped above the passing ones so staff sees blockers first.

### 3.12 QuotaStatus

Anatomy: a compact stat block, provider name, current usage over limit as a display-num fraction, a thin horizontal progress bar using success under 70 percent, warning 70 to 90 percent, danger above 90 percent of quota, split by category, transactional P0 and P1 shown separately from marketing P3 so staff can see whether a large campaign would starve critical send capacity, matching the finalized UX spec J12 step 2 priority rule. Used in Communications Admin next to the campaign scheduler and, in read-only compact form, on the Dashboard's communications-health summary.

### 3.13 DataTable

Anatomy: header row with sortable columns where relevant, body rows, sticky header on scroll within container-admin, row-level actions in a trailing column. Column priority and responsive rule, per Master Section189, admin tables preserve important columns and adapt interaction rather than defaulting to horizontal scroll: below lg, each table declares a fixed priority order per instance, for example Participants keeps registration_number, name, and pass status visible and collapses modality, category, kit, and incidents into an expandable row detail opened by tapping the row; horizontal scroll is used only when the data is semantically tabular in a way that resists collapsing, for example a wide capacity matrix. Loading state is row-skeletons matching the real column widths. Empty state uses EmptyState inline within the table's body region, not a separate page. Bulk selection uses the indeterminate Checkbox in the header plus per-row Checkbox, and any bulk action opens the Modal confirm-dialog pattern from Section 3.1 naming the exact affected count. CSV export action is only rendered when the viewing role holds the specific export permission, per the finalized UX spec RBAC boundary, matching the server-side gate rather than only hiding the button.

### 3.14 FilterBar and FilterDrawer

Desktop at lg and above: FilterBar renders inline as a left sidebar, grid column span 3 of the 12-column lg grid, with the result grid taking the remaining 9 columns, resolving the finalized UX spec's open question on exact breakpoint. Below lg: filters live only inside FilterDrawer, a bottom sheet opened by a persistent Filtros Button showing an active-filter-count badge; applied filters also render as removable StatusBadge-style chips in a horizontal scroll row above the results so the current filter state is always visible without reopening the drawer. Filter state lives in the URL query string in both layouts, per the finalized UX spec Section2 IA rules, so back, forward, and shared links reproduce the same filtered view regardless of which layout rendered it. FilterDrawer's own action row has a fixed bottom bar with Limpiar filtros as a ghost Button and Ver resultados as a primary Button showing the live result count, both reachable without scrolling past the filter list on a small phone.

## 4. Page layouts (mobile-first, then md and lg)

Grid usage note applying to every page below: base and sm use the 4-column public grid, md the 8-column, lg and up the 12-column, per Section 2.7. Section vertical rhythm uses section-mobile 48px and section-desktop 80px between the major blocks listed per page. Page top padding uses page-top-mobile 24px and page-top-desktop 48px.

### 4.1 Home

Order is fixed per Master Section53 and the finalized UX spec J7 step 1, verbatim: hero, proximas carreras, acceso biblioteca, comunidad and podio, informacion RUNIIS, novedades when applicable, contacto, footer.

Mobile, base to sm: full-bleed hero image or a real race photo, hero aspect 4:3, display-xl headline over an ink gradient-free overlay for legibility, one primary Button. Proximas carreras is a single-column vertical stack of EventCard, 3 to 4 shown with a Ver todas link to /eventos. Acceso biblioteca is a compact secondary block, a search-forward entry point into /eventos rather than a duplicate list. Comunidad y podio shows the current Monthly StatusBadge state, top 3 to 5 RankingRow entries, and a link to /ranking. Informacion RUNIIS is a short editorial block, the wordmark treatment from Section 6 may appear here at a larger scale as a section mark. Novedades, when present, is a small card list. Contacto is a compact form or link block. Footer carries the legal links, contact, and a repeated small wordmark.

md: proximas carreras becomes a 2-column EventCard grid within the 8-column grid. Comunidad y podio becomes a 2-column layout, ranking list left, podium visual right.

lg and up: hero keeps a 16 9 crop at this width, proximas carreras becomes a 3-column EventCard grid across the 12-column grid, comunidad y podio keeps its 2-column split with more breathing room, section-desktop spacing applies throughout.

### 4.2 Eventos library

Mobile, base to sm: a header row with SearchInput and a Filtros Button showing an active-count badge, applied-filter chip row beneath when any are active, then a single-column stack of EventCard, Pagination or Cargar mas at the bottom. Filters only open in FilterDrawer, per Section 3.14. Past events render in a visually separated section below a divider with a small heading, never mixed into the upcoming list, per Master Section54.

md: EventCard grid becomes 2 columns within the 8-column grid, filters remain drawer-only below lg.

lg and up: FilterBar renders as the persistent left sidebar, grid column span 3, result grid spans the remaining 9 columns in a 2 to 3 column EventCard layout depending on card width, SearchInput moves to the top of the results column rather than a full-width header. Empty and error states per Section 3.1 EmptyState render centered within the results column at every breakpoint, never spanning under the sidebar.

### 4.3 Event page

Mobile, base to sm: Level 1 stacks vertically, hero image aspect 4 3 with the StatusBadge overlaid top-left, name in h1, date and location and modality and distance and price as a compact info list beneath, then the primary CTA as a full-width Button; once the user scrolls past the inline CTA, a sticky bottom bar at z-layer sticky-cta appears with shadow-sm, repeating the same CTA and price so it is always reachable one-thumb. Level 2 renders as sequential sections with h3 headers, logistica, agenda as a structured list matching the finalized UX spec authoritative agenda items, ruta as RouteMap with its text fallback, kit, categorias, puntos adicionales. Level 3 renders as an accordion, FAQ, documentos, sponsors as a logo strip, contacto.

md: Level 1 info list becomes a 2-column layout inside the content column, Level 2 sections keep single-column stacking but gain wider margins.

lg and up: two-column layout, main content column span 8 carrying Level 1 through Level 3 in document order, a sticky summary card in the remaining span 4 column, sticky beneath the site header at z-layer sticky-header plus a small offset, carrying price, availability StatusBadge, and the primary CTA, replacing the mobile bottom bar entirely at this width so the CTA is never duplicated on screen. DATE_CONFIRMED_TIME_PENDING renders the date normally with an inline warning-toned note that the time is pending, never a placeholder hour, at every breakpoint.

### 4.4 Ranking

Mobile: Tabs for Weekly, Monthly, Historical Live at the top, CONSOLIDATING or OPEN Alert-info banner beneath the tabs when applicable, Podium block, then a single-column RankingRow list with Pagination or Cargar mas.

md and lg: Podium and the RankingRow list sit side by side within the 8 or 12-column grid once the list is long enough to benefit, podium column span 4 to 5, list column span the remainder; below a length threshold the stacked mobile order is kept even at lg since a short list does not need the split.

### 4.5 Public profile

Mobile: ProfileHeader stacked, avatar above name above stat line, achievement-badge strip as a horizontal scroll row beneath, then ranking chips, monthly and historical, shown only when eligible, then a verified-history list.

md and lg: ProfileHeader becomes a horizontal row, avatar left, name and stats and achievement strip to the right, the history list gains a 2-column layout for longer histories.

### 4.6 Entrar

Centered container-modal-form at every breakpoint, no sidebar, no marketing content beside the form, the RUNIIS wordmark above the form per Section 6, then the Google button as the primary action, a divider labeled o, then the email field, request-code Button with cooldown countdown per CountdownStatus small variant, the code field appearing only after a code is requested, focus auto-moving to it. Legal links sit beneath the form in caption scale.

### 4.7 Onboarding

Centered container-registration at md and up, full-width with page-top-mobile padding on mobile. A lightweight Stepper-less single scrolling form is used rather than a multi-step Stepper, since the finalized UX spec onboarding sequence is one resumable form, not a named sequence of steps, fields in the verbatim order from form spec 10.2, minor-detection branching appears inline immediately under fecha de nacimiento once a birth date implies under 18, with the under-15 rejection rendered as a full-width Alert-danger block replacing the rest of the form rather than letting the person continue filling fields that cannot be saved.

### 4.8 Cuenta shell and key pages

Mobile, base to lg: a bottom-anchored simple nav is avoided in favor of a top Drawer-based account menu, opened from a persistent menu IconButton in the account header, since the account section is not deep enough to warrant permanent bottom-tab chrome and this keeps parity with the FilterDrawer pattern already established; the current page title shows in the header at all times.

lg and up: persistent left sidebar nav, column span 3, listing Resumen, Perfil, Amigos, Invitados, Menores, Solicitudes, Pases, Favoritos, Comunicaciones, content in the remaining span 9, container-reading width within that column for text-heavy pages like Comunicaciones preferences.

Cuenta overview: pending-request cards, each showing CountdownStatus, above confirmed-registration cards, each linking to its pass; EmptyState when the account has never registered for anything.

Cuenta pases: a list of ParticipantPassView summary rows, own passes first then guest passes each labeled with the guest name, tapping a row opens QRCodeView as a Modal per Section 3.4.

Cuenta solicitudes: the same pending and confirmed cards as the overview but as a complete filterable history rather than a recent-only summary, each row effective-expiry state computed client-side exactly as in Section 3.3.

### 4.9 Inscripcion builder

Container-registration width at every breakpoint, Stepper at the top per Section 3.1, five steps, Participantes, Modalidad y kit, Legal, Revision, Resultado. Mobile keeps the Stepper compact, numbers and a thin Runline track only, current step label shown as a heading beneath rather than beside the track to save width. Each RegistrationParticipantCard stacks full width on mobile; at md and up, the modality, category, and kit selects for a given participant arrange in a 3-column row within the card rather than stacking, since the card itself is already width-constrained by container-registration. The Legal step lists one row per participant with its acceptance status and, for FREE-mode unaccepted Friends, the Copiar enlace action from the finalized UX spec J1 step 4. Review is a read-only recap of every prior step with per-row edit-back links and the price-snapshot total in display-num at the bottom, Submit as a full-width Button on mobile, right-aligned standard-width Button at md and up. Resultado branches to either the instant FREE confirmation screen, passes listed immediately, or the EXTERNAL_WHATSAPP pending screen with CountdownStatus and the fixed-template WhatsApp Button, both replacing the Stepper entirely rather than showing it alongside a finished flow.

### 4.10 Admin shell and Dashboard

Isolated bundle per ADR Decisions.13, never loads the public-site chrome. Shell: persistent left sidebar at md and up, column width fixed around 240px rather than grid-column-based since container-admin is fluid, listing Dashboard, Tareas, Eventos, Solicitudes, Participantes, Kits, Asistencia, Cierre, Comunidad, Usuarios, Comunicaciones, Auditoria, Ajustes, with items hidden per the finalized UX spec RBAC matrix rather than shown-disabled, since a role that cannot see a surface should not see its label either; the underlying route itself still enforces the same gate server-side. Below md the sidebar collapses into Drawer, opened from a menu IconButton, matching the public FilterDrawer interaction pattern for consistency. Content area uses container-admin, fluid with a recommended max of 1600px, dense spacing, body-sm as the default table type size rather than body.

Dashboard: a responsive stat-tile row at the top, upcoming Editions count, pending requests count, occupancy percentage, pending attendance count, each in display-num, followed by a two-column layout at lg, Task Center preview list left, communications and incidents health right, collapsing to a single stacked column below lg. Each tile links through to its full surface rather than trying to be the source of truth itself, per Master Section228.

### 4.11 Edition editor

Tabbed sub-navigation within the editor rather than one long scrolling form, since the finalized UX spec J13 groups schedule, modalities, categories, forms, prices, capacities, WhatsApp, content, locations, agenda, and routes as independently editable areas: a secondary left rail of tabs at lg and up, column span 3 within container-admin, content in the remainder; below lg the same tabs render as a horizontal scrollable Tabs row at the top of the page. PublicationReadinessPanel and Registration Readiness Panel are pinned at the top of the editor above the tabs, always visible regardless of which tab is active, so staff never loses sight of what is blocking publish while editing a specific area. Route editor tab embeds RouteMap and RouteEditorToolbar per Section 3.10, desktop and tablet first, with the mobile-limited notice shown inline when opened on a narrow viewport rather than attempting the full toolbar.

### 4.12 Registration request queue

DataTable per Section 3.13 with the exact columns from the finalized UX spec J2 step 1, reference, buyer, participants, modalities, price snapshot, created_at, a dedicated expiracion efectiva column rendered with its own icon plus text treatment distinguishing it from the raw status column, status, actions. Actions column holds Confirmar and Cancelar as inline Button pairs rather than a hidden overflow menu, since these are the primary reason staff opens this table. Row expansion reveals the full participant list and any LEGAL_ACCEPTANCE_REQUIRED or PRICE_CHANGED or CAPACITY_UNAVAILABLE blocking reason inline rather than only on click-through.

### 4.13 Participants

DataTable with the responsive column-priority rule from Section 3.13 applied concretely: registration_number, name with its kind badge, and pass status stay visible below lg; modality, category, kit, check-in, final attendance, sporting eligibility, and incidents collapse into the row-detail expansion. Contact column, email and phone, renders only for roles holding the specific permission, matching the finalized UX spec RBAC boundary, and CSV export likewise. Search and filter bar sits above the table using FilterBar's inline desktop treatment even at admin widths, since admin users are not on the drawer-first mobile pattern by default.

### 4.14 Attendance workspace

Universe summary stat row at the top, PRESENT, PENDING, NO_SHOW, EXCLUDED counts in display-num, each clickable as a filter into the table below. DataTable rows carry AttendanceStatus and the separate SportingEligibility chip side by side per Section 3.1. Individual row actions open the relevant small Modal, manual PRESENT with reason and evidence, DQ disposition dialog per form spec 10.6. A persistent action bar above the table holds the bulk NO_SHOW action, disabled until at least one eligible row is selected, and Finalizar asistencia, disabled while any PENDING remains, with both blocking counts, PENDING attendance and PENDING eligibility, shown as inline text directly beside the disabled button rather than only in a tooltip, per the finalized UX spec AC-J5-1.

### 4.15 Scanner

Single full-viewport shell, no sidebar, no admin chrome, optimized for one-handed mobile use outdoors. A slim top bar shows the fixed Edition, station, and operation type context set at session start, plus a manual-lookup IconButton always reachable without leaving the scan view. The scan target area fills the remaining viewport, camera view when active. Every outcome replaces the entire viewport with ScannerFeedback per Section 3.6, full-bleed, and clears back to the scan-ready state automatically. The manual-lookup action opens as a Drawer sliding up from the bottom rather than a full navigation away from the scanner, keeping the session context bar visible above it.

## 5. Imagery, empty-state icons, Runline usage

### 5.1 Imagery rules

Aspect ratios, resolved since the Master gives budgets but not ratios: EventCard image 4 3, crops consistently across the card grid regardless of the source photo's own aspect. Event page hero 4 3 on mobile, 16 9 on desktop, object-fit cover, object-position defaults to center but editors may set a focal point per image so a runner's face or a finish-line banner is never cropped out by the wider desktop crop. Avatar 1 1, 512x512 WebP canonical per Master Section117, rendered at the sizes in Section 3.1. Only real race photography is used for hero and card images, never stock generic-runner photography and never an illustrated or AI-generated scene, since the brand direction in Section 1 depends on the photography reading as a specific, real event, not a generic template; until real photos exist for a given Edition, the fallback is the EmptyState icon-only treatment below, never a placeholder stock photo standing in as if it were real.

Performance budgets, given verbatim, Master Section191: hero mobile ideal 220KB hard 300KB, hero desktop ideal 400KB hard 500KB, EventCard mobile 80KB desktop 120KB, avatar target 40KB, above-fold mobile images 500KB total, fonts 140KB total. Next.js Image with the Cloudinary loader handles responsive sizing and format negotiation, admin bundle stays separate, MapLibre stays lazy, matching ADR Decisions.13 and Amendment1 A9's image-optimizer-limited-to-Cloudinary constraint.

### 5.2 Empty-state illustration policy

Per Master Section183, empty states use a single Lucide icon at 40 to 48px in ink-60, never a custom illustration, never a stock photo, never an emoji. This is a deliberate constraint, not just a budget saver, since inventing illustration style would mean designing brand artwork the owner has not approved, matching the PEND-BRAND-001 constraint on not inventing logo or illustration assets. Icon choice per empty-state variant, resolved: no upcoming events uses calendar-x, filtered no-results uses filter-x, search no-matches uses search-x, temporarily-unavailable uses clock, sold-out uses ban, registration-closed uses lock, canceled uses x-circle, postponed uses calendar-clock, no requests yet uses inbox, no passes yet uses ticket, no avatar yet uses user-round.

### 5.3 Runline usage rules

Given, Master Section184: 2px normal, 4px strong, rounded caps, signal or neutral color, used for active underline, stepper, progress, community editorial, and pass detail; never as a repeating ornamental background. Operationalized placements: Tabs active indicator, 2px signal, sliding. Stepper progress track, 4px, neutral for incomplete segments and signal-strong for completed segments, rounded caps at both ends of the whole track, not per segment. RankingRow current-viewer accent, 3px lime-deep left edge, a controlled exception in width and color to stay legible at that scale. ParticipantPassView, a 4px signal underline beneath the event name on the pass detail screen specifically, tying the pass back to the brand mark's own underline motif from Section 6. CountdownStatus, a 2px signal bar beneath the live time only, removed instantly at expiry. Never used as a table row divider, that role belongs to the 1px divider token; never used as a repeating stripe or texture anywhere; never used behind body text.

## 6. Wordmark, RUNIIS typographic treatment (PEND-BRAND-001, no invented logo artwork)

Text-only lockup, no symbol or mark is invented. RUNIIS set in Archivo Narrow 700, letter-spacing minus 0.01em, color ink on paper contexts and paper on ink-surface contexts, matching the ink slash paper text pairs already verified in Section 2.2. A single Runline device, 2px signal on the light lockup and 2px signal on the dark lockup as well since lime slash ink is the highest-contrast pair available there too, runs the full width of the wordmark directly beneath it, rounded caps, reading as a finish-line or track-line motif consistent with the Runline's own defined role. The double I in RUNIIS is not stylized or separated from the rest of the word, since inventing a distinct glyph treatment there would start to look like an invented logotype rather than a typographic lockup; the letterforms stay exactly as Archivo Narrow renders them. Header lockup height, 22 to 24px mobile, 26 to 28px desktop, matching its position beside the nav rather than competing with h1 scale. No icon, no favicon symbol is specified here; a favicon is a separate small asset decision left to the owner once real brand assets exist per PEND-BRAND-001, and salvaops-frontend should not invent one either.

## 7. Deviations and assumptions versus the UX spec

The finalized UX spec (335 lines, no pending forks) needed no functional contradiction, only visual-axis resolutions it explicitly left to this agent. Listed here per the brief's requirement, each non-material:

1. FilterBar desktop breakpoint, the UX spec flagged this as pending; resolved here as lg, 1024px, sidebar at lg and up, drawer-only below it, Section 3.14 and 4.2.
2. Domain-state-to-color mapping, AVAILABLE, LOW, TEMPORARILY_UNAVAILABLE, SOLD_OUT, and the scanner outcomes, the UX spec named the states and copy, this spec assigns the semantic color and icon per state, Section 2.2 and 3.2 and 3.6.
3. Event image and hero aspect ratios and focal-point handling, not specified in either source document, resolved in Section 5.1.
4. Podium behavior once ties push more than three occupants into the top three, the UX spec required this to work, Section 3.7 resolves the exact fallback layout, switching from a three-pedestal graphic to a ranked list at podium scale.
5. Motion easing curves, the Master gives durations only, Section 2.6 assumes two standard cubic-bezier curves, non-material since the durations, the load-bearing values, are given verbatim.
6. Z-index stacking scale, not specified anywhere, Section 2.9 assumes a standard layered scale.
7. RUNIIS wordmark treatment, Section 6, follows the PEND-BRAND-001 instruction directly, a typographic lockup only, no artwork invented.

No functional flow, state machine, RBAC boundary, or copy string from the finalized UX spec was altered; this agent only added the visual layer on top of it.

## 8. Resource policy

No JIT visual resource, Magic UI, React Bits, Motion, Motion Primitives, Three.js, GSAP, React Three Fiber, Lottie, Rive, Spline, Babylon.js, Anime.js, or 21st, is required anywhere in this spec. The direction is deliberately flat and editorial, Section 1, with motion limited to short functional transitions already achievable with native CSS transitions and Tailwind utilities at the durations and easings in Section 2.6; there is no hero animation, particle effect, 3D element, or Lottie-style illustration anywhere in the product surface described above. MapLibre is an existing architectural dependency, ADR Decisions.13, not a new addition, and this spec only restyles it. The `qrcode` package already in package.json covers server-side QR rendering per ADR A1 through A3, no client QR library is needed since the client never renders a QR itself. shadcn and Radix primitives, restyled per Section 2.11, cover every interactive base component in Section 3.1; no third-party component library beyond that is justified. This satisfies the no-gratuitous-visual-complexity constraint directly, there was nothing to add.

## 9. Gate self-check

states_complete: pass. Every component in Section 3 lists its states beyond the shared recipe in Section 3, StatusBadge and ScannerFeedback and KitStatus and AttendanceStatus cover every domain and outcome value named in Master Section36, Section58, and Section85, and every UX-spec state-inventory screen in Section 11 of the finalized UX spec maps to a component and page section above.

responsive_defined: pass, with a caveat. Every layout in Section 4 has mobile, md, and lg rules; the grid, breakpoints, and container tokens in Section 2.7 apply uniformly. 320px and 200 percent zoom were reasoned about, base breakpoint starts at 0px and every layout above uses single-column stacking with page-margin 16px at base so 320px fits without horizontal scroll, but the rendered UI itself was never checked in a browser, `visual_inspection: not_run`, since no product UI exists yet, nothing to render; this is listed honestly as not run rather than claimed.

visual_consistency: pass. Every value used throughout Section 3 and 4 traces back to a named token in Section 2, spacing rhythm and type scale are single, and component and token naming is coherent, snake or kebab consistent per its own namespace.

visual_quality: pass. Direction was set in Section 1 before any component work, self-checked against the known generic-AI-design tells in the same section, primary CTA is never low-emphasis, hierarchy is explicit through the type scale and the borders-before-shadows rule, spacing uses the given scale throughout so nothing is ad hoc.

a11y_contrast: pass. Every text and UI-component pair used anywhere in this spec is listed with its computed ratio in Section 2.2, sourced from contrast.log in this evidence directory, and every pairing that failed AA, lime as text and the soft -border tokens as a standalone signal, is called out explicitly as forbidden in that exact role rather than silently used.

a11y_focus_targets: pass. Focus-visible is specified once centrally in Section 2.8 and inherited by every component through the shared-recipe paragraph in Section 3; touch target minimum 44px is stated in the same shared recipe and re-stated per component where it is not the default, Checkbox, Radio, IconButton.

reduced_motion: pass. Section 2.6 states the global rule and CSS implementation, `@theme` block Section 2.10; every component with non-trivial motion, Tabs, Stepper, Modal, Drawer, Toast, Skeleton, CountdownStatus, ScannerFeedback, states its own reduced-motion fallback inline rather than relying on the global rule alone to be sufficient for cases needing a specific fallback, such as CountdownStatus's numeric update staying live while only decorative pulsing is removed.

resource_policy: pass. Section 8 states no JIT visual resource is required and why; shadcn resolution is specified in Section 2.11 for when salvaops-frontend initializes it; the component resolution order, project system then shadcn then JIT then new, is stated at the top of Section 3 and followed throughout, every row in Section 3.1 and every deep-dive component names its resolution.

ux_alignment: pass. Every screen, route, form, and state named in the finalized T12 UX spec, route map, J1 through J13, state inventory, form specs 10.1 through 10.8, is covered by a page layout in Section 4 or a component in Section 3; the three staff-only-replacement, guardian-dialog-fields, and RBAC-matrix corrections from the orchestrator's re-read note are folded in at point of use, Section 3.4, 3.6, and 4.10, rather than left as a stale draft.

spec_buildable: pass, with listed blockers. salvaops-frontend can build from Section 2's exact token block, Section 3's per-component anatomy and state tables, and Section 4's per-page layout rules without an open visual decision; the few genuinely open items are named as blockers below with an owner, not silently assumed away.

Blockers for salvaops-frontend or the orchestrator, not for this spec to resolve: favicon or app-icon asset does not exist, PEND-BRAND-001, owner decision needed before a production favicon ships, a neutral placeholder is acceptable for local and preview. Real event and hero photography does not exist yet for any Edition, content ownership, not a design gap, the EmptyState and imagery-fallback rules in Section 5 cover the interim state cleanly.
