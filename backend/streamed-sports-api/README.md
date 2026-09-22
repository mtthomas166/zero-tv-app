# veil-streamed-sports

Isolated Express proxy for sports / live embeds. Primary upstream is
[Streamed.pk](https://streamed.pk/docs); also proxies **StreamFree**, **WatchFooty**,
and **CDN Live TV** (no DLHD).

Runs on **port 3003** by default. Does **not** share process, port, or routes with
cinepro (`:3001`), simple-proxy (`:3000`), or nuvio (`:7000`).

## Endpoints

### Streamed.pk (unchanged)

| Local | Upstream |
| --- | --- |
| `GET /health` | — |
| `GET /v1/sports` | `/api/sports` |
| `GET /v1/matches/live` | `/api/matches/live` |
| `GET /v1/matches/all-today` | `/api/matches/all-today` |
| `GET /v1/matches/:sport` | `/api/matches/:sport` |
| `GET /v1/stream/:source/:id` | `/api/stream/:source/:id` (+ external sources) |
| `GET /v1/images/*` | `/api/images/*` |

### External providers

| Local | Notes |
| --- | --- |
| `GET /v1/external/providers` | Enabled provider list |
| `GET /v1/external/streamfree/categories` | StreamFree categories |
| `GET /v1/external/streamfree/streams[?category=]` | Live streams (`?normalize=1` → SportsMatch shape) |
| `GET /v1/external/streamfree/streams/:key` | Single stream |
| `GET /v1/external/watchfooty/sports` | Sport catalog |
| `GET /v1/external/watchfooty/matches/*` | e.g. `live`, `all`, `football/live` (`?normalize=1`) |
| `GET /v1/external/watchfooty/match/:id` | Match detail |
| `GET /v1/external/cdnlivetv/channels` | TV channels (`?normalize=1`) |
| `GET /v1/external/cdnlivetv/events[/:sport]` | Sports events (`?normalize=1`) |
| `GET /v1/external/matches/live` | Merged normalized live from enabled externals |

`GET /v1/stream/:source/:id` also accepts `streamfree` / `watchfooty` / `cdnlivetv`
(and short aliases `sf` / `wf` / `cdn`). CDN ids use `name|code`.

All playback URLs are **iframe embeds**, not HLS.

## Reliability behavior

- **Live** (`/v1/matches/live[…/popular]`): parallel merge of enabled providers in
  `LIVE_PROVIDERS` order; streamed.pk gets a short leash (`STREAMED_TIMEOUT_MS`)
  once a reliable provider has answered. Providers soft-fail; headers
  `X-Live-Providers` / `X-Live-Errors` describe the merge.
- **Browse fallback** (`/v1/matches/all`, `all-today`, `:sport[…/popular]`): when
  streamed.pk errors or returns an empty list, the response is rebuilt from
  WatchFooty (all matches) + CDN Live TV (events) + StreamFree (live streams),
  filtered by sport/date/popular. Headers `X-Fallback-Providers` /
  `X-Fallback-Errors` mark fallback responses. An empty-but-healthy fallback
  returns `200 []`, not an error.
- **Debug** (`/debug/cache`, `POST /debug/cache/clear`): return 404 unless
  `DEBUG_TOKEN` is set; callers must send the token in `x-debug-token`.

## Cache TTLs (env)

| Key | Default |
| --- | --- |
| `CACHE_SPORTS_TTL_MS` | 1h |
| `CACHE_MATCHES_TTL_MS` | 2m |
| `CACHE_LIVE_TTL_MS` | 45s |
| `CACHE_STREAM_TTL_MS` | 20s |
| `CACHE_STREAMFREE_TTL_MS` | 90s |
| `CACHE_WATCHFOOTY_TTL_MS` | 90s |
| `CACHE_CDN_CHANNELS_TTL_MS` | 15m |
| `CACHE_CDN_EVENTS_TTL_MS` | 90s |

## Run

```bash
cp .env.example .env
npm install
npm start
```

PM2 (VPS):

```bash
pm2 start src/server.js --name streamed-sports --cwd /home/ubuntu/apps/veil-streamed-sports
pm2 save
```

## Ports

Reuse **TCP 3003** only — no new host ports. Ensure Oracle NSG + iptables already
allow `3003` (same as the existing sports proxy).
