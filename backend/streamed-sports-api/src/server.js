require('dotenv').config();

// Prefer IPv4 — several sports CDNs (Cloudflare) advertise AAAA that resets from
// this Oracle VCN, which makes Node's default happy-eyeballs path flaky.
try {
  const dns = require('dns');
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch {
  // ignore
}

const express = require('express');
const cors = require('cors');
const pino = require('pino');
const { TtlCache } = require('./cache');
const { fetchUpstream } = require('./upstream');
const streamfree = require('./providers/streamfree');
const watchfooty = require('./providers/watchfooty');
const cdnlivetv = require('./providers/cdnlivetv');
const {
  PROVIDER_PRIORITY,
  tagStreamedMatches,
  mergeLivePreferWorking,
  sortProviders,
} = require('./providers/liveMerge');

const PORT = Number(process.env.PORT || 3003);
const HOST = process.env.HOST || '0.0.0.0';
const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'https://streamed.pk').replace(
  /\/$/,
  '',
);
const UPSTREAM_STREAMFREE = (
  process.env.UPSTREAM_STREAMFREE || 'https://streamfree.top'
).replace(/\/$/, '');
const UPSTREAM_WATCHFOOTY = (
  process.env.UPSTREAM_WATCHFOOTY || 'https://api.watchfooty.st'
).replace(/\/$/, '');
const UPSTREAM_CDNLIVETV = (
  process.env.UPSTREAM_CDNLIVETV || 'https://api.cdnlivetv.is'
).replace(/\/$/, '');
const CDN_PLAYER_BASE = (
  process.env.CDN_PLAYER_BASE || 'https://cdnlivetv.tv'
).replace(/\/$/, '');
const CDN_USER = process.env.CDN_USER || 'cdnlivetv';
const CDN_PLAN = process.env.CDN_PLAN || 'free';
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);
/** Fail-fast for flaky streamed.pk when reliable providers already answered. */
const STREAMED_TIMEOUT_MS = Number(process.env.STREAMED_TIMEOUT_MS || 4000);
/**
 * Live merge order (working first). Comma list; unknown names ignored.
 * Default puts StreamFree + WatchFooty ahead of streamed.pk.
 */
const LIVE_PROVIDERS = sortProviders(
  String(
    process.env.LIVE_PROVIDERS || 'streamfree,watchfooty,streamed',
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((p) => providerEnabledSafe(p)),
);

function providerEnabledSafe(name) {
  const enabled = String(
    process.env.ENABLED_PROVIDERS || 'streamed,streamfree,watchfooty,cdnlivetv',
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return enabled.includes(String(name).toLowerCase());
}

const ENABLED_PROVIDERS = String(
  process.env.ENABLED_PROVIDERS || 'streamed,streamfree,watchfooty,cdnlivetv',
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const TTL = {
  sports: Number(process.env.CACHE_SPORTS_TTL_MS || 3_600_000),
  matches: Number(process.env.CACHE_MATCHES_TTL_MS || 120_000),
  live: Number(process.env.CACHE_LIVE_TTL_MS || 45_000),
  stream: Number(process.env.CACHE_STREAM_TTL_MS || 20_000),
  streamfree: Number(process.env.CACHE_STREAMFREE_TTL_MS || 90_000),
  watchfooty: Number(process.env.CACHE_WATCHFOOTY_TTL_MS || 90_000),
  cdnChannels: Number(process.env.CACHE_CDN_CHANNELS_TTL_MS || 900_000),
  cdnEvents: Number(process.env.CACHE_CDN_EVENTS_TTL_MS || 90_000),
};

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const cache = new TtlCache();
const app = express();
const startedAt = new Date().toISOString();
const VERSION = '1.2.0';

app.disable('x-powered-by');
app.use(cors());

/** Allowed match path suffixes after /api/matches/ (streamed.pk) */
const MATCH_PATH_RE =
  /^(all|all-today|live|[a-z0-9-]+)(\/popular)?$/i;

/** Allowed stream source ids */
const SOURCE_RE = /^[a-z0-9-]+$/i;
const SOURCE_ID_RE = /^[a-zA-Z0-9._~+|%-]+$/;

function providerEnabled(name) {
  return ENABLED_PROVIDERS.includes(String(name).toLowerCase());
}

/** Build live loaders for the configured priority list. */
function buildLiveLoaders(providerList) {
  const loaders = {};
  for (const name of providerList) {
    if (!providerEnabled(name)) continue;
    if (name === 'streamfree') {
      loaders.streamfree = async () => {
        const { data } = await cachedJson('sf:streams:all:n', TTL.streamfree, async () => {
          const json = await streamfree.fetchStreams(
            fetchUpstream,
            UPSTREAM_STREAMFREE,
            UPSTREAM_TIMEOUT_MS,
            {},
          );
          const streams = streamfree.normalizeStreamsResponse(json);
          return {
            count: streams.length,
            matches: streams
              .map((s) => streamfree.toSportsMatch(s))
              .filter(Boolean),
          };
        });
        return data.matches || [];
      };
    } else if (name === 'watchfooty') {
      loaders.watchfooty = async () => {
        const { data } = await cachedJson(
          'wf:matches:live:-:n',
          TTL.watchfooty,
          async () => {
            const json = await watchfooty.fetchMatches(
              fetchUpstream,
              UPSTREAM_WATCHFOOTY,
              UPSTREAM_TIMEOUT_MS,
              'live',
            );
            return watchfooty
              .normalizeMatchesResponse(json)
              .map((m) => watchfooty.toSportsMatch(m))
              .filter(Boolean);
          },
        );
        return Array.isArray(data) ? data : [];
      };
    } else if (name === 'cdnlivetv') {
      loaders.cdnlivetv = async () => {
        const { data } = await cachedJson(
          'cdn:events:all:n-live',
          TTL.cdnEvents,
          async () => {
            const json = await cdnlivetv.fetchSportsEvents(
              fetchUpstream,
              UPSTREAM_CDNLIVETV,
              UPSTREAM_TIMEOUT_MS,
              { user: CDN_USER, plan: CDN_PLAN },
            );
            const { sports } = cdnlivetv.extractEventsPayload(json);
            const matches = [];
            for (const [sportKey, events] of Object.entries(sports)) {
              for (const ev of events) {
                if (String(ev.status || '').toLowerCase() !== 'live') continue;
                const m = cdnlivetv.toSportsMatch(ev, sportKey);
                if (m) matches.push(m);
              }
            }
            return matches;
          },
        );
        return Array.isArray(data) ? data : [];
      };
    } else if (name === 'streamed') {
      loaders.streamed = async () => {
        const { data } = await cachedJson(
          'matches:live',
          TTL.live,
          async () => {
            const result = await fetchUpstream(
              UPSTREAM_BASE,
              '/api/matches/live',
              {
                timeoutMs: Math.min(UPSTREAM_TIMEOUT_MS, STREAMED_TIMEOUT_MS * 2),
                retries: 2,
              },
            );
            if (result.json === undefined) {
              const err = new Error('Upstream returned non-JSON');
              err.status = 502;
              throw err;
            }
            return result.json;
          },
        );
        return tagStreamedMatches(data);
      };
    }
  }
  return loaders;
}

async function loadPreferWorkingLive({ popularOnly = false } = {}) {
  const loaders = buildLiveLoaders(LIVE_PROVIDERS);
  const merged = await mergeLivePreferWorking(loaders, {
    logger,
    streamedTimeoutMs: STREAMED_TIMEOUT_MS,
  });
  let matches = merged.matches;
  if (popularOnly) {
    matches = matches.filter((m) => m && m.popular === true);
  }
  return { ...merged, matches };
}

function sendJson(res, status, body, cacheHit) {
  res.setHeader('X-Cache', cacheHit ? 'HIT' : 'MISS');
  res.status(status).json(body);
}

/** [startMs, endMs) of the current UTC day. */
function todayUtcRange() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start, end: start + 86_400_000 };
}

/** Tight timeout for browse fallback so total latency stays under app timeouts. */
const FALLBACK_TIMEOUT_MS = Math.min(UPSTREAM_TIMEOUT_MS, 8000);

/**
 * Browse fallback when streamed.pk is down: merge normalized matches from
 * WatchFooty (all matches), CDN Live TV (all events), and StreamFree (live
 * streams), then filter for the requested path (`all`, `all-today`,
 * `{sport}`, optional `/popular`). Each provider soft-fails.
 */
async function loadFallbackMatches(normalized) {
  const popularOnly = normalized.endsWith('/popular');
  const base = popularOnly
    ? normalized.slice(0, -'/popular'.length)
    : normalized;
  const isAll = base === 'all';
  const isToday = base === 'all-today';
  const sport = isAll || isToday ? '' : base.toLowerCase();

  const errors = {};
  const tasks = [];

  if (providerEnabled('watchfooty')) {
    tasks.push(
      cachedJson('wf:fallback:all', TTL.matches, async () => {
        const json = await watchfooty.fetchMatches(
          fetchUpstream,
          UPSTREAM_WATCHFOOTY,
          FALLBACK_TIMEOUT_MS,
          'all',
        );
        return watchfooty
          .normalizeMatchesResponse(json)
          .map((m) => watchfooty.toSportsMatch(m))
          .filter(Boolean);
      })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch((err) => {
          errors.watchfooty = err.message || String(err);
          return [];
        }),
    );
  }

  if (providerEnabled('cdnlivetv')) {
    tasks.push(
      cachedJson('cdn:fallback:all', TTL.cdnEvents, async () => {
        const json = await cdnlivetv.fetchSportsEvents(
          fetchUpstream,
          UPSTREAM_CDNLIVETV,
          FALLBACK_TIMEOUT_MS,
          { user: CDN_USER, plan: CDN_PLAN },
        );
        const { sports } = cdnlivetv.extractEventsPayload(json);
        const matches = [];
        for (const [sportKey, events] of Object.entries(sports)) {
          for (const ev of events) {
            const m = cdnlivetv.toSportsMatch(ev, sportKey);
            if (m) matches.push(m);
          }
        }
        return matches;
      })
        .then((r) => (Array.isArray(r.data) ? r.data : []))
        .catch((err) => {
          errors.cdnlivetv = err.message || String(err);
          return [];
        }),
    );
  }

  if (providerEnabled('streamfree')) {
    tasks.push(
      cachedJson('sf:streams:all:n', TTL.streamfree, async () => {
        const json = await streamfree.fetchStreams(
          fetchUpstream,
          UPSTREAM_STREAMFREE,
          FALLBACK_TIMEOUT_MS,
          {},
        );
        const streams = streamfree.normalizeStreamsResponse(json);
        return {
          count: streams.length,
          matches: streams.map((s) => streamfree.toSportsMatch(s)).filter(Boolean),
        };
      })
        .then((r) => (Array.isArray(r.data?.matches) ? r.data.matches : []))
        .catch((err) => {
          errors.streamfree = err.message || String(err);
          return [];
        }),
    );
  }

  const results = await Promise.all(tasks);
  const attempted = tasks.length;
  let matches = results.flat();

  if (sport) {
    matches = matches.filter(
      (m) => String(m.category || '').toLowerCase() === sport,
    );
  } else if (isToday) {
    const { start, end } = todayUtcRange();
    matches = matches.filter((m) => {
      if (typeof m.date === 'number') return m.date >= start && m.date < end;
      // Undated entries are live-only feeds (StreamFree) or live events.
      return (
        m.provider === 'streamfree' ||
        String(m.status || '').toLowerCase() === 'live'
      );
    });
  }
  if (popularOnly) {
    matches = matches.filter((m) => m.popular === true);
  }

  // Date ascending; undated (live-now) entries first, like a "happening now" rail.
  matches.sort((a, b) => {
    const da = typeof a.date === 'number' ? a.date : 0;
    const db = typeof b.date === 'number' ? b.date : 0;
    return da - db;
  });

  const used = [
    ...new Set(matches.map((m) => m.provider).filter(Boolean)),
  ];
  const succeeded = attempted - Object.keys(errors).length;
  return { matches, errors, used, succeeded };
}

async function cachedJson(cacheKey, ttlMs, loader) {
  const hit = cache.get(cacheKey);
  if (hit !== undefined) {
    return { data: hit, cacheHit: true };
  }
  const data = await loader();
  cache.set(cacheKey, data, ttlMs);
  return { data, cacheHit: false };
}

async function cachedUpstreamJson(cacheKey, ttlMs, base, upstreamPath, fetchOpts = {}) {
  return cachedJson(cacheKey, ttlMs, async () => {
    const result = await fetchUpstream(base, upstreamPath, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      ...fetchOpts,
    });
    if (result.json === undefined) {
      const err = new Error('Upstream returned non-JSON');
      err.status = 502;
      throw err;
    }
    return result.json;
  });
}

function handleUpstreamError(res, err, logCtx) {
  const status =
    err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
  logger.warn({ err: err.message, ...logCtx }, 'upstream failure');
  res.status(status).json({
    ok: false,
    error: err.message,
    service: 'veil-streamed-sports',
  });
}

function requireProvider(res, name) {
  if (!providerEnabled(name)) {
    res.status(404).json({
      ok: false,
      error: `Provider '${name}' is disabled`,
      enabled: ENABLED_PROVIDERS,
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'veil-streamed-sports',
    version: VERSION,
    upstream: UPSTREAM_BASE,
    providers: {
      enabled: ENABLED_PROVIDERS,
      livePriority: LIVE_PROVIDERS,
      priorityDefault: PROVIDER_PRIORITY,
      streamed: UPSTREAM_BASE,
      streamfree: UPSTREAM_STREAMFREE,
      watchfooty: UPSTREAM_WATCHFOOTY,
      cdnlivetv: UPSTREAM_CDNLIVETV,
      streamedTimeoutMs: STREAMED_TIMEOUT_MS,
    },
    port: PORT,
    startedAt,
    cache: cache.stats(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * /debug/* is disabled unless DEBUG_TOKEN is set; callers must send the same
 * value in `x-debug-token`. Keeps cache introspection/clearing off the public
 * internet by default.
 */
function requireDebugToken(req, res) {
  const expected = process.env.DEBUG_TOKEN || '';
  if (!expected) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return false;
  }
  if (req.get('x-debug-token') !== expected) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

app.get('/debug/cache', (req, res) => {
  if (!requireDebugToken(req, res)) return;
  res.json({ ok: true, cache: cache.stats() });
});

app.post('/debug/cache/clear', (req, res) => {
  if (!requireDebugToken(req, res)) return;
  cache.clear();
  res.json({ ok: true, cleared: true });
});

app.get('/v1/external/providers', (_req, res) => {
  res.json({
    ok: true,
    enabled: ENABLED_PROVIDERS,
    providers: [
      {
        id: 'streamed',
        name: 'Streamed.pk',
        enabled: providerEnabled('streamed'),
        base: UPSTREAM_BASE,
        playback: 'iframe',
      },
      {
        id: 'streamfree',
        name: 'StreamFree',
        enabled: providerEnabled('streamfree'),
        base: UPSTREAM_STREAMFREE,
        playback: 'iframe',
      },
      {
        id: 'watchfooty',
        name: 'WatchFooty',
        enabled: providerEnabled('watchfooty'),
        base: UPSTREAM_WATCHFOOTY,
        playback: 'iframe',
      },
      {
        id: 'cdnlivetv',
        name: 'CDN Live TV',
        enabled: providerEnabled('cdnlivetv'),
        base: UPSTREAM_CDNLIVETV,
        playback: 'iframe',
      },
    ],
  });
});

// --- Streamed.pk catalog ----------------------------------------------------

app.get('/v1/sports', async (_req, res) => {
  try {
    const { data, cacheHit } = await cachedUpstreamJson(
      'sports',
      TTL.sports,
      UPSTREAM_BASE,
      '/api/sports',
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, { path: '/v1/sports' });
  }
});

async function handleMatches(req, res, rest) {
  const normalized = String(rest || '').replace(/^\/+|\/+$/g, '');
  if (!MATCH_PATH_RE.test(normalized)) {
    return res.status(400).json({
      ok: false,
      error:
        'Invalid matches path. Use all, all-today, live, or a sport id (+ optional /popular).',
    });
  }

  const isLive = normalized === 'live' || normalized === 'live/popular';
  const popularOnly = normalized === 'live/popular';

  // Live: prefer working providers (StreamFree → WatchFooty → streamed).
  if (isLive) {
    try {
      const cacheKey = `matches:prefer-working:${normalized}`;
      const { data, cacheHit } = await cachedJson(cacheKey, TTL.live, async () => {
        const merged = await loadPreferWorkingLive({ popularOnly });
        if (!merged.matches.length) {
          const err = new Error(
            `No live matches from ${LIVE_PROVIDERS.join(',')}` +
              (Object.keys(merged.errors).length
                ? ` (${JSON.stringify(merged.errors)})`
                : ''),
          );
          err.status = 502;
          throw err;
        }
        // Array response keeps Flutter SportsService happy.
        // Attach meta via header only.
        return {
          matches: merged.matches,
          meta: {
            used: merged.used,
            counts: merged.counts,
            errors: merged.errors,
            priority: LIVE_PROVIDERS,
          },
        };
      });
      res.setHeader('X-Cache', cacheHit ? 'HIT' : 'MISS');
      res.setHeader('X-Live-Providers', (data.meta.used || []).join(','));
      res.setHeader('X-Live-Priority', LIVE_PROVIDERS.join(','));
      if (data.meta.errors && Object.keys(data.meta.errors).length) {
        res.setHeader('X-Live-Errors', JSON.stringify(data.meta.errors));
      }
      return res.status(200).json(data.matches);
    } catch (err) {
      return handleUpstreamError(res, err, { path: `/v1/matches/${normalized}` });
    }
  }

  const ttl = TTL.matches;
  const cacheKey = `matches:${normalized}`;
  const upstreamPath = `/api/matches/${normalized}`;

  // streamed.pk browse with external-provider fallback. Keep the streamed
  // attempt on a short leash so fallback still fits inside client timeouts.
  let streamedErr = null;
  let streamedEmpty = null; // legit empty array from streamed.pk
  try {
    const { data, cacheHit } = await cachedUpstreamJson(
      cacheKey,
      ttl,
      UPSTREAM_BASE,
      upstreamPath,
      {
        timeoutMs: Math.min(UPSTREAM_TIMEOUT_MS, STREAMED_TIMEOUT_MS * 2),
        retries: 1,
      },
    );
    if (Array.isArray(data) && data.length > 0) {
      return sendJson(res, 200, data, cacheHit);
    }
    if (Array.isArray(data)) {
      streamedEmpty = { data, cacheHit };
    }
    streamedErr = new Error('streamed.pk returned no matches');
    streamedErr.status = 502;
  } catch (err) {
    streamedErr = err;
  }

  try {
    const fallback = await loadFallbackMatches(normalized);
    if (fallback.matches.length > 0 || fallback.succeeded > 0) {
      res.setHeader('X-Fallback-Providers', fallback.used.join(','));
      if (Object.keys(fallback.errors).length) {
        res.setHeader('X-Fallback-Errors', JSON.stringify(fallback.errors));
      }
      logger.info(
        {
          path: `/v1/matches/${normalized}`,
          used: fallback.used,
          count: fallback.matches.length,
          streamedError: streamedErr.message,
        },
        'served browse matches from fallback providers',
      );
      // An empty-but-healthy fallback is a real "no matches" answer.
      return sendJson(res, 200, fallback.matches, false);
    }
  } catch (fallbackErr) {
    logger.warn(
      { err: fallbackErr.message, path: `/v1/matches/${normalized}` },
      'browse fallback failed',
    );
  }

  // streamed.pk answered with a valid-but-empty list and fallback added
  // nothing: that is a real "no matches" result, not an error.
  if (streamedEmpty) {
    return sendJson(res, 200, streamedEmpty.data, streamedEmpty.cacheHit);
  }

  handleUpstreamError(res, streamedErr, { path: `/v1/matches/${normalized}` });
}

app.get('/v1/matches/:sport/popular', (req, res) =>
  handleMatches(req, res, `${req.params.sport}/popular`),
);
app.get('/v1/matches/:sport', (req, res) =>
  handleMatches(req, res, req.params.sport),
);

app.get('/v1/matches-live', (_req, res) =>
  res.redirect(307, '/v1/matches/live'),
);
app.get('/v1/matches-today', (_req, res) =>
  res.redirect(307, '/v1/matches/all-today'),
);

// --- Streamed + external stream resolve -------------------------------------

app.get('/v1/stream/:source/:id', async (req, res) => {
  const source = String(req.params.source || '').toLowerCase();
  const id = String(req.params.id || '');

  if (!SOURCE_RE.test(source) || !SOURCE_ID_RE.test(id)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid source or id',
    });
  }

  try {
    if (source === 'streamfree' || source === 'sf') {
      if (!requireProvider(res, 'streamfree')) return;
      const cacheKey = `stream:streamfree:${id}`;
      const { data, cacheHit } = await cachedJson(
        cacheKey,
        TTL.stream,
        async () => {
          const json = await streamfree.fetchStreams(
            fetchUpstream,
            UPSTREAM_STREAMFREE,
            UPSTREAM_TIMEOUT_MS,
            { streamKey: id },
          );
          const streams = streamfree.normalizeStreamsResponse(json);
          const mapped = streams
            .map((s) => streamfree.toMatchStream(s))
            .filter(Boolean);
          if (mapped.length === 0) {
            const err = new Error('StreamFree stream not found or offline');
            err.status = 404;
            throw err;
          }
          return mapped;
        },
      );
      return sendJson(res, 200, data, cacheHit);
    }

    if (source === 'watchfooty' || source === 'wf') {
      if (!requireProvider(res, 'watchfooty')) return;
      const cacheKey = `stream:watchfooty:${id}`;
      const { data, cacheHit } = await cachedJson(
        cacheKey,
        TTL.stream,
        async () => {
          const json = await watchfooty.fetchMatch(
            fetchUpstream,
            UPSTREAM_WATCHFOOTY,
            UPSTREAM_TIMEOUT_MS,
            id,
          );
          const matches = watchfooty.normalizeMatchesResponse(json);
          const match = matches[0] || json;
          const streams = Array.isArray(match?.streams) ? match.streams : [];
          const mapped = streams
            .map((s, i) => watchfooty.toMatchStream(s, i))
            .filter(Boolean);
          if (mapped.length === 0) {
            const err = new Error('WatchFooty streams empty');
            err.status = 404;
            throw err;
          }
          return mapped;
        },
      );
      return sendJson(res, 200, data, cacheHit);
    }

    if (source === 'cdnlivetv' || source === 'cdn') {
      if (!requireProvider(res, 'cdnlivetv')) return;
      // id format: "channel+name|us"  (channelKey)
      const parts = id.split('|');
      const namePart = decodeURIComponent((parts[0] || '').replace(/\+/g, ' '));
      const codePart = decodeURIComponent(parts[1] || '');
      if (!namePart) {
        return res.status(400).json({
          ok: false,
          error: 'cdnlivetv id must be name|code',
        });
      }
      const embedUrl = cdnlivetv.resolveChannelPlayerUrl(
        CDN_PLAYER_BASE,
        namePart,
        codePart,
        CDN_USER,
        CDN_PLAN,
      );
      return sendJson(
        res,
        200,
        [
          {
            id,
            streamNo: 1,
            language: namePart,
            hd: true,
            embedUrl,
            source: 'cdnlivetv',
          },
        ],
        false,
      );
    }

    // Default: streamed.pk
    const cacheKey = `stream:${source}:${id}`;
    const upstreamPath = `/api/stream/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
    const { data, cacheHit } = await cachedUpstreamJson(
      cacheKey,
      TTL.stream,
      UPSTREAM_BASE,
      upstreamPath,
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, { path: `/v1/stream/${source}/${id}` });
  }
});

// --- Images (streamed.pk pass-through) --------------------------------------

app.get(/^\/v1\/images\/(.+)$/, async (req, res) => {
  const sub = req.params[0];
  if (!sub || sub.includes('..')) {
    return res.status(400).json({ ok: false, error: 'Invalid image path' });
  }

  const upstreamPath = `/api/images/${sub}`;
  try {
    const result = await fetchUpstream(UPSTREAM_BASE, upstreamPath, {
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      accept: 'image/webp,*/*',
    });
    if (!result.buffer) {
      return res.status(502).json({ ok: false, error: 'Empty image response' });
    }
    res.setHeader('Content-Type', result.contentType || 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Cache', 'BYPASS');
    res.send(result.buffer);
  } catch (err) {
    handleUpstreamError(res, err, { path: `/v1/images/${sub}` });
  }
});

// --- StreamFree -------------------------------------------------------------

app.get('/v1/external/streamfree/categories', async (_req, res) => {
  if (!requireProvider(res, 'streamfree')) return;
  try {
    const { data, cacheHit } = await cachedJson(
      'sf:categories',
      TTL.sports,
      () =>
        streamfree.fetchCategories(
          fetchUpstream,
          UPSTREAM_STREAMFREE,
          UPSTREAM_TIMEOUT_MS,
        ),
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, { path: '/v1/external/streamfree/categories' });
  }
});

app.get('/v1/external/streamfree/streams/:key', async (req, res) => {
  if (!requireProvider(res, 'streamfree')) return;
  const key = String(req.params.key || '');
  try {
    const { data, cacheHit } = await cachedJson(
      `sf:stream:${key}`,
      TTL.streamfree,
      async () => {
        const json = await streamfree.fetchStreams(
          fetchUpstream,
          UPSTREAM_STREAMFREE,
          UPSTREAM_TIMEOUT_MS,
          { streamKey: key },
        );
        return streamfree.normalizeStreamsResponse(json)[0] || json;
      },
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, {
      path: `/v1/external/streamfree/streams/${key}`,
    });
  }
});

app.get('/v1/external/streamfree/streams', async (req, res) => {
  if (!requireProvider(res, 'streamfree')) return;
  const category = req.query.category ? String(req.query.category) : '';
  const normalized = req.query.normalize === '1' || req.query.normalize === 'true';
  try {
    const cacheKey = `sf:streams:${category || 'all'}:${normalized ? 'n' : 'r'}`;
    const { data, cacheHit } = await cachedJson(
      cacheKey,
      TTL.streamfree,
      async () => {
        const json = await streamfree.fetchStreams(
          fetchUpstream,
          UPSTREAM_STREAMFREE,
          UPSTREAM_TIMEOUT_MS,
          { category: category || undefined },
        );
        const streams = streamfree.normalizeStreamsResponse(json);
        if (!normalized) {
          return { count: streams.length, streams };
        }
        return {
          count: streams.length,
          matches: streams.map((s) => streamfree.toSportsMatch(s)).filter(Boolean),
        };
      },
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, { path: '/v1/external/streamfree/streams' });
  }
});

// --- WatchFooty -------------------------------------------------------------

app.get('/v1/external/watchfooty/sports', async (_req, res) => {
  if (!requireProvider(res, 'watchfooty')) return;
  try {
    const { data, cacheHit } = await cachedJson('wf:sports', TTL.sports, () =>
      watchfooty.fetchSports(
        fetchUpstream,
        UPSTREAM_WATCHFOOTY,
        UPSTREAM_TIMEOUT_MS,
      ),
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, { path: '/v1/external/watchfooty/sports' });
  }
});

app.get('/v1/external/watchfooty/match/:id', async (req, res) => {
  if (!requireProvider(res, 'watchfooty')) return;
  const id = String(req.params.id || '');
  const normalized = req.query.normalize === '1' || req.query.normalize === 'true';
  try {
    const { data, cacheHit } = await cachedJson(
      `wf:match:${id}:${normalized ? 'n' : 'r'}`,
      TTL.watchfooty,
      async () => {
        const json = await watchfooty.fetchMatch(
          fetchUpstream,
          UPSTREAM_WATCHFOOTY,
          UPSTREAM_TIMEOUT_MS,
          id,
        );
        if (!normalized) return json;
        const matches = watchfooty.normalizeMatchesResponse(json);
        const match = matches[0] || json;
        return watchfooty.toSportsMatch(match);
      },
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, {
      path: `/v1/external/watchfooty/match/${id}`,
    });
  }
});

app.get(/^\/v1\/external\/watchfooty\/matches\/(.+)$/, async (req, res) => {
  if (!requireProvider(res, 'watchfooty')) return;
  const rest = req.params[0];
  const date = req.query.date ? String(req.query.date) : '';
  const normalized = req.query.normalize === '1' || req.query.normalize === 'true';
  if (!watchfooty.isAllowedMatchesPath(rest)) {
    return res.status(400).json({
      ok: false,
      error:
        'Invalid WatchFooty path. Examples: live, all, popular, football, football/live',
    });
  }
  try {
    const cacheKey = `wf:matches:${rest}:${date || '-'}:${normalized ? 'n' : 'r'}`;
    const { data, cacheHit } = await cachedJson(
      cacheKey,
      TTL.watchfooty,
      async () => {
        const json = await watchfooty.fetchMatches(
          fetchUpstream,
          UPSTREAM_WATCHFOOTY,
          UPSTREAM_TIMEOUT_MS,
          rest,
          date || undefined,
        );
        if (!normalized) return json;
        const matches = watchfooty
          .normalizeMatchesResponse(json)
          .map((m) => watchfooty.toSportsMatch(m))
          .filter(Boolean);
        return matches;
      },
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, {
      path: `/v1/external/watchfooty/matches/${rest}`,
    });
  }
});

// --- CDN Live TV ------------------------------------------------------------

app.get('/v1/external/cdnlivetv/channels', async (req, res) => {
  if (!requireProvider(res, 'cdnlivetv')) return;
  const normalized = req.query.normalize === '1' || req.query.normalize === 'true';
  try {
    const { data, cacheHit } = await cachedJson(
      `cdn:channels:${normalized ? 'n' : 'r'}`,
      TTL.cdnChannels,
      async () => {
        const json = await cdnlivetv.fetchChannels(
          fetchUpstream,
          UPSTREAM_CDNLIVETV,
          UPSTREAM_TIMEOUT_MS,
          { user: CDN_USER, plan: CDN_PLAN },
        );
        if (!normalized) return json;
        const channels = Array.isArray(json?.channels) ? json.channels : [];
        return {
          total_channels: channels.length,
          channels: channels.map((c) => cdnlivetv.toChannel(c)).filter(Boolean),
        };
      },
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, { path: '/v1/external/cdnlivetv/channels' });
  }
});

app.get('/v1/external/cdnlivetv/events/:sport?', async (req, res) => {
  if (!requireProvider(res, 'cdnlivetv')) return;
  const sport = req.params.sport ? String(req.params.sport) : '';
  const normalized = req.query.normalize === '1' || req.query.normalize === 'true';
  try {
    const { data, cacheHit } = await cachedJson(
      `cdn:events:${sport || 'all'}:${normalized ? 'n' : 'r'}`,
      TTL.cdnEvents,
      async () => {
        const json = await cdnlivetv.fetchSportsEvents(
          fetchUpstream,
          UPSTREAM_CDNLIVETV,
          UPSTREAM_TIMEOUT_MS,
          { user: CDN_USER, plan: CDN_PLAN, sport: sport || undefined },
        );
        if (!normalized) return json;
        const { sports, totals } = cdnlivetv.extractEventsPayload(json);
        const matches = [];
        for (const [sportKey, events] of Object.entries(sports)) {
          for (const ev of events) {
            const m = cdnlivetv.toSportsMatch(ev, sportKey);
            if (m) matches.push(m);
          }
        }
        return { totals, count: matches.length, matches };
      },
    );
    sendJson(res, 200, data, cacheHit);
  } catch (err) {
    handleUpstreamError(res, err, {
      path: `/v1/external/cdnlivetv/events/${sport || ''}`,
    });
  }
});

// --- Merged live (normalized) for future UI ---------------------------------

app.get('/v1/external/matches/live', async (req, res) => {
  const want = sortProviders(
    String(req.query.providers || LIVE_PROVIDERS.join(','))
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((p) => providerEnabled(p)),
  );

  try {
    const cacheKey = `external:live:${want.join('+')}`;
    const { data, cacheHit } = await cachedJson(cacheKey, TTL.live, async () => {
      const loaders = buildLiveLoaders(want);
      return mergeLivePreferWorking(loaders, {
        logger,
        streamedTimeoutMs: STREAMED_TIMEOUT_MS,
      });
    });

    res.setHeader('X-Cache', cacheHit ? 'HIT' : 'MISS');
    res.setHeader('X-Live-Priority', want.join(','));
    res.json({
      ok: true,
      providers: want,
      used: data.used,
      counts: data.counts,
      count: data.matches.length,
      matches: data.matches,
      errors: data.errors,
    });
  } catch (err) {
    handleUpstreamError(res, err, { path: '/v1/external/matches/live' });
  }
});

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Not found',
    service: 'veil-streamed-sports',
    version: VERSION,
    endpoints: [
      'GET /health',
      'GET /v1/sports',
      'GET /v1/matches/live',
      'GET /v1/matches/all-today',
      'GET /v1/matches/:sport',
      'GET /v1/stream/:source/:id',
      'GET /v1/images/*',
      'GET /v1/external/providers',
      'GET /v1/external/streamfree/categories',
      'GET /v1/external/streamfree/streams',
      'GET /v1/external/streamfree/streams/:key',
      'GET /v1/external/watchfooty/sports',
      'GET /v1/external/watchfooty/matches/*',
      'GET /v1/external/watchfooty/match/:id',
      'GET /v1/external/cdnlivetv/channels',
      'GET /v1/external/cdnlivetv/events',
      'GET /v1/external/cdnlivetv/events/:sport',
      'GET /v1/external/matches/live',
    ],
  });
});

app.listen(PORT, HOST, () => {
  logger.info(
    {
      host: HOST,
      port: PORT,
      version: VERSION,
      enabled: ENABLED_PROVIDERS,
      livePriority: LIVE_PROVIDERS,
      streamedTimeoutMs: STREAMED_TIMEOUT_MS,
      streamed: UPSTREAM_BASE,
      streamfree: UPSTREAM_STREAMFREE,
      watchfooty: UPSTREAM_WATCHFOOTY,
      cdnlivetv: UPSTREAM_CDNLIVETV,
    },
    'veil-streamed-sports listening (multi-upstream; does not touch cinepro)',
  );
});
