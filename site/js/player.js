// PLAYER (phone). Renders the host's latest snapshot and sends intents. Never decides outcomes.
import { TRANSACTIONS, SCENARIOS, EMAILS, LOOKUP_MEMBERS, SEAT_ICON } from './content.js';
import { loadConfig, createTransport } from './transport.js';
import { esc, $, newId, chUp, chDown, store, cleanName } from './common.js';

const app = $('#app');
let T = null;
let me = { pid: null, name: '', code: '' };
let S = null; // latest public state
let V = -1;
let joined = false;
let pending = null; // key of an action awaiting the next snapshot
const L = {
  votes: {}, // `${sc}:${node}:${round}` -> opt
  marks: {}, // email -> verdict
  inspected: {},
  clicked: {},
  showAddr: {},
  openEmail: null,
  sheet: null, // null | 'list' | memberId
  modal: null,
};

const send = (obj) => T.publish(chUp(me.code), { ...obj, pid: me.pid });
const act = (a) => send({ t: 'act', a });
const meP = () => S?.players.find((p) => p.pid === me.pid);

function localKey() {
  return `socu-local-${me.code}-${me.pid}`;
}
function saveLocal() {
  store(localKey(), { votes: L.votes, marks: L.marks, inspected: L.inspected, clicked: L.clicked });
}

// ───────────────────────── join ─────────────────────────
function renderJoin(msg = '') {
  lastHtml = '';
  const qs = new URLSearchParams(location.search);
  const code = (qs.get('code') || me.code || '').toUpperCase();
  app.innerHTML = `
    <div class="join">
      <img class="join-logo" src="/img/logo-full.png" alt="Maui County Federal Credit Union">
      <h1>SOCU Systems Training</h1>
      <form id="joinform" autocomplete="off">
        <label>Game code<input id="code" maxlength="4" value="${esc(code)}" placeholder="ABCD" autocapitalize="characters" required></label>
        <label>Your first name or nickname<input id="name" maxlength="16" value="${esc(me.name)}" placeholder="First name" required></label>
        <button class="primary block" type="submit">Join</button>
        ${msg ? `<p class="err">${esc(msg)}</p>` : ''}
        <p class="fine">Use a first name or nickname only. Nothing you enter is saved after the session.</p>
      </form>
    </div>`;
  $('#joinform').onsubmit = (e) => {
    e.preventDefault();
    const c = $('#code').value.trim().toUpperCase().replace(/[^A-Z]/g, '');
    const n = cleanName($('#name').value);
    if (c.length !== 4) return renderJoin('Game codes are 4 letters.');
    if (!n) return renderJoin('Enter a name.');
    join(c, n);
  };
}

function join(code, name) {
  if (me.code !== code) {
    S = null;
    V = -1;
  }
  me.code = code;
  me.name = name;
  store('socu-player', { code, name, pid: me.pid });
  Object.assign(L, store(localKey()) || {});
  joined = true;
  T.subscribe(chDown(code), onDown, () => send({ t: 'join', name: me.name }));
  render();
  setTimeout(() => !S && send({ t: 'join', name: me.name }), 2500);
}

function onDown(msg) {
  if (!msg || msg.t !== 'state' || typeof msg.v !== 'number') return;
  if (msg.s?.code !== me.code) return;
  if (msg.v <= V && S) return;
  V = msg.v;
  const prevPhase = S?.phase;
  S = msg.s;
  pending = null;
  if (prevPhase && prevPhase !== S.phase) {
    L.openEmail = null;
    L.modal = null;
  }
  if (!meP()) {
    joined = false;
    return renderJoin('You were removed from the game. Rejoin below.');
  }
  render();
}

// ───────────────────────── render ─────────────────────────
function header() {
  const p = meP();
  return `<header class="phead">
      <img src="/img/mark.png" alt="" class="mark">
      <div class="who"><b>${esc(me.name)}</b><small>Game ${esc(me.code)}</small></div>
      <div class="score"><small>Score</small><b>${p ? p.score : 0}</b></div>
    </header>`;
}

function render() {
  if (!joined) return renderJoin();
  if (!S) {
    lastHtml = '';
    app.innerHTML = `${header()}<main class="pmain"><div class="wait"><div class="spinner"></div><p>Connecting to the game…</p><button class="ghost" id="change">Change game code</button></div></main>`;
    $('#change').onclick = () => { joined = false; renderJoin(); };
    return;
  }
  const view = { lobby: vLobby, m1: vM1, m2: vM2, m3: vM3, audit: vTV, podium: vPodium }[S.phase] || vTV;
  const showLookup = S.settings.honeypot && ['m1', 'm2', 'm3'].includes(S.phase);
  const html = `${header()}<main class="pmain">${view()}</main>
    ${showLookup ? `<button class="lookup-fab" data-a="sheet">🔎 Member Lookup</button>` : ''}
    ${L.sheet && showLookup ? sheet() : ''}
    ${L.modal ? modal() : ''}`;
  setHtml(html);
}

// Only touch the DOM when something actually changed, so heartbeats and other
// players' actions don't replay animations or reset scroll position.
let lastHtml = '';
function setHtml(html) {
  if (html === lastHtml) return;
  lastHtml = html;
  app.innerHTML = html;
}

function seatLines(labels) {
  const p = meP();
  if (!p || !p.seats.length) return '<p class="muted">No seat yet. Your host will assign one.</p>';
  return `<ul class="myseats">${p.seats.map((s) => `<li><span>${SEAT_ICON[s]}</span>${esc(labels ? labels[s] : { member: 'Member', front: 'Front door', network: 'The network', core: 'Core system' }[s])}</li>`).join('')}</ul>`;
}

function vLobby() {
  return `<div class="card hero"><p class="eyebrow">You're in!</p><h2>Aloha, ${esc(me.name)} 👋</h2>
    <p>In Module 1, your phone becomes part of the network:</p>${seatLines()}
    <p class="muted">Keep this page open and watch the TV.</p></div>`;
}

function vTV() {
  return `<div class="card hero center"><div class="tv">📺</div><h2>Eyes on the TV</h2><p class="muted">Nothing to do on your phone right now.</p></div>`;
}

function vPodium() {
  const ranked = [...S.players].sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex((p) => p.pid === me.pid) + 1;
  return `<div class="card hero center"><p class="eyebrow">Final standings</p><h2>#${rank} of ${ranked.length}</h2><p class="bigscore">${meP().score} pts</p><p class="muted">Mahalo for playing!</p></div>`;
}

// Module 1
function vM1() {
  const m = S.m1;
  const tx = TRANSACTIONS[m.txIdx];
  if (m.status === 'idle') return `<div class="card hero"><p class="eyebrow">Module 1 · Route It</p><h2>Get ready</h2><p>Your seat:</p>${seatLines()}</div>`;
  const p = meP();
  const mySeatsHere = `<div class="seatnote">Your seat in this transaction: ${p.seats.map((s) => `<b>${SEAT_ICON[s]} ${esc(tx.labels[s])}</b>`).join(' + ') || '—'}</div>`;
  if (m.status === 'result') {
    return `<div class="card outcome ${tx.outcome.result}"><p class="eyebrow">${esc(tx.title)} · ${esc(tx.amount)}</p><h2>${esc(tx.outcome.headline)}</h2><p>${esc(tx.outcome.lesson)}</p></div>${mySeatsHere}`;
  }
  const st = tx.steps[m.step];
  const mine = p.seats.includes(st.seat);
  const fb = m.feedback;
  const myWrong = fb && fb.pid === me.pid && fb.step === m.step && !fb.ok;
  const lastRight = fb && fb.pid === me.pid && fb.ok && fb.step === m.step - 1;
  if (mine) {
    const wrongOpt = myWrong ? st.options.find((o) => o.id === fb.opt) : null;
    return `<div class="card yourturn"><p class="eyebrow">${SEAT_ICON[st.seat]} You are: ${esc(tx.labels[st.seat])}</p>
      <h2>Your move</h2><p class="prompt">${esc(st.prompt)}</p>
      ${st.info.length ? `<ul class="info">${st.info.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      ${wrongOpt ? `<div class="fb bad"><b>Not quite.</b> ${esc(wrongOpt.fb)}<br><small>Try again.</small></div>` : ''}
      <div class="opts">${st.options.map((o) => `<button class="opt ${myWrong && fb.opt === o.id ? 'wrong' : ''}" data-a="m1" data-v="${o.id}" ${pending ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div></div>`;
  }
  const holder = S.players.find((x) => x.seats.includes(st.seat));
  return `${lastRight ? `<div class="fb ok">✓ Nice: ${esc(tx.steps[fb.step].options.find((o) => o.id === fb.opt).fb)}</div>` : ''}
    <div class="card waiting"><p class="eyebrow">${esc(tx.title)} · ${esc(tx.amount)}</p>
    <p>The transaction is at</p><h2>${SEAT_ICON[st.seat]} ${esc(tx.labels[st.seat])}</h2><p class="muted">${esc(holder?.name || '')} is deciding…</p>
    <div class="pulse"></div></div>${mySeatsHere}`;
}

// Module 2
function vM2() {
  const m = S.m2;
  const sc = SCENARIOS[m.scIdx];
  if (m.status === 'idle') return `<div class="card hero"><p class="eyebrow">Module 2 · Help Desk</p><h2>Get ready</h2><p>Something is about to break. Pick your first move.</p></div>`;
  if (m.status === 'done') return vTV();
  const node = sc.nodes[m.node];
  const mine = L.votes[`${sc.id}:${m.node}:${m.round}`];
  if (m.status === 'voting') {
    return `<div class="card"><p class="eyebrow">${sc.icon} ${esc(sc.title)}</p><p class="prompt">${esc(node.text)}</p>
      <div class="opts">${node.options.map((o, i) => `<button class="opt ${mine === o.id ? 'picked' : ''}" data-a="m2" data-v="${o.id}"><span class="letter">${String.fromCharCode(65 + i)}</span>${esc(o.label)}</button>`).join('')}</div>
      <p class="muted center">${mine ? '🔒 Locked in. You can change it until the reveal.' : 'Pick one.'}</p></div>`;
  }
  const o = node.options.find((x) => x.id === mine);
  const room = node.options.find((x) => x.id === m.reveal.choice);
  return `<div class="card"><p class="eyebrow">${sc.icon} ${esc(sc.title)}</p>
    ${o ? `<div class="fb ${o.pts >= 100 ? 'ok' : o.pts > 0 ? 'mid' : 'bad'}"><b>${o.pts > 0 ? '+' + o.pts : '0'}</b> · You chose: ${esc(o.label)}<p>${esc(o.fb)}</p></div>` : `<div class="fb mid">You didn't vote this round.</div>`}
    <p class="muted">The room went with: <b>${esc(room.label)}</b></p><p class="muted">Watch the TV for what happens next.</p></div>`;
}

// Module 3
function vM3() {
  const m = S.m3;
  if (m.status === 'idle') return `<div class="card hero"><p class="eyebrow">Module 3 · The Inbox</p><h2>Get ready</h2><p>You're about to be a teller with a full inbox.</p></div>`;
  if (m.status === 'reveal') return vTV();
  if (L.openEmail) return emailView(EMAILS.find((e) => e.id === L.openEmail));
  const done = Object.keys(L.marks).length;
  return `<div class="inbox"><div class="inbox-head"><h2>Inbox</h2><span>${done}/${EMAILS.length} sorted</span></div>
    <ul class="mails">${EMAILS.map((e) => {
      const v = L.marks[e.id];
      return `<li data-a="open" data-v="${e.id}" class="${v ? 'sorted' : 'unread'}"><div class="av">${esc(e.fromName[0])}</div>
        <div class="mm"><div class="r1"><b>${esc(e.fromName)}</b><span>${esc(e.time)}</span></div><div class="r2">${esc(e.subject)}</div></div>
        ${v ? `<span class="badge ${v}">${v === 'phish' ? '🎣' : '✅'}</span>` : ''}</li>`;
    }).join('')}</ul>
    ${done === EMAILS.length ? '<p class="muted center">All sorted! You can still change answers until the reveal.</p>' : ''}</div>`;
}

function emailView(e) {
  const v = L.marks[e.id];
  return `<div class="email">
    <button class="back" data-a="close">← Inbox</button>
    <h2 class="subj">${esc(e.subject)}</h2>
    <div class="from"><div class="av">${esc(e.fromName[0])}</div><div><b>${esc(e.fromName)}</b>
      ${L.showAddr[e.id] ? `<span class="addr">${esc(e.fromAddr)}</span>` : `<button class="linkish" data-a="addr" data-v="${e.id}">show sender details</button>`}</div><span class="time">${esc(e.time)}</span></div>
    <div class="ebody">${e.body.map((p) => `<p>${esc(p)}</p>`).join('')}
      ${e.link ? `<button class="mailbtn" data-a="click" data-v="${e.id}">${esc(e.link.text)}</button>
        <div class="inspect">${L.inspected[e.id] ? `<span>🔍 This link goes to:</span><code>${esc(e.link.url)}</code>` : `<button class="ghost sm" data-a="inspect" data-v="${e.id}">🔍 Inspect link (don't click)</button>`}</div>` : ''}
    </div>
    <div class="verdicts"><p>Your call:</p>
      <button class="v phish ${v === 'phish' ? 'on' : ''}" data-a="mark" data-v="phish">🎣 Phish</button>
      <button class="v legit ${v === 'legit' ? 'on' : ''}" data-a="mark" data-v="legit">✅ Legit</button>
    </div></div>`;
}

// Honeypot: Member Lookup
function sheet() {
  if (L.sheet === 'list') {
    return `<div class="sheet"><div class="sheet-in"><div class="sheet-head"><b>🔎 Member Lookup</b><button class="x" data-a="sheetclose">×</button></div>
      <input class="search" placeholder="Search members" disabled>
      <ul class="mlist">${LOOKUP_MEMBERS.map((m) => `<li data-a="member" data-v="${m.id}"><b>${esc(m.name)}</b><small>${esc(m.tag)}</small><span>›</span></li>`).join('')}</ul></div></div>`;
  }
  const m = LOOKUP_MEMBERS.find((x) => x.id === L.sheet);
  return `<div class="sheet"><div class="sheet-in"><div class="sheet-head"><button class="back" data-a="sheet">←</button><b>${esc(m.name)}</b><button class="x" data-a="sheetclose">×</button></div>
    <p class="muted">${esc(m.tag)}</p>
    <table class="acct">${m.accounts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    <h4>Recent activity</h4><ul class="recent">${m.recent.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <p class="fine">Sample data</p></div></div>`;
}

function modal() {
  const e = EMAILS.find((x) => x.id === L.modal);
  const phish = e.verdict === 'phish';
  return `<div class="modal"><div class="modal-in ${phish ? 'bad' : 'ok'}">
    <div class="big">${phish ? '🎣' : '🌐'}</div>
    <h2>${phish ? 'Gotcha.' : 'That one was real.'}</h2>
    <p>That link went to:</p><code>${esc(e.link.url)}</code>
    <p>${phish ? "If this were real, you'd be on a fake page built to steal your login. (−50)" : "It opened the credit union's real site. Still: inspect first, every time. That's the habit."}</p>
    <button class="primary block" data-a="modalclose">Back to the email</button></div></div>`;
}

// ───────────────────────── actions ─────────────────────────
function onTap(ev) {
  const el = ev.target.closest('[data-a]');
  if (!el || !S) return;
  const v = el.dataset.v;
  switch (el.dataset.a) {
    case 'm1': {
      if (pending) return;
      const m = S.m1;
      pending = `m1:${m.txIdx}:${m.step}`;
      act({ k: 'm1answer', tx: TRANSACTIONS[m.txIdx].id, step: m.step, opt: v });
      setTimeout(() => { if (pending) { pending = null; render(); } }, 3000);
      break;
    }
    case 'm2': {
      const m = S.m2;
      const sc = SCENARIOS[m.scIdx];
      L.votes[`${sc.id}:${m.node}:${m.round}`] = v;
      saveLocal();
      act({ k: 'm2vote', sc: sc.id, node: m.node, opt: v });
      break;
    }
    case 'open':
      L.openEmail = v;
      window.scrollTo(0, 0);
      break;
    case 'close':
      L.openEmail = null;
      break;
    case 'addr':
      L.showAddr[v] = true;
      break;
    case 'inspect':
      L.inspected[v] = true;
      saveLocal();
      break;
    case 'click':
      L.clicked[v] = true;
      L.modal = v;
      saveLocal();
      act({ k: 'm3click', email: v });
      break;
    case 'modalclose':
      L.modal = null;
      break;
    case 'mark':
      L.marks[L.openEmail] = v;
      saveLocal();
      act({ k: 'm3mark', email: L.openEmail, verdict: v });
      L.openEmail = null;
      break;
    case 'sheet':
      if (!L.sheet) act({ k: 'browse' }); // log opening the lookup, not the back arrow from a record
      L.sheet = 'list';
      break;
    case 'member':
      L.sheet = v;
      act({ k: 'lookup', member: v });
      break;
    case 'sheetclose':
      L.sheet = null;
      break;
    default:
      return;
  }
  render();
}

// ───────────────────────── boot ─────────────────────────
async function boot() {
  const cfg = await loadConfig();
  if (!cfg) {
    app.innerHTML = `<div class="join"><img class="join-logo" src="/img/logo-full.png" alt="Maui County Federal Credit Union"><h1>Game is offline</h1><p class="muted">Check back when your trainer starts the session.</p></div>`;
    return;
  }
  T = createTransport(cfg);
  T.onStatus((s) => {
    $('#net').dataset.status = s;
    $('#net').textContent = s === 'online' ? '' : s === 'offline' ? 'Reconnecting…' : 'Connecting…';
  });
  const saved = store('socu-player') || {};
  me.pid = saved.pid || newId();
  me.name = saved.name || '';
  const qs = new URLSearchParams(location.search);
  const code = (qs.get('code') || '').toUpperCase();
  document.addEventListener('click', onTap);
  // Presence heartbeat; also recovers state if a broadcast was missed.
  setInterval(() => joined && send({ t: 'hello' }), 12000);
  if (saved.code && saved.name && (!code || code === saved.code)) join(saved.code, saved.name);
  else {
    me.code = code;
    renderJoin();
  }
  window.__socuPlayer = { get state() { return S; }, me }; // test hook
}

boot();
