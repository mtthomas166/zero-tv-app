/**
 * CDN Live TV adapter — https://api.cdnlivetv.is
 * Channels and sports events expose iframe player URLs (not HLS).
 */

function channelKey(name, code) {
  return `${String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '+')}|${String(code || '')
    .trim()
    .toLowerCase()}`;
}

function toChannel(ch) {
  const name = String(ch.name || '').trim();
  const code = String(ch.code || '').trim();
  const url = String(ch.url || '').trim();
  if (!name || !url) return null;
  return {
    id: `cdn:${channelKey(name, code)}`,
    name,
    code,
    url,
    image: ch.image || null,
    status: ch.status || null,
    viewers: Number(ch.viewers || 0),
    provider: 'cdnlivetv',
  };
}

function toMatchStreamFromChannel(ch, index = 0) {
  const url = String(ch.url || '').trim();
  if (!url) return null;
  return {
    id: channelKey(ch.channel_name || ch.name, ch.channel_code || ch.code),
    streamNo: index + 1,
    language: String(ch.channel_name || ch.name || 'Channel'),
    hd: true,
    embedUrl: url,
    source: 'cdnlivetv',
  };
}

function toSportsMatch(event, sportKey) {
  const gameId = String(event.gameID || event.gameId || '').trim();
  if (!gameId) return null;
  const home = String(event.homeTeam || '').trim();
  const away = String(event.awayTeam || '').trim();
  const title =
    home && away ? `${home} vs ${away}` : String(event.title || gameId).trim();
  if (!title) return null;

  let dateMs = null;
  if (event.start) {
    const parsed = Date.parse(String(event.start).replace(' ', 'T') + 'Z');
    if (!Number.isNaN(parsed)) dateMs = parsed;
  }

  const channels = Array.isArray(event.channels) ? event.channels : [];
  const sources = channels
    .filter((c) => c && c.url)
    .map((c) => ({
      source: 'cdnlivetv',
      id: channelKey(c.channel_name, c.channel_code),
    }));

  const sport = String(sportKey || event.tournament || 'sports')
    .toLowerCase()
    .replace(/\s+/g, '-');

  return {
    id: `cdn:${gameId}`,
    title,
    category: sport === 'soccer' ? 'football' : sport,
    date: dateMs,
    poster: event.homeTeamIMG || event.awayTeamIMG || null,
    popular: false,
    teams: {
      home: home
        ? { name: home, badge: null, logo: event.homeTeamIMG || null }
        : undefined,
      away: away
        ? { name: away, badge: null, logo: event.awayTeamIMG || null }
        : undefined,
    },
    sources,
    provider: 'cdnlivetv',
    league: event.tournament || null,
    status: event.status || null,
    country: event.country || null,
  };
}

function extractEventsPayload(json) {
  if (!json || typeof json !== 'object') return { sports: {}, totals: {} };

  // Upstream has used several root keys over time:
  // "cdnlivetv.is", "cdnlivetv.tv", "cdn-live-tv"
  let root = json;
  const knownRoots = ['cdn-live-tv', 'cdnlivetv.is', 'cdnlivetv.tv', 'cdnlivetv'];
  for (const k of knownRoots) {
    if (json[k] && typeof json[k] === 'object') {
      root = json[k];
      break;
    }
  }
  // Or: single top-level object whose values are sport arrays
  if (root === json) {
    const keys = Object.keys(json);
    if (
      keys.length === 1 &&
      json[keys[0]] &&
      typeof json[keys[0]] === 'object' &&
      !Array.isArray(json[keys[0]])
    ) {
      root = json[keys[0]];
    }
  }

  const sports = {};
  const totals = {};
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith('total_')) {
      totals[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      sports[key] = value;
    }
  }
  return { sports, totals };
}

async function fetchChannels(fetchUpstream, base, timeoutMs, { user, plan }) {
  const path = `/api/v1/channels/?user=${encodeURIComponent(user)}&plan=${encodeURIComponent(plan)}`;
  const result = await fetchUpstream(base, path, { timeoutMs });
  return result.json;
}

async function fetchSportsEvents(fetchUpstream, base, timeoutMs, { user, plan, sport }) {
  let path = `/api/v1/events/sports/?user=${encodeURIComponent(user)}&plan=${encodeURIComponent(plan)}`;
  if (sport) {
    const s = String(sport).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!s) {
      const err = new Error('Invalid sport');
      err.status = 400;
      throw err;
    }
    path = `/api/v1/events/sports/${s}/?user=${encodeURIComponent(user)}&plan=${encodeURIComponent(plan)}`;
  }
  const result = await fetchUpstream(base, path, { timeoutMs });
  return result.json;
}

function resolveChannelPlayerUrl(basePlayerHost, name, code, user, plan) {
  const n = encodeURIComponent(String(name || '').trim());
  const c = encodeURIComponent(String(code || '').trim());
  return `${basePlayerHost}/api/v1/channels/player/?name=${n}&code=${c}&user=${encodeURIComponent(user)}&plan=${encodeURIComponent(plan)}`;
}

module.exports = {
  channelKey,
  toChannel,
  toMatchStreamFromChannel,
  toSportsMatch,
  extractEventsPayload,
  fetchChannels,
  fetchSportsEvents,
  resolveChannelPlayerUrl,
};
