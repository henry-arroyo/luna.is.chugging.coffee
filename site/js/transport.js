// Real-time transport.
//  - AppSyncTransport: AWS AppSync Events WebSocket protocol (connect, subscribe, publish over one socket).
//  - LocalTransport:   BroadcastChannel between tabs on one machine, for rehearsal with ?local=1.
// Both expose: subscribe(channel, onEvent, onReady, onError) · publish(channel, obj) · onStatus(fn) · reconnectNow() · close()
//
// Everyone connects with the public API key. The TV also passes cfg.hostToken (the host password),
// which AppSync's Lambda authorizer checks on each of its subscribes and publishes.

export async function loadConfig() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('local') === '1') return { mode: 'local' };
  try {
    const r = await fetch('/runtime/config.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const cfg = await r.json();
    // Test harness only. On the real site a link could otherwise point phones at someone else's server.
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (local && qs.get('realtimeUrl')) cfg.realtimeUrl = qs.get('realtimeUrl');
    return cfg;
  } catch {
    return null;
  }
}

export function createTransport(cfg) {
  return cfg.mode === 'local' ? new LocalTransport() : new AppSyncTransport(cfg);
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class StatusMixin {
  constructor() {
    this._statusFns = new Set();
    this.status = 'connecting';
  }
  onStatus(fn) {
    this._statusFns.add(fn);
    fn(this.status);
  }
  _setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this._statusFns.forEach((fn) => fn(s));
  }
}

export class AppSyncTransport extends StatusMixin {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.closed = false;
    this.subs = new Map(); // id -> { channel, onEvent, onReady, onError }
    this.queue = [];
    this.ws = null;
    this.ready = false;
    this.attempt = 0;
    this.kaTimeoutMs = 300000;
    const wake = () => this.reconnectNow(false);
    // Phones suspend sockets when the screen locks; the socket can still claim to be OPEN.
    // If we were hidden for more than a few seconds, rebuild the connection on return.
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else this.reconnectNow(hiddenAt && Date.now() - hiddenAt > 3000);
    });
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
    // Watchdog: phones can leave a socket "open" but dead after sleeping.
    this.watchdog = setInterval(() => {
      if (this.ready && Date.now() - this.lastMsg > this.kaTimeoutMs + 10000) this.reconnectNow(true);
    }, 15000);
    this._connect();
  }

  get url() {
    return this.cfg.realtimeUrl || `wss://${this.cfg.realtimeDomain}/event/realtime`;
  }

  // Connection auth: always the API key.
  get auth() {
    return { host: this.cfg.httpDomain, 'x-api-key': this.cfg.apiKey };
  }

  // Auth for each subscribe and publish: the host password if this is the TV, otherwise the API key.
  get opAuth() {
    return this.cfg.hostToken ? { host: this.cfg.httpDomain, Authorization: this.cfg.hostToken } : this.auth;
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    const ws = this.ws;
    this.ws = null;
    try { ws && ws.close(); } catch {}
  }

  reconnectNow(force) {
    if (this.closed) return;
    const dead = !this.ws || this.ws.readyState >= 2;
    if (force || dead) {
      clearTimeout(this.retryTimer);
      if (this.ws && !dead) {
        const old = this.ws;
        this.ws = null;
        try { old.close(); } catch {}
      }
      this._connect();
    }
  }

  _connect() {
    this.ready = false;
    this._setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');
    let ws;
    try {
      ws = new WebSocket(this.url, ['aws-appsync-event-ws', `header-${b64url(JSON.stringify(this.auth))}`]);
    } catch {
      return this._retry();
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
    ws.onmessage = (ev) => this.ws === ws && this._onMessage(ev);
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ready = false;
      this._setStatus('offline');
      this._retry();
    };
  }

  _retry() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    const cap = Math.min(8000, 400 * 2 ** Math.min(this.attempt, 5));
    this.attempt++;
    this.retryTimer = setTimeout(() => this._connect(), 200 + Math.random() * cap);
  }

  _onMessage(ev) {
    this.lastMsg = Date.now();
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.type) {
      case 'connection_ack':
        this.kaTimeoutMs = m.connectionTimeoutMs || 300000;
        this.ready = true;
        this.attempt = 0;
        for (const [id, s] of this.subs) this._sendSub(id, s);
        this._flush();
        this._setStatus('online');
        break;
      case 'subscribe_success': {
        const s = this.subs.get(m.id);
        if (s && s.onReady) s.onReady();
        break;
      }
      case 'data': {
        const s = this.subs.get(m.id);
        if (!s) return;
        const list = Array.isArray(m.event) ? m.event : [m.event];
        for (let e of list) {
          if (typeof e === 'string') {
            try { e = JSON.parse(e); } catch { continue; }
          }
          try { s.onEvent(e); } catch (err) { console.error(err); }
        }
        break;
      }
      case 'ka':
        break;
      case 'subscribe_error': {
        // Not retried: the usual cause is a wrong host password, and retrying won't fix that.
        const s = this.subs.get(m.id);
        this.subs.delete(m.id);
        console.warn('[appsync]', m);
        if (s && s.onError) s.onError(m);
        break;
      }
      case 'publish_error':
      case 'broadcast_error':
      case 'connection_error':
      case 'error':
        console.warn('[appsync]', m);
        break;
    }
  }

  _sendSub(id, s) {
    this._send({ type: 'subscribe', id, channel: s.channel, authorization: this.opAuth });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  _flush() {
    const q = this.queue.splice(0);
    q.forEach((msg) => this._send(msg));
  }

  subscribe(channel, onEvent, onReady, onError) {
    const id = `s${rid()}`.slice(0, 40);
    const s = { channel, onEvent, onReady, onError };
    this.subs.set(id, s);
    if (this.ready) this._sendSub(id, s);
    return id;
  }

  publish(channel, obj) {
    const msg = {
      type: 'publish',
      id: `p${rid()}`.slice(0, 40),
      channel,
      events: [JSON.stringify(obj)],
      authorization: this.opAuth,
    };
    if (this.ready && this.ws && this.ws.readyState === 1) this._send(msg);
    else {
      this.queue.push(msg);
      if (this.queue.length > 30) this.queue.shift();
    }
  }
}

export class LocalTransport extends StatusMixin {
  constructor() {
    super();
    this.out = new Map();
    setTimeout(() => this._setStatus('online'), 0);
  }
  reconnectNow() {}
  close() {}
  subscribe(channel, onEvent, onReady) {
    const bc = new BroadcastChannel(`socu:${channel}`);
    bc.onmessage = (ev) => onEvent(ev.data);
    setTimeout(() => onReady && onReady(), 0);
  }
  publish(channel, obj) {
    if (!this.out.has(channel)) this.out.set(channel, new BroadcastChannel(`socu:${channel}`));
    this.out.get(channel).postMessage(obj);
  }
}
