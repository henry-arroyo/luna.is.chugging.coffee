// Local stand-in for AWS AppSync Events, implementing the documented WebSocket protocol:
// subprotocol auth (aws-appsync-event-ws + header-<base64url>), connection_init/ack, ka,
// subscribe/subscribe_success, publish/publish_success, data. Runs the REAL onPublish handler
// code extracted from the synthesized CloudFormation template. Also serves ../site statically.
//
//   node mock-appsync.js [port]
//   Player: http://localhost:8787/        Host: http://localhost:8787/host.html
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { WebSocketServer } = require('ws');

const PORT = Number(process.argv[2] || 8787);
const API_KEY = 'da2-localtestkey000000000000';
const HOST = `localhost:${PORT}`;
const SITE = path.join(__dirname, '..', 'site');
const KA_MS = Number(process.env.KA_MS || 60000);

// Load the real handler from the synthesized template (falls back to pass-through).
let onPublish = (ctx) => ctx.events;
try {
  const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'infra', 'cdk.out', 'SocuGame-Game.template.json')));
  const ns = Object.values(tpl.Resources).find((r) => r.Type === 'AWS::AppSync::ChannelNamespace');
  const code = ns.Properties.CodeHandlers.replace(/export function/g, 'function') + '\nthis.onPublish = onPublish;';
  const sandbox = {};
  vm.runInNewContext(code, sandbox);
  onPublish = sandbox.onPublish;
  console.log('[mock] using onPublish handler from synthesized template');
} catch (e) {
  console.log('[mock] handler not loaded:', e.message);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (url.pathname === '/runtime/config.json') {
    // Use whatever host the browser reached us on, so phones on the same Wi-Fi work too.
    const h = req.headers.host || HOST;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ mode: 'appsync', realtimeUrl: `ws://${h}/event/realtime`, httpDomain: h, apiKey: API_KEY, namespace: 'game' }));
  }
  let p = path.join(SITE, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const CHANNEL_RE = /^\/?[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?){0,4}\/?$/;
const subs = new Map(); // ws -> Map(id -> channel)
const stats = { connects: 0, publishes: 0, delivered: 0, dropped: 0, errors: 0 };

const wss = new WebSocketServer({
  server,
  path: '/event/realtime',
  handleProtocols: (protocols) => (protocols.has('aws-appsync-event-ws') ? 'aws-appsync-event-ws' : false),
  verifyClient: (info, cb) => {
    const protos = (info.req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
    const hdr = protos.find((p) => p.startsWith('header-'));
    if (!hdr) return cb(false, 401);
    try {
      const auth = JSON.parse(Buffer.from(hdr.slice(7).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      if (auth['x-api-key'] !== API_KEY || auth.host !== info.req.headers.host) return cb(false, 401);
    } catch { return cb(false, 400); }
    cb(true);
  },
});

const norm = (c) => '/' + c.replace(/^\/|\/$/g, '');
const matches = (sub, ch) => sub === ch || (sub.endsWith('/*') && ch.startsWith(sub.slice(0, -1)));

wss.on('connection', (ws) => {
  stats.connects++;
  subs.set(ws, new Map());
  let ka = null;
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const err = (type, msg) => { stats.errors++; ws.send(JSON.stringify({ type, id: m.id, errors: [{ errorType: 'BadRequest', message: msg }] })); };
    if (m.type === 'connection_init') {
      ws.send(JSON.stringify({ type: 'connection_ack', connectionTimeoutMs: 300000 }));
      ka = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ka"}'), KA_MS);
      return;
    }
    if (m.type === 'subscribe') {
      if (!/^[a-zA-Z0-9-_+]{1,128}$/.test(m.id || '')) return err('subscribe_error', 'bad id');
      if (!CHANNEL_RE.test(m.channel || '') || norm(m.channel).split('/')[1] !== 'game') return err('subscribe_error', 'bad channel');
      if (m.authorization?.['x-api-key'] !== API_KEY) return err('subscribe_error', 'unauthorized');
      if (subs.get(ws).has(m.id)) return err('subscribe_error', 'duplicate id');
      subs.get(ws).set(m.id, norm(m.channel));
      return ws.send(JSON.stringify({ type: 'subscribe_success', id: m.id }));
    }
    if (m.type === 'unsubscribe') {
      subs.get(ws).delete(m.id);
      return ws.send(JSON.stringify({ type: 'unsubscribe_success', id: m.id }));
    }
    if (m.type === 'publish') {
      if (!/^[a-zA-Z0-9-_+]{1,128}$/.test(m.id || '')) return err('publish_error', 'bad id');
      if (m.authorization?.['x-api-key'] !== API_KEY) return err('publish_error', 'unauthorized');
      if (!CHANNEL_RE.test(m.channel || '')) return err('publish_error', 'bad channel');
      if (!Array.isArray(m.events) || m.events.length < 1 || m.events.length > 5) return err('publish_error', '1-5 events');
      let parsed;
      try { parsed = m.events.map((e, i) => ({ id: String(i), payload: JSON.parse(e) })); } catch { return err('publish_error', 'events must be stringified JSON'); }
      const ch = norm(m.channel);
      const segments = ch.split('/').filter(Boolean);
      const out = onPublish({ events: parsed, info: { channel: { path: ch, segments } } }) || [];
      stats.publishes++;
      stats.dropped += parsed.length - out.length;
      for (const [cws, map] of subs) {
        for (const [sid, sch] of map) {
          if (matches(sch, ch) && cws.readyState === 1) {
            // Documented data shape: event is an array of stringified JSON values.
            cws.send(JSON.stringify({ type: 'data', id: sid, event: out.map((e) => JSON.stringify(e.payload)) }));
            stats.delivered += out.length;
          }
        }
      }
      return ws.send(JSON.stringify({ type: 'publish_success', id: m.id, successful: out.map((e, i) => ({ identifier: e.id, index: i })), failed: [] }));
    }
  });
  ws.on('close', () => { clearInterval(ka); subs.delete(ws); });
});

// Test hook: GET /__kill drops every socket (simulates phones losing signal); /__stats shows counters.
server.on('request', (req, res) => {
  if (req.url === '/__kill') { for (const ws of wss.clients) ws.terminate(); }
});
const orig = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url === '/__kill') { const n = wss.clients.size; for (const ws of wss.clients) ws.terminate(); res.end(`killed ${n}`); return; }
  if (req.url === '/__stats') { res.end(JSON.stringify({ ...stats, clients: wss.clients.size })); return; }
  orig(req, res);
});

server.listen(PORT, '0.0.0.0', () => console.log(`[mock] http://${HOST}/  host: http://${HOST}/host.html`));
