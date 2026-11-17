# Linear Auto Archive

A small webhook service that archives Linear issues as soon as they are marked **Done**, and reports every action to a Discord channel.

## What it does

1. Listens for Linear webhooks at `POST /webhooks/linear`.
2. Verifies the request with Linear's signing secret (HMAC-SHA256 over the raw body, plus the `webhookTimestamp` freshness check — requests older than 60s are rejected). Invalid signatures return `401`.
3. Keeps only `Issue` events with action `update`; everything else is ignored.
4. Fetches the issue by id and checks `completedAt`:
   - **set** → the issue is archived and Discord is notified.
   - **not set** → nothing happens (e.g. a title or priority change on an open issue).
5. Sends a success message to Discord containing the issue identifier, title, and the Linear API rate-limit counters read from the GraphQL response headers (`X-Complexity`, `X-RateLimit-Complexity-Remaining`, `X-RateLimit-Requests-Remaining`).

Any failure along the way (bad signature, issue not found, archive failed, Discord unreachable) is logged to stdout, pushed to Discord as an error message, and returned to Linear with an appropriate status code.

```
Linear (issue marked Done)
   │  webhook POST
   ▼
Express :12480  ──verify signature──▶  Linear API: issue.completedAt?
                                              │ yes
                                              ▼
                                     archive issue ──▶ Discord log
```

## Requirements

- Node.js 20.6+ (the start script uses `node --env-file`)
- pnpm 12
- A Linear workspace with permission to create an API key and a webhook
- A Discord channel webhook URL
- [Tailscale CLI](https://tailscale.com/kb/1223/funnel) — only needed to receive webhooks locally

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Create a `.env` file in the project root. All variables are validated at boot with Zod (`src/env/index.ts`); the server refuses to start if one is missing or malformed.

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | yes | `development` \| `test` \| `production` |
| `LINEAR_API_KEY` | yes | Personal API key from Linear → Settings → Security & access → API keys. Needs write access to archive issues. |
| `LINEAR_WEBHOOK_SECRET` | yes | Signing secret shown when you create the webhook in Linear → Settings → API → Webhooks. |
| `DISCORD_WEBHOOK_URL` | yes | Discord → Channel settings → Integrations → Webhooks → New Webhook → Copy URL. |
| `PORT` | no | HTTP port, defaults to `12480`. |

### 3. Create the Linear webhook

In Linear → Settings → Integrations → Webhooks, add a webhook with:

- **URL**: `https://<your-public-host>/webhooks/linear`
- **Enabled events**: `Issue` → `Issue updated`

Save it and copy the signing secret into `LINEAR_WEBHOOK_SECRET`.

### 4. Run

```bash
pnpm dev      # watch mode, restarts on source changes
```

Or the production build:

```bash
pnpm build    # tsc → dist/
pnpm start    # node --env-file=.env dist/index.js
```

Confirm it is up:

```bash
curl http://localhost:12480/health
# {"status":"ok","message":"Linear Auto Archive server is running."}
```

### 5. Expose the local server to Linear

Linear must be able to reach your machine over HTTPS. For local development, Tailscale Funnel does this without a tunnel account — the `funnel` script starts it in the background on the default port:

```bash
pnpm dev     # in one terminal
pnpm funnel  # in another
```

Then point the Linear webhook at the funnel hostname that `tailscale funnel` prints. If you use the `--set-path=/linear-auto-archive` prefix from the `funnel` script, Linear may need to call `https://<host>/linear-auto-archive/webhooks/linear`; watch the server log for the incoming request path and adjust the webhook URL or the route in `src/index.ts` to match.

To stop the funnel: `tailscale funnel --stop`.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run `src/index.ts` with `tsx watch`, loading `.env` and restarting on changes. |
| `pnpm build` | Compile TypeScript to `dist/`. |
| `pnpm start` | Run the compiled `dist/index.js` with `.env` loaded. |
| `pnpm funnel` | Start a background Tailscale Funnel for port `12480`. |

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/webhooks/linear` | Receives Linear webhook events. Responds `201`. |
| `GET` | `/health` | Liveness check. Responds `200` with `{ status: "ok" }`. |

## Project layout

```
src/
  index.ts              Express app, webhook route, orchestration
  env/index.ts          Zod-validated environment schema
  services/linear.ts    Issue fetch + archive, rate-limit header capture
  services/discord.ts   Discord webhook logging with per-type formatting
  lib/helpers.ts        wrapLogs: central error → console + Discord + ApiError
  lib/errors.ts         ApiError with HTTP status code
```

**Only completed issues are archived**: archiving is driven by `completedAt`, not by the `Done` workflow state, so issues completed through other routes (e.g. a merge-linked PR) are archived too.
