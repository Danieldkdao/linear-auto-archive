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

## Running as a background service (macOS)

For an always-on machine such as a Mac mini: starts at boot, needs no terminal and no login, restarts on crash and after a reboot.

A **LaunchDaemon** runs `node dist/index.js` as your user (not root). Secrets are injected at start by `op run --environment` using a 1Password **service account**, so no secret is ever written to disk and the 1Password desktop app does not need to be running or unlocked.

Scaffolding lives in `deploy/`: `run.sh` (entry point), `com.linear-auto-archive.server.plist.template`, `install.sh`.

### 1. Prerequisites on the target Mac

- Node.js 20.6+, pnpm 12, 1Password CLI (`op`) 2.x, Tailscale.
- Tailscale must be the **standalone** build, which runs `tailscaled` as a root system daemon. The Mac App Store build runs only inside your GUI session and will not survive a reboot without login. Check with `pgrep -fl tailscaled`; if nothing is running, install the package from tailscale.com or `brew install tailscale` followed by `sudo tailscaled install-system-daemon`.
- Your tailnet policy must allow Funnel (the `funnel` node attribute).

### 2. Turn FileVault off

With FileVault on, macOS waits at the pre-boot unlock screen and **no launchd job runs until someone types a password** — unattended restart is impossible. System Settings → Privacy & Security → FileVault → Turn Off, then wait for decryption to finish.

Tradeoff: the disk is unencrypted, so physical access to the mini exposes the token file. If that is unacceptable, keep FileVault on and accept one password entry after each cold boot; `sudo fdesetup authrestart` skips the prompt for planned reboots.

### 3. Clone and build

```bash
mkdir -p ~/services && cd ~/services
git clone <your-repo-url> linear-auto-archive
cd linear-auto-archive
pnpm install && pnpm build
```

Keep it out of `~/Desktop` and `~/Documents` if iCloud Drive syncs those folders — synced files can be evicted from local disk.

### 4. Create a 1Password service account

Requires a 1Password plan with Secrets Automation. In the 1Password web app: **Developer Tools → Service Accounts → create**, grant it read access to the Environment holding this app's variables, and copy the token (shown only once). Service accounts cannot access Personal or Private vaults.

A vault-scoped account can also be created from the CLI by an admin/owner: `op service-account create linear-auto-archive --vault <Vault>:read_items`. Environment access is granted in the web app.

Store the token without leaving it in shell history:

```bash
mkdir -p "$HOME/Library/Application Support/linear-auto-archive"
read -rs TOKEN            # paste the token, press Enter; input is not echoed
umask 077
printf '%s' "$TOKEN" > "$HOME/Library/Application Support/linear-auto-archive/op-token"
chmod 600 "$HOME/Library/Application Support/linear-auto-archive/op-token"
unset TOKEN
```

### 5. Get the Environment ID

1Password app → **Developer → View Environments** → select the environment → **View environment → Manage environment → Copy environment ID**.

### 6. Install the daemon

```bash
deploy/install.sh <environment-id>
```

The script preflights that the service account can actually read the Environment (so a wrong token or scope fails before anything is installed), renders the plist with this machine's paths, installs it as `root:wheel` `0644` into `/Library/LaunchDaemons`, loads it with `launchctl bootstrap`, and waits for `/health`. Re-running it is safe — it boots out the previous job first.

### 7. Expose it with Funnel

```bash
sudo tailscale funnel --bg --https=443 12480
tailscale funnel status
```

Use the root path, not `pnpm funnel`: that script's `--set-path=/linear-auto-archive` prefix does not match the `/webhooks/linear` route. The webhook URL to enter in Linear is:

```
https://<mini-hostname>.<tailnet>.ts.net/webhooks/linear
```

Funnel config is stored by `tailscaled` and restored on boot.

### Operating it

```bash
sudo launchctl print system/com.linear-auto-archive.server | head -20   # state, pid, last exit
curl http://localhost:12480/health
tail -f logs/server.log
```

Deploy new code:

```bash
git pull && pnpm install && pnpm build
sudo launchctl kickstart -k system/com.linear-auto-archive.server
```

Stop and remove:

```bash
sudo launchctl bootout system/com.linear-auto-archive.server
sudo rm /Library/LaunchDaemons/com.linear-auto-archive.server.plist
```

### Service behaviour

- `KeepAlive` with `ThrottleInterval 10`: restarts on any exit, at most once per 10s. Invalid env causes a crash loop — read `logs/server.log`.
- Starts at boot before any login, so closing Terminal or logging out does not stop it.
- `op run` forwards SIGTERM to node, so launchd stops the process tree cleanly with no orphans.
- `logs/server.log` is gitignored and **not rotated**; it grows slowly (one line per archive plus errors).
- The only on-disk secret is the `0600` token file. Application secrets exist solely in the process environment.

