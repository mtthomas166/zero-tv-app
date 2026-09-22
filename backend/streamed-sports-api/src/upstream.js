const { URL } = require('url');

/**
 * Fetch JSON (or binary) from an upstream with timeout + basic error shaping.
 * Retries once on network failures / 502–504 (some sports APIs are flaky).
 */
async function fetchUpstream(baseUrl, pathWithQuery, { timeoutMs, accept, retries = 1 } = {}) {
  const url = new URL(pathWithQuery, baseUrl).toString();
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: accept || 'application/json',
          'User-Agent':
            'Mozilla/5.0 (compatible; veil-streamed-sports/1.1; +https://github.com/dikshadamahe/veil-android)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const err = new Error(`Upstream ${res.status} for ${pathWithQuery}`);
        err.status = res.status;
        err.upstreamBody = bodyText.slice(0, 500);
        // Retry transient gateway errors
        if (attempt < retries && (res.status === 502 || res.status === 503 || res.status === 504)) {
          lastErr = err;
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw err;
      }

      if (accept && accept !== 'application/json') {
        const buffer = Buffer.from(await res.arrayBuffer());
        return { contentType, buffer };
      }

      if (contentType.includes('application/json')) {
        return { contentType, json: await res.json() };
      }

      // Some upstreams return JSON without a precise content-type
      const text = await res.text();
      try {
        return { contentType: contentType || 'application/json', json: JSON.parse(text) };
      } catch {
        return { contentType: contentType || 'text/plain', text };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error(`Upstream timeout after ${timeoutMs}ms`);
        timeoutErr.status = 504;
        lastErr = timeoutErr;
      } else if (!err.status) {
        // network / TLS reset
        lastErr = err;
        lastErr.status = lastErr.status || 502;
        lastErr.message = lastErr.message || 'Upstream fetch failed';
      } else {
        throw err;
      }

      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr || new Error('Upstream fetch failed');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { fetchUpstream };
