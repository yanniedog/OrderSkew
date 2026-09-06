# OrderSkew calculator audit — 6 September 2026

## Scope and repository comparison

Scope: the main calculator at https://www.orderskew.com/, including its settings, tables, charts, menus and setup/help dialogs. Tool subpages and their backends are excluded at the user's request.

| Local location | Relationship to the live site | State at discovery |
| --- | --- | --- |
| `C:\code\orderskew` | Main website monorepo; GitHub `yanniedog/OrderSkew` | Branch `fix/mobile-responsive-audit`, commit `b79dc34`; 3 commits unique to this branch and 4 unique to refreshed `origin/main`. Eleven modified files, including shared/subpage styles. Preserved. |
| `C:\code\staggered` | Older checkout of the same website. GitHub's `yanniedog/staggered` URL redirects to `yanniedog/OrderSkew`; remote HEAD is the same `f3ad517` | Local `2879643`; older calculator implementation, with `app.js` last changed 9 December 2025. Preserved. |
| `C:\code\staggered_orders` | Separate Python/GUI predecessor, with backend/frontend rewrite work | Dirty, including deletions and untracked rewrite files. Preserved. |
| `C:\code\staggered_orders_2` | Separate modular Python/GUI calculator repo | Dirty. Preserved. |
| `C:\code\staggered_orders_3` | Separate Python, spreadsheet, chart and Android experiments | Dirty. Preserved. |
| OneDrive `Documents\ChatGPT\Orderskew` | This task's initially selected workspace | Empty Git repository, no commits or remote; not the deployed source. |

Other matches were non-repository experiment folders (`staggered-ideas`, `android-staggered`, `staggered_orders_android_app`, and misspelled `staaggered_orders_3`) and registered Cursor worktrees, some dirty. None was changed.

Fixes were made in `C:\code\orderskew-calculator-audit`, branch `codex/calculator-audit-20260906`, from refreshed `origin/main` (`f3ad517b2ab0fcabb9000858e08e5b9ff7dc72b7`). Existing PR #17 concerns the older mobile branch; this audit preserves its unrelated work.

Live provenance: GitHub's Production deployment and the live footer both identify `f3ad517`. All **16** local JS/CSS assets referenced by production `index.html` returned HTTP 200 and matched that main revision after newline normalization. HTML comparison found only Cloudflare beacon/challenge injection at the closing body. Thus the reproduced calculator failures are in the deployed main source, not merely an old checkout.

## Defects and fixes

| ID / severity | Reproduction or evidence | Fix |
| --- | --- | --- |
| C01 High — displayed settings ignored | On a fresh production load, expand Price Range and set Number of Orders to 2. The table still has 10 orders. The simple-settings branch also substitutes 25% depth and 0.075% fees for displayed values. | Calculations always read the controls. Advanced mode changes disclosure only. |
| C02 High — incorrect one-sided calculations | Default production says Buy Only but projects $17,065.79 profit and 34.13% ROI. Even pro buy-only includes hypothetical sell fees. Simple sell-only treats the held quantity as capital for a buy ladder. | Each trading mode generates only its applicable orders. Buy-only profit/ROI are unavailable, and only actual buy fees are included. Sell-only distributes the entered inventory. |
| C03 High — averages and row profits disagree | Production with two orders shows average buy $85.35 while the final cumulative table average is $85.4858. Base regression tests also show row profits do not reconcile with total profit when fees apply. | Report the actual quantity-weighted execution average. Distribute the actual fee-inclusive cost basis to sell rows and subtract sell fees exactly once for either settlement mode. |
| C04 High — invalid inputs silently produce plans | Base tests accept blank/negative fixed bounds, fractional/out-of-range order counts, invalid depth, and negative fees. Sliders clamp while adjacent numeric fields retain different values. | Validate authoritative numeric fields before calculating. Clear stale outputs, name the error, mark invalid inputs and reveal the relevant settings. Reject fee-exhausted orders and non-finite results. |
| C05 High — saved plans lose essential settings | The old saved JSON contains only capital, order count, skew and depth. It omits trading mode, current price, holdings, basis, range type/bounds, fees and spacing. | Version 2 stores all calculation settings. Validate the schema, active-mode financial inputs and executable plan before changing any controls; reject malformed or impossible plans without replacing the current plan. Support older four-field files with a partial-settings notice. Reset file inputs and revoke download URLs. |
| C06 High — unknown basis presented as profit | An omitted sell cost basis is treated as zero; misleading profit can be displayed. | Blank basis means unknown. Sell proceeds and quantities remain available; profit and ROI display an em dash with an explanation. Explicit zero basis remains supported. |
| C07 Medium — Flat is not equal allocation | The old target-average adjustment changes even zero-skew weights. Regression case: 2 orders with flat allocation. | Flat divides capital equally, or held quantity equally for sell-only. Nonzero skew retains the existing shape/target approach. |
| C08 High — scientific notation and tiny prices | The old sanitizer turns `1e-10` into `110`; display/copy can turn tiny nonzero values into zero. Large/small price units can overflow raw price powers in skew adjustment. | Preserve valid scientific notation, use nonzero scientific display/copy for tiny amounts, and normalize prices before exponentiating weights. |
| C09 High — wizard settings do not reach calculator | Source inspection shows wizard targets/depth are not consistently applied to active fixed bounds, and sell reference price can remain stale. Final preview checks also found a stale 20% caption after choosing 37%, and skipping before choosing a target could select empty fixed bounds. | Apply the selected range mode, explicit target, both price fields and range caption. Keep a percentage range when no target was supplied. Validate percentage ranges and accept small positive asset prices. Browser example: 10 held units, reference $200, ceiling $300 produces eight sell orders with those settings. |
| C10 Medium — closed dialogs reachable by keyboard | Production accessibility tree exposes How It Works, setup, donation and tutorial controls while visually closed. | Closed dialogs are hidden and inert; open dialogs have names, focus containment and opener restoration. A hidden intro/menu opener falls back to a visible calculator control. Background calculator becomes inert while a dialog is open. Accessibility setup is split into focused helpers. |
| C11 Medium — cramped/overlapping results and controls | Production desktop summary squeezes profit and ROI together. At the tablet desktop breakpoint, two nested control columns clip spacing/range labels. | Put results below the chart, allow wrapping and size the SVG independently. Stack control sections according to available width. Add a keyboard-focusable horizontal table region and scrolling/copy hint. |
| C12 Medium — copy/export accessibility and accuracy | Table copy targets were mouse-only. Copy announced success without checking the legacy operation's return value and moved focus. CSV included both sides regardless of selected mode and omitted fees/settings. | Native keyboard-operable copy buttons preserve cell semantics; Clipboard API with checked fallback and failure feedback. CSV includes active sides, settings, summary, fees and net cash flow. |
| C13 Low — settings/menu recovery | Advanced preference is written but ignored on reload; menus lack Escape handling; donation copy remains active for unconfigured addresses. | Restore the saved preference, close menus with Escape and disable unavailable address copying. |

## Verification

### Deterministic checks

`npm run test:calculator` — **60 tests passed, exit 0**. The calculation matrix covers 72 combinations: four price scales, three order counts, three skew values, and both spacing modes. Checks independently reconcile budget, inventory, costs, fees and profit, exercise invalid values, and cover configuration parsing/restoration, all three wizard paths and skipping, CSV output, copy failures and focus restoration. Before fixes, the initial regression suite failed 22 of 28 cases against the deployed source. Added tests reproduced the stale range caption, invalid imports replacing controls, and skip-without-target failures before their fixes.

All calculator JavaScript files pass `node --check`; `git diff --check` passes. A portable Calculator CI workflow runs syntax and numerical/configuration tests with Node 22 and no installed root dependencies.

### Interactive browser checks

Chrome tested against production for discovery/reproduction and against the isolated local static server for fixes. Tested desktop, tablet and narrow mobile layouts; recorded CSS viewport widths include 320, 354, 1025 and approximately 1500 pixels. Browser zoom means physical viewport requests differ from CSS pixels, so measurements use `innerWidth` and document widths.

- Defaults and changed capital/price; two and fifty orders; fractional-count rejection and recovery.
- All three trading modes, fixed and percentage ranges, relative/absolute spacing, and fee disclosure. A $1,000 flat two-order buy/sell plan gives $229.10 profit with zero fees, and $189.10 with $10 fixed fees paid externally. Its total buy cash is $1,020 and total fees are $40. Invalid sell ceiling $90 is rejected against a $100 reference; restoring $120 recovers the plan.
- Sell example with flat allocation, 10 units, $80 basis, $100 reference, 20% width and 1% fees: prices $105/$115, five units each, row profits $119.75/$169.25, total $289. Both settlement modes preserve net profit.
- Setup wizard from sell goal through held quantity, changed reference and explicit target to completion.
- Hosted PR preview: combined-mode setup with $1,000 capital, $200 reference and a 37% range yields eight orders on each side; the first buy/sell prices are $195.375/$204.625. Editing reference price synchronizes both mode-specific input fields. The key served calculator assets match the PR source.
- Final local wizard checks confirm the caption and range field both show 37; skipping before choosing a target preserves eight buy orders with no invalid fields and returns focus to the visible Actions control.
- Bars and cumulative layers, volume/value mode and fee-column toggles.
- Save creates a 391-byte complete JSON for the sell example. Download CSV creates a 1,981-byte file with ten Buy rows, zero Sell rows, and the settings/summary/fee/cash-flow headers.
- Keyboard copy was verified by pasting the copied $99 order price into the capital field (then restoring the test capital).
- How It Works open/close, Escape, background isolation, and focus restoration to its opener.
- Tutorial dialog opens the configured YouTube embed and clears the iframe source on close; video playback itself was not assessed.
- Donation dialog displays "Address not configured" and disables copying for the unavailable Cardano address; no transaction was attempted.
- Light and dark appearance, settings disclosure, and horizontal table containment. At CSS widths 320, 354 and 1025 the document has no horizontal overflow and the summary is below the chart.
- No calculator console errors were captured in the completed local interactions.

### Limits and release status

Chrome's extension refused file-chooser import because file-URL access is disabled. File generation was verified on disk, and actual configuration load/apply handlers were exercised in a fresh application test context, including malformed-file preservation. **A browser file-import roundtrip remains unverified.** No extension permissions were changed.

The final welcome-screen check reached the native "Save your current plan before leaving?" confirmation, where browser automation timed out. The hidden-intro-opener focus fallback is covered by the actual accessibility module's automated test, but that specific full browser path remains unverified. Earlier help/menu focus restoration and the corrected skip path were verified interactively.

No real orders, donations or other financial transactions were submitted. Subpages, their APIs, other browser engines, physical phones and comprehensive assistive-technology certification were not tested.

The all-site `npm run test:production:all` command was not run: it tests the excluded subpages and this change has not been merged or deployed. No production rollout is claimed. Before a production deployment, resolve the repository's all-site verification requirement with the user's explicit calculator-only scope and run the agreed release checks after rollout.
