# Calculator workspace redesign

Scope: the main OrderSkew calculator. Existing authorization includes automatic merge/deployment. The tools remain discoverable at `/tools`; tool internals are excluded from this task.

## Design

The calculator now has one compact toolbar, direct buy/sell/combined mode buttons, an open settings column and a four-number overview above the chart. Save/load, CSV export and guided setup have visible entry points. Essential controls no longer depend on the advanced-mode preference. The root has its own header/footer, removing duplicate branding and the shared frame's developer output.

The visual system uses Manrope and IBM Plex Mono, restrained green and amber chart colours, a warm light theme and a charcoal dark theme. Mobile layouts include sticky links to settings, overview, chart and orders. Closed dialogs remain isolated; no CSS or chart animations were introduced. Separate stylesheets own the shell, controls, results, responsive layout and dialogs, with content-derived versions in the HTML.

## Verification before release

- `npm run test:calculator`: 67 tests pass, including four new checks for overview accounting, active order counts/ranges and invalid-state clearing/recovery. Existing calculation, precision, configuration, CSV, wizard and accessibility regressions pass.
- JavaScript syntax and whitespace checks pass. The asset checker verifies all 22 local script/style references.
- Interactive Chrome checks cover direct mode changes, percentage/fixed inputs, order count, allocation, fees, overview/table consistency, light/dark themes, help/setup, keyboard copy and mobile navigation.
- Combined plan: $1,000, reference $100, two orders per side, 20% range, flat allocation, zero fees gives $229.10 profit. Overview correctly counts four orders.
- Sell-only: ten units, $80 basis, $100 reference, two orders, flat allocation and 1% fees gives $1,100 sale value, $108.90 average net exit, $11 fees and $289 profit. Table fees/profits reconcile.
- Guided combined setup with $1,000, reference $200 and a 37% range produces eight orders per side; first buy/sell prices are $195.375/$204.625. Focus returns to Guided setup.
- Mobile widths include measured 320px and 354px. Page width stays within the viewport. Sticky section links bring their target below the navigation bar. A clipped field-help popup found during QA was corrected to stay within the mobile viewport.
- Keyboard copy of the first $99 price displayed confirmation, then pasted 99 into the capital input.

Production/hosted preview checks are required after push and merge; local tests alone do not prove deployment. The full `npm run test:production:all` suite is excluded because it visits subpages and their APIs. Browser file-import remains subject to the Chrome file-chooser permission limitation recorded in the prior audit; actual load/apply handlers are covered by the regression suite. No real trades or transactions were submitted.
