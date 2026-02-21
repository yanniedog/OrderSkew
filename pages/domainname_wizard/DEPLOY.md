# Domain Wizard Deployment and Canonical Paths

## Canonical code paths

- UI/runtime: `pages/domainname_wizard/index.html`, `pages/domainname_wizard/app.js`, workers in `pages/domainname_wizard/*.js`
- API (single source of truth):
  - `functions/api/domains/availability.js`
  - `functions/api/names/generate.js`

The files under `pages/domainname_wizard/functions/api/*` are now shim re-exports only, kept for Cloudflare Pages root-directory compatibility. Do not add business logic there.

## Why this consolidation

- Removes duplicated API logic and drift risk.
- Keeps compatibility with either Pages project root:
  - repo root
  - `pages/domainname_wizard`

## Cloudflare Pages setup

1. Set your Pages project root as either:
- repo root, or
- `pages/domainname_wizard`

2. Add environment variables/secrets:
- `GODADDY_API_KEY`
- `GODADDY_API_SECRET`
- `GODADDY_ENV` (`OTE` for test, `PRODUCTION` for live)

3. Deploy.

4. Open the wizard and run a search. API routes used:
- `/api/domains/availability`
- `/api/names/generate`

## Developer rule

When changing API behavior, edit only:
- `functions/api/domains/availability.js`
- `functions/api/names/generate.js`

The mirror files in `pages/domainname_wizard/functions/api/*` should remain thin re-export shims.
