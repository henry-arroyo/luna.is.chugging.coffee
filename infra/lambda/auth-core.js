// Host password check, shared by the AppSync Lambda authorizer (host-auth.js), the local mock,
// and set-host-password.sh. No AWS SDK here, so the mock and the script can load it as-is.
//
// Only a salted scrypt hash is ever stored: scrypt$N$r$p$<salt base64>$<hash base64>
const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');

const N = 16384;
const R = 8;
const P = 1;
const LEN = 32;
const MAX_LEN = 128;

function hashPassword(password, salt = randomBytes(16)) {
  const hash = scryptSync(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verify(stored, password) {
  if (typeof password !== 'string' || !password || password.length > MAX_LEN) return false;
  const [alg, n, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return want.length === LEN && timingSafeEqual(got, want);
}

// AppSync Events Lambda authorizer. loadHash() returns the stored hash; it's re-read every minute,
// so a password change takes effect without a redeploy. AppSync caches a "yes" for 5 minutes per token.
function makeHandler(loadHash, { reloadMs = 60000, log = console.log } = {}) {
  let stored = null;
  let loadedAt = 0;
  return async (event) => {
    if (!stored || Date.now() - loadedAt > reloadMs) {
      stored = await loadHash();
      loadedAt = Date.now();
    }
    const ok = verify(stored, event && event.authorizationToken);
    const ctx = (event && event.requestContext) || {};
    log(JSON.stringify({ host_auth: ok ? 'allowed' : 'denied', operation: ctx.operation, channel: ctx.channel }));
    return { isAuthorized: ok, ttlOverride: ok ? 300 : 0 };
  };
}

module.exports = { hashPassword, verify, makeHandler, MAX_LEN };
