/**
 * WatchFooty adapter — https://api.watchfooty.st
 * Matches already include streams[].url (iframe embeds).
 */

/** Allowed suffixes after /api/v1/matches/ */
const MATCH_PATH_RE =
  /^(all|live|popular|all\/live|all\/popular|all\/popular\/live|popular\/live|[a-z0-9-]+|[a-z0-9-]+\/popular|[a-z0-9-]+\/live)(\?.*)?$/i;

function isAllowedMatchesPath(rest) {
  const normalized = String(rest || '')
    .replace(/^\/+|\/+$/g, '')
    .split('?')[0];
  return MATCH_PATH_RE.test(normalized);
}

function toMatchStream(stream, index = 0) {
  const embedUrl = String(stream.url || stream.embedUrl || '').trim();
  if (!embedUrl) return null;
  const quality = String(stream.quality || '').toLowerCase();
  return {
    id: String(stream.id || `wf-stream-${index + 1}`),
    streamNo: index + 1,
    language: String(stream.language || 'English'),
    hd: quality.includes('hd') || quality.includes('1080') || quality.includes('720'),
    embedUrl,
    source: 'watchfooty',
  };
}

function toSportsMatch(match) {
  const matchId = String(match.matchId || match.id || '').trim();
  if (!matchId) return null;
  const title = String(match.title || '').trim();
  if (!title) return null;

  const ts = Number(match.timestamp);
  let dateMs = null;
  if (Number.isFinite(ts) && ts > 0) {
    dateMs = ts > 1e12 ? ts : ts * 1000;
  } else if (match.date) {
    const parsed = Date.parse(String(match.date));
    if (!Number.isNaN(parsed)) dateMs = parsed;
  }

  const teams = match.teams && typeof match.teams === 'object' ? match.teams : {};
  const home = teams.home && typeof teams.home === 'object' ? teams.home : null;
  const away = teams.away && typeof teams.away === 'object' ? teams.away : null;

  const streams = Array.isArray(match.streams) ? match.streams : [];
  const hasPlayable = streams.some((s) => s && (s.url || s.embedUrl));

  return {
    id: `wf:${matchId}`,
    title,
    category: String(match.sport || 'football').toLowerCase(),
    date: dateMs,
    poster: match.poster || null,
    popular: false,
    teams:
      home || away
        ? {
            home: home
              ? {
                  name: String(home.name || ''),
                  badge: null,
                  logo: home.logoUrl || home.logo || null,
                }
              : undefined,
            away: away
              ? {
                  name: String(away.name || ''),
                  badge: null,
                  logo: away.logoUrl || away.logo || null,
                }
              : undefined,
          }
        : undefined,
    sources: hasPlayable ? [{ source: 'watchfooty', id: matchId }] : [],
    provider: 'watchfooty',
    league: match.league || null,
    status: match.status || null,
    scores: match.scores || null,
  };
}

async function fetchSports(fetchUpstream, base, timeoutMs) {
  const result = await fetchUpstream(base, '/api/v1/sports', { timeoutMs });
  return result.json;
}

async function fetchMatches(fetchUpstream, base, timeoutMs, rest, date) {
  const normalized = String(rest || '')
    .replace(/^\/+|\/+$/g, '')
    .split('?')[0];
  if (!isAllowedMatchesPath(normalized)) {
    const err = new Error('Invalid WatchFooty matches path');
    err.status = 400;
    throw err;
  }
  let path = `/api/v1/matches/${normalized}`;
  if (date) {
    path += `?date=${encodeURIComponent(date)}`;
  }
  const result = await fetchUpstream(base, path, { timeoutMs });
  return result.json;
}

async function fetchMatch(fetchUpstream, base, timeoutMs, matchId) {
  const id = String(matchId || '').trim();
  if (!id || !/^[a-zA-Z0-9._~-]+$/.test(id)) {
    const err = new Error('Invalid WatchFooty match id');
    err.status = 400;
    throw err;
  }
  const result = await fetchUpstream(base, `/api/v1/match/${encodeURIComponent(id)}`, {
    timeoutMs,
  });
  return result.json;
}

function normalizeMatchesResponse(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.matches)) return json.matches;
  if (json && typeof json === 'object' && (json.matchId || json.id)) return [json];
  return [];
}

module.exports = {
  MATCH_PATH_RE,
  isAllowedMatchesPath,
  toMatchStream,
  toSportsMatch,
  fetchSports,
  fetchMatches,
  fetchMatch,
  normalizeMatchesResponse,
};
