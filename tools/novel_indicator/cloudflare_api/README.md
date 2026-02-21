# Novel Indicator Cloudflare API

Cloudflare Worker + D1 backend for account/session + profile persistence only.

## Responsibilities

- Username/password registration and login
- Google OAuth login
- Email verification and password reset flows
- Session + CSRF cookie lifecycle
- User preferences persistence
- Retained run summary/plot persistence

## Hard Rule

This API must never fetch Binance market data.
All Binance requests must originate from the browser compute engine so rate-limits apply to each user IP.

## Endpoints

Auth:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/email/verify/request`
- `POST /api/auth/email/verify/confirm`
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `GET /api/auth/session`

Profile:
- `GET /api/me`
- `GET /api/me/preferences`
- `PUT /api/me/preferences`
- `GET /api/me/runs`
- `POST /api/me/runs`
- `GET /api/me/runs/:runId`
- `DELETE /api/me/runs/:runId`

## Data Policy

Stored server-side:
- Account, credentials, oauth links, sessions, preferences
- Completed run summaries and selected plot payloads

Rejected server-side:
- Raw OHLCV uploads
- Oversized payloads beyond configured limits

## Setup

1. Install deps:
   - `npm install`
2. Create D1 database and set `database_id` in `wrangler.toml`.
3. Apply migrations:
   - `wrangler d1 migrations apply novel_indicator`
4. Set secrets:
   - `wrangler secret put SESSION_SECRET`
   - `wrangler secret put GOOGLE_CLIENT_SECRET`
   - Optional email transport key:
     - `wrangler secret put EMAIL_API_KEY`
5. Configure vars in `wrangler.toml`:
   - `APP_ORIGIN`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_REDIRECT_URI`
   - `EMAIL_FROM`
   - `COOKIE_DOMAIN` (optional)

## Commands

- `npm run dev`
- `npm run typecheck`
- `npm run test`
- `npm run deploy`
