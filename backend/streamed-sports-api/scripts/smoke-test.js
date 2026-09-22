#!/usr/bin/env node
const base = process.env.BASE || 'http://127.0.0.1:3003';

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

function brief(v, n = 280) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.slice(0, n);
}

(async () => {
  const checks = [
    ['health', '/health'],
    ['providers', '/v1/external/providers'],
    ['sf categories', '/v1/external/streamfree/categories'],
    ['sf streams', '/v1/external/streamfree/streams'],
    ['sf normalize', '/v1/external/streamfree/streams?normalize=1'],
    ['wf sports', '/v1/external/watchfooty/sports'],
    ['wf live', '/v1/external/watchfooty/matches/live'],
    ['cdn channels', '/v1/external/cdnlivetv/channels'],
    ['cdn soccer n', '/v1/external/cdnlivetv/events/soccer?normalize=1'],
    ['merged live', '/v1/external/matches/live'],
    ['streamed live', '/v1/matches/live'],
  ];

  for (const [name, path] of checks) {
    try {
      const { status, json } = await get(path);
      let summary = '';
      if (json && typeof json === 'object') {
        if (json.count != null) summary += ` count=${json.count}`;
        if (json.total_channels != null) summary += ` channels=${json.total_channels}`;
        if (Array.isArray(json)) summary += ` array=${json.length}`;
        if (json.streams) summary += ` streams=${json.streams.length}`;
        if (json.matches) summary += ` matches=${json.matches.length}`;
        if (json.errors && Object.keys(json.errors).length)
          summary += ` errors=${JSON.stringify(json.errors)}`;
        if (json.ok === false) summary += ` err=${json.error}`;
      }
      console.log(`[${status}] ${name}${summary} :: ${brief(json)}`);
    } catch (e) {
      console.log(`[FAIL] ${name} :: ${e.message}`);
    }
  }

  // stream resolve for first streamfree key
  try {
    const { json } = await get('/v1/external/streamfree/streams');
    const key = json.streams?.[0]?.stream_key;
    if (key) {
      const r = await get(`/v1/stream/streamfree/${encodeURIComponent(key)}`);
      console.log(`[${r.status}] stream resolve sf/${key} :: ${brief(r.json)}`);
    }
  } catch (e) {
    console.log(`[FAIL] stream resolve :: ${e.message}`);
  }

  // public CDN channel resolve
  try {
    const r = await get('/v1/stream/cdnlivetv/ABC%7Cus');
    console.log(`[${r.status}] stream resolve cdn/ABC|us :: ${brief(r.json)}`);
  } catch (e) {
    console.log(`[FAIL] cdn resolve :: ${e.message}`);
  }
})();
