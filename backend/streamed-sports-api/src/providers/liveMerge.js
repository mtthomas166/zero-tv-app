/**
 * Reliability-ordered live match merge.
 * Working providers first: streamfree → watchfooty → cdnlivetv → streamed.
 */

const PROVIDER_PRIORITY = ['streamfree', 'watchfooty', 'cdnlivetv', 'streamed'];

function priorityIndex(name) {
  const i = PROVIDER_PRIORITY.indexOf(String(name || '').toLowerCase());
  return i === -1 ? PROVIDER_PRIORITY.length : i;
}

function sortProviders(list) {
  return [...list].sort((a, b) => priorityIndex(a) - priorityIndex(b));
}

/**
 * Tag streamed.pk matches so clients know the origin; keep shape unchanged.
 */
function tagStreamedMatches(matches) {
  if (!Array.isArray(matches)) return [];
  return matches
    .filter((m) => m && typeof m === 'object' && m.id && m.title)
    .map((m) => ({
      ...m,
      provider: 'streamed',
      sources: Array.isArray(m.sources) ? m.sources : [],
    }));
}

/**
 * Run provider loaders in parallel. Each loader: () => Promise<match[]>.
 * Returns { matches, errors, used } with matches ordered by provider priority.
 * Soft-fail per provider — never throws if at least one succeeds.
 */
async function mergeLiveByPriority(loaders, { logger } = {}) {
  const names = sortProviders(Object.keys(loaders));
  const errors = {};
  const byProvider = {};

  await Promise.all(
    names.map(async (name) => {
      try {
        const rows = await loaders[name]();
        byProvider[name] = Array.isArray(rows) ? rows : [];
      } catch (err) {
        errors[name] = err.message || String(err);
        byProvider[name] = [];
        if (logger) {
          logger.warn({ err: err.message, provider: name }, 'live provider failed');
        }
      }
    }),
  );

  const matches = [];
  for (const name of names) {
    matches.push(...(byProvider[name] || []));
  }

  return {
    matches,
    errors,
    used: names.filter((n) => (byProvider[n] || []).length > 0),
    counts: Object.fromEntries(
      names.map((n) => [n, (byProvider[n] || []).length]),
    ),
  };
}

/**
 * Race: resolve as soon as the first priority provider returns a non-empty
 * list; still wait briefly for higher-priority ones that are already in flight.
 * For "loads first" UX — prefer returning streamfree/watchfooty ASAP.
 *
 * Simpler approach used by the API: wait for all (parallel), order by priority.
 * Optional early-return: if highest-priority provider finishes with data and
 * streamed is still pending past streamedTimeoutMs, return without streamed.
 */
async function mergeLivePreferWorking(loaders, {
  logger,
  streamedTimeoutMs = 4000,
} = {}) {
  const names = sortProviders(Object.keys(loaders));
  const errors = {};
  const byProvider = {};
  const pending = new Map();

  for (const name of names) {
    const p = Promise.resolve()
      .then(() => loaders[name]())
      .then((rows) => {
        byProvider[name] = Array.isArray(rows) ? rows : [];
        return byProvider[name];
      })
      .catch((err) => {
        errors[name] = err.message || String(err);
        byProvider[name] = [];
        if (logger) {
          logger.warn({ err: err.message, provider: name }, 'live provider failed');
        }
        return [];
      });
    pending.set(name, p);
  }

  // Always wait for reliable (non-streamed) providers fully.
  const reliable = names.filter((n) => n !== 'streamed');
  await Promise.all(reliable.map((n) => pending.get(n)));

  const reliableCount = reliable.reduce(
    (sum, n) => sum + (byProvider[n] || []).length,
    0,
  );

  // Streamed: short leash when we already have working data.
  if (pending.has('streamed')) {
    if (reliableCount > 0) {
      await Promise.race([
        pending.get('streamed'),
        sleep(streamedTimeoutMs).then(() => {
          if (byProvider.streamed === undefined) {
            errors.streamed =
              errors.streamed || `timeout after ${streamedTimeoutMs}ms`;
            byProvider.streamed = [];
          }
        }),
      ]);
      // Don't block the response on a late streamed.pk recovery.
    } else {
      // No fallback yet — wait for streamed fully.
      await pending.get('streamed');
    }
  }

  const matches = [];
  for (const name of names) {
    matches.push(...(byProvider[name] || []));
  }

  return {
    matches,
    errors,
    used: names.filter((n) => (byProvider[n] || []).length > 0),
    counts: Object.fromEntries(
      names.map((n) => [n, (byProvider[n] || []).length]),
    ),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  PROVIDER_PRIORITY,
  priorityIndex,
  sortProviders,
  tagStreamedMatches,
  mergeLiveByPriority,
  mergeLivePreferWorking,
};
