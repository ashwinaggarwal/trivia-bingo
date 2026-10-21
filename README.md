# Trivia Bingo

Local-network party game server — a shelf of games (Trivia Bingo, Fastest
Finger, Emoji Movie Quiz), each with its own admin console, shared game
screen, and per-player join view with QR codes.

## Running locally

### Option A: plain Node

```bash
npm install
npm start
```

Open the shelf at `http://localhost:3000/` (or whatever LAN IP your terminal
prints on startup), pick a game, and create an instance of it to get its
player join link/QR code.

### Option B: Docker

```bash
docker compose up --build
```

This builds the image from the `Dockerfile` and starts the container with:

- Port `3000` published to the host (override with `PORT=3100 docker compose up` if `3000` is taken)
- `./data/games` bind-mounted into the container, so game state created at
  runtime survives container restarts/rebuilds
- `data/trivia-bingo`, `data/emoji-quiz`, etc. (each engine's static content
  packs) baked into the image at build time — only `data/games` (per-game
  runtime state) is excluded from the image via `.dockerignore` and
  persisted through the volume instead

To run without compose:

```bash
docker build -t trivia-bingo .
docker run -p 3000:3000 -v "$(pwd)/data/games:/app/data/games" trivia-bingo
```

Join links and QR codes are derived automatically from whatever host/port a
request actually came in on, so they work correctly whether you access the
app via `localhost`, your Mac's LAN IP, or (once deployed) a public domain —
no configuration needed.

## Deploying

The app is a standard Dockerized Node service, so it deploys as-is to any
platform that builds from a `Dockerfile`. Steps below cover Render and
Railway, two platforms with usable free/low-cost tiers for small Docker apps
at the time of writing — check their current pricing before relying on this,
since free-tier terms change.

Either way, push this repo to GitHub first — both platforms deploy by
connecting to a git repo.

### Render

1. [New Web Service](https://dashboard.render.com) → connect this GitHub repo.
2. Environment: **Docker**. Render detects the `Dockerfile` automatically.
3. Render injects its own `PORT` env var and routes traffic to it — no extra
   config needed; `server.js` already reads `process.env.PORT`.
4. Deploy. Render gives you a `https://<your-service>.onrender.com` URL —
   join links/QR codes will automatically use it (see note above).

**Caveat:** Render's free tier has no persistent disk — the container's
filesystem resets on every redeploy and on every spin-down/spin-up cycle
(free services sleep after inactivity). That means `data/games` (and any
games created) won't survive those resets. Fine for demos; if you need games
to persist, you'd need a paid plan with a persistent disk mounted at
`/app/data/games`, or move game storage to an external store (e.g. Redis,
S3) instead of the local filesystem.

### Railway

1. [New Project](https://railway.app) → **Deploy from GitHub repo** → select
   this repo. Railway detects the `Dockerfile` automatically.
2. Railway also injects `PORT` automatically and routes traffic to it — no
   extra config needed.
3. Deploy. Railway gives you a public `*.up.railway.app` URL (or attach a
   custom domain) — again, join links/QR codes pick it up automatically.

**Caveat:** same as Render — persistent storage for `data/games` requires
attaching a Railway volume (a paid-usage feature), otherwise game state is
lost on redeploy/restart.

### Any other Dockerfile-based platform

The same general recipe applies anywhere that builds a `Dockerfile` and sets
`PORT`:

- The app listens on `0.0.0.0:$PORT` (defaults to `3000`) — no changes needed.
- It reads `X-Forwarded-Proto`/`X-Forwarded-Host` from the platform's reverse
  proxy (`app.set('trust proxy', true)` in `server.js`) to build correct
  `https://` join links/QR codes — this works automatically on platforms that
  terminate TLS in front of your container, which is the normal setup.
- `data/games` needs a persistent volume mounted at `/app/data/games` if you
  want created games to survive a restart; without one, it behaves like an
  ephemeral demo deployment.

## Development

```bash
npm run lint        # eslint
npm run lint:fix
npm run format       # prettier --write
npm run format:check
```
