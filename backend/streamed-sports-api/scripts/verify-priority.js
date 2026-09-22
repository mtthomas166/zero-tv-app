const { execSync } = require('child_process');
const fs = require('fs');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  execSync('pm2 restart streamed-sports --update-env', { stdio: 'inherit' });
  await sleep(2000);

  let health;
  for (let i = 0; i < 15; i++) {
    try {
      health = JSON.parse(
        execSync('curl -sS -m 3 http://127.0.0.1:3003/health', {
          encoding: 'utf8',
        }),
      );
      break;
    } catch {
      await sleep(300);
    }
  }
  console.log(
    'health',
    health?.version,
    'livePriority=',
    health?.providers?.livePriority,
  );

  const headers = execSync(
    'curl -sS -D - -o /tmp/live.json -m 35 http://127.0.0.1:3003/v1/matches/live',
    { encoding: 'utf8' },
  );
  console.log(
    headers
      .split('\n')
      .filter((l) => /HTTP\/|X-Live|X-Cache/i.test(l))
      .map((l) => l.trim())
      .join(' | '),
  );

  const m = JSON.parse(fs.readFileSync('/tmp/live.json', 'utf8'));
  if (!Array.isArray(m)) {
    console.log('NOT_ARRAY', m);
    process.exit(1);
  }
  const order = [];
  for (const row of m) {
    const p = row.provider || 'unknown';
    if (order[order.length - 1] !== p) order.push(p);
  }
  console.log(
    JSON.stringify(
      {
        count: m.length,
        providerBlocks: order,
        first3: m.slice(0, 3).map((x) => ({
          provider: x.provider,
          id: x.id,
          title: x.title,
          source0: (x.sources || [])[0],
        })),
      },
      null,
      2,
    ),
  );
  execSync('pm2 save', { stdio: 'inherit' });
})();
