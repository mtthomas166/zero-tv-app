const dns = require('dns');
const fs = require('fs');
dns.setDefaultResultOrder('ipv4first');

async function hit(name, url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'veil-streamed-sports/1.1',
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    console.log(
      JSON.stringify({
        name,
        ok: r.ok,
        status: r.status,
        ms: Date.now() - t0,
        bytes: text.length,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        name,
        ok: false,
        ms: Date.now() - t0,
        err: e.cause?.code || e.code || e.message,
        detail: e.cause?.message || e.message,
      }),
    );
  }
}

(async () => {
  for (let i = 1; i <= 3; i += 1) {
    console.log('--- pass', i, '---');
    await hit('streamed', 'https://streamed.pk/api/matches/live');
    await hit('watchfooty', 'https://api.watchfooty.st/api/v1/sports');
    await hit('streamfree', 'https://streamfree.top/api/v1/streams');
    await hit('cdn', 'https://api.cdnlivetv.is/api/v1/channels/?user=cdnlivetv&plan=free');
  }

  const server = fs.readFileSync(
    '/home/ubuntu/apps/veil-streamed-sports/src/server.js',
    'utf8',
  );
  const upstream = fs.readFileSync(
    '/home/ubuntu/apps/veil-streamed-sports/src/upstream.js',
    'utf8',
  );
  console.log(
    JSON.stringify({
      ipv4first_in_server: server.includes("setDefaultResultOrder('ipv4first')"),
      upstream_has_retry: upstream.includes('retries'),
    }),
  );
})();
