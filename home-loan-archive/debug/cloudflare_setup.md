# Cloudflare setup: Cron trigger and Queue

## Cron trigger (scheduled handler)

The worker implements a `scheduled()` handler that acquires a daily run lock and enqueues CDR register discovery. To run it on a schedule:

1. In the Cloudflare dashboard, go to **Workers & Pages** and select the worker (e.g. `home-loan-archive-dev`).
2. Open **Settings** (or **Triggers** / **Cron Triggers** depending on UI).
3. Add a **Cron Trigger**:
   - **Cron expression**: `0 20 * * *` (UTC)
   - This runs at 20:00 UTC daily. In Australia/Hobart:
     - During **AEDT** (UTC+11): 20:00 UTC = 07:00 next day Hobart.
     - During **AEST** (UTC+10): 20:00 UTC = 06:00 next day Hobart.
4. **DST**: The expression is fixed in UTC. Hobart observes DST, so the local time will shift by one hour when DST starts/ends. Adjust the UTC hour if you need a fixed local time (e.g. 19:00 UTC in AEDT for 06:00 Hobart, or 20:00 UTC for 07:00 Hobart in AEDT).

## Queue consumer and producer

The worker is already configured with:

- **Producer**: `COLLECT_QUEUE` binding to queue `loan-collector-queue` (sends discovery and ping messages).
- **Consumer**: same queue `loan-collector-queue` with `max_batch_size: 5` and `max_retries: 3`.

No extra dashboard steps are required for the queue; the consumer is attached via `wrangler.jsonc` and is active once the worker is deployed.

## Summary

- **Cron**: Add trigger `0 20 * * *` in the worker’s Cron Triggers in the dashboard.
- **Queue**: Already bound as producer and consumer in config; confirm in dashboard under the worker’s **Queues** / **Consumers** if needed.
