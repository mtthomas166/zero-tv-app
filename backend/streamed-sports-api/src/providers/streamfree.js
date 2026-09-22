/**
 * StreamFree adapter — https://streamfree.top/api
 * Live streams already carry embed_url; no separate resolve hop.
 */

function mapCategory(category) {
  const c = String(category || '').toLowerCase();
  if (c === 'soccer') return 'football';
  return c || 'other';
}

function toMatchStream(stream) {
  const embedUrl = String(stream.embed_url || '').trim();
  if (!embedUrl) return null;
  return {
    id: String(stream.stream_key || stream.id || ''),
    streamNo: 1,
    language: 'English',
    hd: true,
    embedUrl,
    source: 'streamfree',
  };
}

function toSportsMatch(stream) {
  const key = String(stream.stream_key || stream.id || '').trim();
  if (!key) return null;
  const title = String(stream.name || '').trim();
  if (!title) return null;

  const ts = Number(stream.match_timestamp);
  const dateMs =
    Number.isFinite(ts) && ts > 0
      ? ts > 1e12
        ? ts
        : ts * 1000
      : null;

  const team1 = stream.team1 && typeof stream.team1 === 'object' ? stream.team1 : null;
  const team2 = stream.team2 && typeof stream.team2 === 'object' ? stream.team2 : null;

  return {
    id: `sf:${key}`,
    title,
    category: mapCategory(stream.category),
    date: dateMs,
    poster: stream.thumbnail_url || null,
    popular: Number(stream.viewers || 0) > 50,
    teams:
      team1 || team2
        ? {
            home: team1
              ? { name: String(team1.name || ''), badge: null, logo: team1.logo || null }
              : undefined,
            away: team2
              ? { name: String(team2.name || ''), badge: null, logo: team2.logo || null }
              : undefined,
          }
        : undefined,
    sources: [{ source: 'streamfree', id: key }],
    provider: 'streamfree',
    league: stream.league || null,
    raw: undefined,
  };
}

async function fetchCategories(fetchUpstream, base, timeoutMs) {
  const result = await fetchUpstream(base, '/api/v1/categories', { timeoutMs });
  return result.json;
}

async function fetchStreams(fetchUpstream, base, timeoutMs, { category, streamKey } = {}) {
  let path = '/api/v1/streams';
  if (streamKey) {
    path = `/api/v1/streams/${encodeURIComponent(streamKey)}`;
  } else if (category) {
    path = `/api/v1/streams?category=${encodeURIComponent(category)}`;
  }
  const result = await fetchUpstream(base, path, { timeoutMs });
  return result.json;
}

function normalizeStreamsResponse(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.streams)) return json.streams;
  if (json && typeof json === 'object' && (json.stream_key || json.embed_url)) {
    return [json];
  }
  return [];
}

module.exports = {
  mapCategory,
  toMatchStream,
  toSportsMatch,
  fetchCategories,
  fetchStreams,
  normalizeStreamsResponse,
};
