// HOST (the TV). Holds the authoritative game state, validates every player action,
// and broadcasts a versioned public snapshot. Phones only send intents.
import { TRANSACTIONS, SCENARIOS, EMAILS, LOOKUP_MEMBERS, SEATS, SEAT_ICON, METHOD } from './content.js';
import { loadConfig, createTransport } from './transport.js';
import { esc, $, newCode, chUp, chDown, fmtTime, store, cleanName } from './common.js';
import qrcode from './qrcode.mjs';

const PHASES = [
  ['lobby', 'Lobby'],
  ['m1', '1 · Route It'],
  ['m2', '2 · Help Desk'],
  ['m3', '3 · The Inbox'],
  ['audit', 'Audit Log'],
  ['podium', 'Podium'],
];
const ONLINE_MS = 40000;
const KEY = 'socu-host-session';

let S = null; // authoritative state
let T = null; // transport
let cfg = null;
let bTimer = null;

// ───────────────────────── state ─────────────────────────
function freshState(code) {
  return {
    code,
    v: 0,
    created: Date.now(),
    phase: 'lobby',
    settings: { honeypot: false, anonymize: false },
    players: {},
    order: [],
    seats: {},
    m1: { txIdx: 0, status: 'idle', step: 0, tried: {}, feedback: null, outcome: null, log: [], done: [] },
    m2: { scIdx: 0, node: null, round: 0, status: 'idle', votes: {}, reveal: null, path: [], done: [] },
    m3: { status: 'idle', marks: {}, clicks: {}, revealIdx: 0, scored: false },
    audit: [],
  };
}

const P = (pid) => S.players[pid];
const seatsOf = (pid) => SEATS.filter((s) => S.seats[s] === pid);
const online = (pid) => P(pid) && Date.now() - (P(pid).lastSeen || 0) < ONLINE_MS;

function assignSeats(shuffle = false) {
  const ids = [...S.order];
  if (shuffle) ids.sort(() => Math.random() - 0.5);
  S.seats = {};
  if (!ids.length) return;
  SEATS.forEach((seat, i) => (S.seats[seat] = ids[i % ids.length]));
}

function addPoints(pid, pts, mod) {
  const p = P(pid);
  if (!p || !pts) return;
  p.score = (p.score || 0) + pts;
  p.mod[mod] = (p.mod[mod] || 0) + pts;
}

function audit(pid, kind, action, detail) {
  S.audit.push({ ts: Date.now(), pid, kind, action, detail: detail || '' });
}

// ───────────────────────── broadcast ─────────────────────────
function publicState() {
  const anon = anonNames();
  return {
    code: S.code,
    phase: S.phase,
    settings: { honeypot: S.settings.honeypot },
    players: S.order.map((pid) => ({ pid, name: P(pid).name, score: P(pid).score, seats: seatsOf(pid), online: online(pid) })),
    m1: {
      txIdx: S.m1.txIdx,
      status: S.m1.status,
      step: S.m1.step,
      feedback: S.m1.feedback,
      outcome: S.m1.status === 'result',
      log: S.m1.log,
    },
    m2: {
      scIdx: S.m2.scIdx,
      node: S.m2.node,
      round: S.m2.round || 0,
      status: S.m2.status,
      voted: Object.keys(S.m2.votes),
      reveal: S.m2.reveal,
    },
    m3: {
      status: S.m3.status,
      revealIdx: S.m3.revealIdx,
      progress: Object.fromEntries(S.order.map((pid) => [pid, Object.keys(S.m3.marks[pid] || {}).length])),
    },
    audit:
      S.phase === 'audit'
        ? S.audit.map((a) => ({ ...a, who: S.settings.anonymize ? anon[a.pid] : P(a.pid)?.name || '?' }))
        : null,
  };
}

function anonNames() {
  const m = {};
  S.order.forEach((pid, i) => (m[pid] = `Employee #${i + 1}`));
  return m;
}

function broadcast(now = false) {
  clearTimeout(bTimer);
  const go = () => {
    S.v++;
    T.publish(chDown(S.code), { t: 'state', v: S.v, s: publicState() });
    store(KEY, S);
  };
  if (now) go();
  else bTimer = setTimeout(go, 35);
  render();
}

// ───────────────────────── inbound ─────────────────────────
function onUp(msg) {
  if (!msg || typeof msg !== 'object') return;
  const pid = typeof msg.pid === 'string' ? msg.pid.slice(0, 40) : null;
  if (!pid) return;

  if (msg.t === 'join') {
    const name = cleanName(msg.name) || 'Player';
    if (!P(pid)) {
      S.players[pid] = { name, score: 0, mod: {}, lastSeen: Date.now() };
      S.order.push(pid);
      audit(pid, 'join', 'Joined the session', '');
      if (S.phase === 'lobby') assignSeats();
      else if (!S.order.some((x) => x !== pid && seatsOf(x).length)) assignSeats();
    } else {
      P(pid).name = name;
      P(pid).lastSeen = Date.now();
    }
    return broadcast(true);
  }

  if (!P(pid)) return; // unknown player: ignore (they'll re-join)
  P(pid).lastSeen = Date.now();

  if (msg.t === 'hello') return broadcast(true);
  if (msg.t !== 'act' || !msg.a || typeof msg.a !== 'object') return;
  const a = msg.a;

  switch (a.k) {
    case 'm1answer':
      return m1Answer(pid, a);
    case 'm2vote':
      return m2Vote(pid, a);
    case 'm3mark':
      return m3Mark(pid, a);
    case 'm3click':
      return m3Click(pid, a);
    case 'browse':
      if (!S.settings.honeypot) return;
      audit(pid, 'browse', 'Opened Member Lookup', 'No task assigned');
      return render();
    case 'lookup': {
      if (!S.settings.honeypot) return;
      const m = LOOKUP_MEMBERS.find((x) => x.id === a.member);
      if (!m) return;
      audit(pid, 'lookup', `Viewed member record: ${m.name}`, `${m.tag} · balances shown · no task assigned`);
      return render();
    }
  }
}

// ───────────────────────── module 1 ─────────────────────────
function m1Start(idx) {
  S.phase = 'm1';
  S.m1 = { ...S.m1, txIdx: idx, status: 'active', step: 0, tried: {}, feedback: null, log: [] };
  broadcast();
}

function m1Answer(pid, a) {
  const m = S.m1;
  const tx = TRANSACTIONS[m.txIdx];
  if (S.phase !== 'm1' || m.status !== 'active' || a.tx !== tx.id || a.step !== m.step) return;
  const st = tx.steps[m.step];
  if (S.seats[st.seat] !== pid) return;
  const o = st.options.find((x) => x.id === a.opt);
  if (!o) return;

  if (st.task && !m.tried[`task${m.step}`]) {
    m.tried[`task${m.step}`] = true;
    const who = (st.info.find((l) => l.startsWith('Member:')) || '').replace('Member: ', '');
    audit(pid, 'task', `Viewed member record: ${who}`, `Assigned task: ${st.task}`);
  }

  m.feedback = { pid, step: m.step, opt: o.id, ok: !!o.ok, at: Date.now() };
  if (!o.ok) {
    m.tried[m.step] = true;
    return broadcast();
  }
  if (!m.tried[m.step]) addPoints(pid, 100, 'm1');
  m.log.push({ step: m.step, pid, opt: o.id, firstTry: !m.tried[m.step] });
  if (o.end || m.step === tx.steps.length - 1) {
    m.status = 'result';
    if (!m.done.includes(m.txIdx)) m.done.push(m.txIdx);
  } else {
    m.step++;
  }
  broadcast();
}

// ───────────────────────── module 2 ─────────────────────────
function m2Start(idx) {
  S.phase = 'm2';
  const sc = SCENARIOS[idx];
  // round: every voting round gets a new number so phones never show a stale "locked in" on a replay.
  S.m2 = { ...S.m2, scIdx: idx, node: sc.start, round: (S.m2.round || 0) + 1, status: 'voting', votes: {}, reveal: null, path: [] };
  broadcast();
}

function m2Vote(pid, a) {
  const m = S.m2;
  const sc = SCENARIOS[m.scIdx];
  if (S.phase !== 'm2' || m.status !== 'voting' || a.sc !== sc.id || a.node !== m.node) return;
  if (!sc.nodes[m.node].options.some((o) => o.id === a.opt)) return;
  m.votes[pid] = a.opt;
  broadcast();
}

function m2Reveal() {
  const m = S.m2;
  if (m.status !== 'voting') return;
  const node = SCENARIOS[m.scIdx].nodes[m.node];
  const counts = {};
  const pts = {};
  node.options.forEach((o) => (counts[o.id] = 0));
  for (const [pid, opt] of Object.entries(m.votes)) {
    counts[opt]++;
    const o = node.options.find((x) => x.id === opt);
    pts[pid] = o.pts;
    addPoints(pid, o.pts, 'm2');
  }
  // The room's most popular answer decides the story. Ties go to the better answer.
  const ranked = [...node.options].sort((x, y) => counts[y.id] - counts[x.id] || y.pts - x.pts);
  m.reveal = { counts, pts, choice: ranked[0].id };
  m.status = 'revealed';
  broadcast();
}

function m2Continue() {
  const m = S.m2;
  const sc = SCENARIOS[m.scIdx];
  if (m.status !== 'revealed') return;
  const o = sc.nodes[m.node].options.find((x) => x.id === m.reveal.choice);
  m.path.push({ node: m.node, opt: o.id });
  if (o.end) {
    m.status = 'done';
    if (!m.done.includes(m.scIdx)) m.done.push(m.scIdx);
  } else {
    m.node = o.next;
    m.round = (m.round || 0) + 1;
    m.status = 'voting';
    m.votes = {};
    m.reveal = null;
  }
  broadcast();
}

// ───────────────────────── module 3 ─────────────────────────
function m3Mark(pid, a) {
  if (S.phase !== 'm3' || S.m3.status !== 'open') return;
  if (!EMAILS.some((e) => e.id === a.email) || !['phish', 'legit'].includes(a.verdict)) return;
  (S.m3.marks[pid] ||= {})[a.email] = a.verdict;
  broadcast();
}

function m3Click(pid, a) {
  if (S.phase !== 'm3') return;
  const e = EMAILS.find((x) => x.id === a.email);
  if (!e || !e.link) return;
  const c = (S.m3.clicks[pid] ||= {});
  if (c[e.id]) return;
  c[e.id] = Date.now();
  audit(pid, e.verdict === 'phish' ? 'click' : 'clickok', `Clicked link in "${e.subject}"`, e.link.url);
  render();
}

function m3Reveal() {
  const m = S.m3;
  if (!m.scored) {
    for (const pid of S.order) {
      const marks = m.marks[pid] || {};
      EMAILS.forEach((e) => marks[e.id] === e.verdict && addPoints(pid, 100, 'm3'));
      Object.keys(m.clicks[pid] || {}).forEach((id) => {
        if (EMAILS.find((e) => e.id === id).verdict === 'phish') addPoints(pid, -50, 'm3');
      });
    }
    m.scored = true;
  }
  m.status = 'reveal';
  m.revealIdx = 0;
  broadcast();
}

// ───────────────────────── rendering ─────────────────────────
const nameOf = (pid) => esc(P(pid)?.name || '—');

function render() {
  if (!S) return;
  $('#code').textContent = S.code;
  setHtml('#tabs', PHASES.map(
    ([k, label]) => `<button class="tab ${S.phase === k ? 'on' : ''}" data-act="phase" data-v="${k}">${label}</button>`
  ).join(''));
  renderSide();
  const fn = { lobby: rLobby, m1: rM1, m2: rM2, m3: rM3, audit: rAudit, podium: rPodium }[S.phase];
  const [stage, controls] = fn();
  setHtml('#stage', stage);
  setHtml('#controls', controls);
  $('#stage').dataset.phase = S.phase;
}

const htmlCache = {};
function setHtml(sel, html) {
  if (htmlCache[sel] === html) return;
  htmlCache[sel] = html;
  $(sel).innerHTML = html;
}

function renderSide() {
  const ps = S.order
    .map((pid) => {
      const p = P(pid);
      const seats = seatsOf(pid).map((s) => SEAT_ICON[s]).join('');
      return `<li class="pl ${online(pid) ? 'on' : 'off'}">
        <span class="dot"></span><span class="nm">${esc(p.name)}</span>
        <span class="seats">${seats}</span><b class="sc">${p.score}</b>
        <button class="x" title="Remove" data-act="kick" data-v="${pid}">×</button></li>`;
    })
    .join('');
  const hp = S.settings.honeypot;
  const hpCount = S.audit.filter((a) => a.kind === 'browse' || a.kind === 'lookup').length;
  setHtml('#side', `
    <h3>Players <span class="count">${S.order.length}</span></h3>
    <ul class="players">${ps || '<li class="empty">Waiting for players…</li>'}</ul>
    ${S.phase !== 'lobby' ? `<div class="mini-join"><div class="qr sm">${qrSvg()}</div><div><small>Join</small><b>${esc(joinHost())}</b><span class="code">${S.code}</span></div></div>` : ''}
    <div class="settings">
      <label class="toggle"><input type="checkbox" data-act="honeypot" ${hp ? 'checked' : ''}><span></span> Member Lookup button on phones</label>
      <label class="toggle"><input type="checkbox" data-act="anon" ${S.settings.anonymize ? 'checked' : ''}><span></span> Anonymize audit log</label>
      <p class="hp-note">${hp ? `Lookup events logged: <b>${hpCount}</b>` : 'Lookup button is hidden.'}</p>
      <button class="ghost sm" data-act="shuffle">Shuffle seats</button>
      <button class="ghost sm danger" data-act="newsession">New session</button>
    </div>`);
}

function joinUrl() {
  const u = new URL(location.origin + '/');
  u.searchParams.set('code', S.code);
  const qs = new URLSearchParams(location.search);
  if (qs.get('local') === '1') u.searchParams.set('local', '1');
  if (qs.get('realtimeUrl')) u.searchParams.set('realtimeUrl', qs.get('realtimeUrl'));
  return u.toString();
}
const joinHost = () => location.host;

let qrCache = { url: null, svg: '' };
function qrSvg() {
  const url = joinUrl();
  if (qrCache.url !== url) {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    qrCache = { url, svg: q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) };
  }
  return qrCache.svg;
}

function seatBoard(labels) {
  return `<div class="seatboard">${SEATS.map((s) => {
    const pid = S.seats[s];
    return `<div class="seat"><span class="ic">${SEAT_ICON[s]}</span><small>${esc(labels ? labels[s] : seatName(s))}</small><b>${pid ? nameOf(pid) : '—'}</b></div>`;
  }).join('')}</div>`;
}
const seatName = (s) => ({ member: 'Seat A · Member', front: 'Seat B · Front door', network: 'Seat C · The network', core: 'Seat D · Core system' }[s]);

function rLobby() {
  const stage = `
    <div class="lobby">
      <div class="join-card">
        <div class="qr">${qrSvg()}</div>
        <div class="join-text">
          <p class="eyebrow">Grab your phone</p>
          <h1>Scan to join</h1>
          <p class="url">${esc(joinHost())}</p>
          <p class="code-label">Game code</p>
          <p class="bigcode">${S.code.split('').map((c) => `<span>${c}</span>`).join('')}</p>
        </div>
      </div>
      <div class="lobby-right">
        <h2>Who's here</h2>
        <div class="chips">${S.order.map((pid) => `<span class="chip ${online(pid) ? '' : 'off'}">${nameOf(pid)}</span>`).join('') || '<p class="muted">Nobody yet…</p>'}</div>
        <h2>Your seats in the network</h2>
        ${seatBoard()}
        <p class="muted">Each seat plays a different system in Module 1. Seats stay the same; what they do changes with each transaction.</p>
      </div>
    </div>`;
  const controls = `<span class="hint">${S.order.length} joined</span>
    <button class="primary" data-act="m1start" data-v="0">Start Module 1 ▶</button>`;
  return [stage, controls];
}

function flowDiagram(tx, m) {
  const seatsInFlow = [];
  tx.steps.forEach((st) => !seatsInFlow.includes(st.seat) && seatsInFlow.push(st.seat));
  const cur = m.status === 'active' ? tx.steps[m.step].seat : null;
  const doneSeats = new Set(m.log.map((l) => tx.steps[l.step].seat));
  const cutIdx = tx.cut ? tx.steps.findIndex((s) => s.seat === tx.cut) : -1;
  const cutNow = tx.cut && (m.step >= cutIdx || m.status === 'result');
  return `<div class="flow">${SEATS.map((s, i) => {
    const inFlow = seatsInFlow.includes(s);
    const cls = [
      'node',
      !inFlow ? 'unused' : '',
      cur === s ? 'active' : '',
      doneSeats.has(s) && cur !== s ? 'done' : '',
      cutNow && s === tx.cut ? 'cut' : '',
    ].join(' ');
    const link = i < SEATS.length - 1
      ? `<div class="link ${cutNow && (s === tx.cut || SEATS[i + 1] === tx.cut) ? 'broken' : ''} ${cur && (cur === s || cur === SEATS[i + 1]) ? 'live' : ''}"><i></i></div>`
      : '';
    return `<div class="${cls}"><div class="bubble">${SEAT_ICON[s]}</div><b>${esc(tx.labels[s])}</b><small>${S.seats[s] ? nameOf(S.seats[s]) : '—'}</small></div>${link}`;
  }).join('')}</div>`;
}

function rM1() {
  const m = S.m1;
  const tx = TRANSACTIONS[m.txIdx];
  const chips = TRANSACTIONS.map(
    (t, i) => `<button class="chipbtn ${i === m.txIdx ? 'on' : ''} ${m.done.includes(i) ? 'done' : ''}" data-act="m1start" data-v="${i}">${i + 1}. ${esc(t.title)}</button>`
  ).join('');

  let body = '';
  if (m.status === 'idle') {
    body = `<div class="center-msg"><p class="eyebrow">Module 1</p><h1>Route It</h1><p>Every card swipe and every teller transaction travels through several systems. Your phone is one of them.</p>${seatBoard()}</div>`;
  } else {
    const st = tx.steps[m.step];
    const fb = m.feedback;
    let fbHtml = '';
    if (fb) {
      const fst = tx.steps[fb.step];
      const o = fst.options.find((x) => x.id === fb.opt);
      fbHtml = `<div class="feedback ${fb.ok ? 'ok' : 'bad'}"><b>${nameOf(fb.pid)} (${esc(tx.labels[fst.seat])}):</b> “${esc(o.label)}”<p>${esc(o.fb)}</p></div>`;
    }
    const stepCard =
      m.status === 'active'
        ? `<div class="stepcard"><p class="eyebrow">${SEAT_ICON[st.seat]} ${esc(tx.labels[st.seat])} · ${nameOf(S.seats[st.seat])} is deciding…</p>
            <p class="prompt">${esc(st.prompt)}</p>${st.info.length ? `<ul class="info">${st.info.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>`
        : `<div class="outcome ${tx.outcome.result}"><h2>${esc(tx.outcome.headline)}</h2><p>${esc(tx.outcome.lesson)}</p></div>`;
    body = `<div class="txhead"><div><p class="eyebrow">Transaction ${m.txIdx + 1} of ${TRANSACTIONS.length}</p><h1>${esc(tx.title)}</h1><p class="muted">${esc(tx.teaser)}</p></div><div class="amount">${esc(tx.amount)}</div></div>
      ${flowDiagram(tx, m)}
      <div class="m1grid">${stepCard}${fbHtml}</div>`;
  }
  const next = m.txIdx + 1 < TRANSACTIONS.length;
  const controls = `<div class="chiprow">${chips}</div>
    ${m.status === 'active' ? `<button class="ghost" data-act="m1start" data-v="${m.txIdx}">Restart</button>` : ''}
    ${m.status === 'result' && next ? `<button class="primary" data-act="m1start" data-v="${m.txIdx + 1}">Next transaction ▶</button>` : ''}
    ${m.status === 'idle' ? `<button class="primary" data-act="m1start" data-v="${m.txIdx}">Start transaction ${m.txIdx + 1} ▶</button>` : ''}
    ${m.status === 'result' && !next ? `<button class="primary" data-act="phase" data-v="m2">On to Module 2 ▶</button>` : ''}`;
  return [`<div class="m1">${body}</div>`, controls];
}

function methodBar(active) {
  return `<ol class="method">${METHOD.map((s) => `<li class="${active === s ? 'on' : ''}">${esc(s)}</li>`).join('')}</ol>`;
}

function rM2() {
  const m = S.m2;
  const sc = SCENARIOS[m.scIdx];
  const chips = SCENARIOS.map(
    (s, i) => `<button class="chipbtn ${i === m.scIdx ? 'on' : ''} ${m.done.includes(i) ? 'done' : ''}" data-act="m2start" data-v="${i}">${s.icon} ${esc(s.title)}</button>`
  ).join('');
  let body = '';
  if (m.status === 'idle') {
    body = `<div class="center-msg"><p class="eyebrow">Module 2</p><h1>Help Desk</h1><p>Something breaks. Everyone picks a first move on their phone. The room's most popular choice decides what happens next.</p>${methodBar()}</div>`;
  } else if (m.status === 'done') {
    const steps = m.path.map(({ node, opt }) => {
      const n = sc.nodes[node];
      const o = n.options.find((x) => x.id === opt);
      return `<li><span>${esc(n.text)}</span><b>→ ${esc(o.label)}</b></li>`;
    });
    body = `<div class="scen"><p class="eyebrow">${sc.icon} ${esc(sc.title)} · how it played out</p><ol class="pathlist">${steps.join('')}</ol>${methodBar()}</div>`;
  } else {
    const node = sc.nodes[m.node];
    const voted = Object.keys(m.votes).length;
    let opts = '';
    if (m.status === 'voting') {
      opts = `<div class="votegrid">${node.options.map((o, i) => `<div class="vopt"><span class="letter">${String.fromCharCode(65 + i)}</span>${esc(o.label)}</div>`).join('')}</div>
        <div class="lockins">${S.order.map((pid) => `<span class="chip ${m.votes[pid] ? 'locked' : ''}">${m.votes[pid] ? '🔒 ' : ''}${nameOf(pid)}</span>`).join('')}</div>`;
    } else {
      const total = Math.max(1, voted);
      opts = `<div class="results">${node.options.map((o, i) => {
        const c = m.reveal.counts[o.id] || 0;
        const chosen = m.reveal.choice === o.id;
        const who = Object.entries(m.votes).filter(([, v]) => v === o.id).map(([pid]) => nameOf(pid)).join(', ');
        return `<button class="ropt pts${o.pts} ${chosen ? 'chosen' : ''}" data-act="m2choose" data-v="${o.id}">
          <div class="rtop"><span class="letter">${String.fromCharCode(65 + i)}</span><span class="rl">${esc(o.label)}</span><span class="rp">${o.pts > 0 ? '+' + o.pts : '0'}</span></div>
          <div class="bar"><i style="width:${(c / total) * 100}%"></i><em>${c}${who ? ' · ' + who : ''}</em></div>
          <p class="rfb">${o.step ? `<span class="steptag">${esc(o.step)}</span>` : ''}${esc(o.fb)}</p></button>`;
      }).join('')}</div>`;
    }
    const stepHint = m.status === 'revealed' ? node.options.find((o) => o.pts === 100)?.step : null;
    body = `<div class="scen"><p class="eyebrow">${sc.icon} ${esc(sc.title)}</p><p class="prompt big">${esc(node.text)}</p>${opts}${methodBar(stepHint)}</div>`;
  }
  const nextIdx = m.scIdx + 1 < SCENARIOS.length ? m.scIdx + 1 : null;
  const voted = Object.keys(m.votes).length;
  const controls = `<div class="chiprow">${chips}</div>
    ${m.status === 'idle' ? `<button class="primary" data-act="m2start" data-v="${m.scIdx}">Start scenario ▶</button>` : ''}
    ${m.status === 'voting' ? `<span class="hint">${voted}/${S.order.length} locked in</span><button class="primary" data-act="m2reveal">Reveal</button>` : ''}
    ${m.status === 'revealed' ? `<span class="hint">Click an answer to steer the story</span><button class="primary" data-act="m2continue">Continue ▶</button>` : ''}
    ${m.status === 'done' && nextIdx !== null ? `<button class="primary" data-act="m2start" data-v="${nextIdx}">Next scenario ▶</button>` : ''}
    ${m.status === 'done' && nextIdx === null ? `<button class="primary" data-act="phase" data-v="m3">On to Module 3 ▶</button>` : ''}`;
  return [`<div class="m2">${body}</div>`, controls];
}

function rM3() {
  const m = S.m3;
  let body = '';
  let controls = '';
  if (m.status === 'idle') {
    body = `<div class="center-msg"><p class="eyebrow">Module 3</p><h1>The Inbox</h1><p>You're a teller. Eight emails just landed. Some are real. Some are trying to get your login. Inspect every sender and every link before you decide.</p>
      <div class="rules"><span>🔍 Inspect = safe</span><span>👆 Click a phishing link = −50</span><span>✅ Correct call = +100</span></div></div>`;
    controls = `<button class="primary" data-act="m3open">Open the inbox ▶</button>`;
  } else if (m.status === 'open') {
    const head = EMAILS.map((e, i) => `<th title="${esc(e.subject)}">${i + 1}</th>`).join('');
    const rows = S.order.map((pid) => {
      const marks = m.marks[pid] || {};
      const clicks = m.clicks[pid] || {};
      return `<tr><td class="nm">${nameOf(pid)}</td>${EMAILS.map((e) => `<td>${marks[e.id] ? '●' : '○'}${clicks[e.id] ? '<sup>👆</sup>' : ''}</td>`).join('')}<td class="n">${Object.keys(marks).length}/${EMAILS.length}</td></tr>`;
    }).join('');
    body = `<div class="center-msg"><p class="eyebrow">Module 3 · The Inbox</p><h1>Sort your inbox</h1><p>Phish or legit? Check the sender. Inspect the link. Then decide.</p>
      <table class="progress"><thead><tr><th></th>${head}<th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">● = decided · 👆 = clicked a link</p></div>`;
    controls = `<button class="primary" data-act="m3reveal">Reveal answers ▶</button>`;
  } else {
    const i = m.revealIdx;
    if (i >= EMAILS.length) {
      const rows = [...S.order].sort((a, b) => (P(b).mod.m3 || 0) - (P(a).mod.m3 || 0))
        .map((pid) => `<li><span>${nameOf(pid)}</span><b>${P(pid).mod.m3 || 0}</b></li>`).join('');
      body = `<div class="center-msg"><p class="eyebrow">Module 3 results</p><h1>Inbox scores</h1><ol class="ranklist">${rows}</ol></div>`;
      controls = `<button class="ghost" data-act="m3idx" data-v="${i - 1}">◀ Back</button><button class="primary" data-act="phase" data-v="audit">Audit log ▶</button>`;
    } else {
      const e = EMAILS[i];
      const right = S.order.filter((pid) => (m.marks[pid] || {})[e.id] === e.verdict).length;
      const clickers = S.order.filter((pid) => (m.clicks[pid] || {})[e.id]).map(nameOf);
      body = `<div class="reveal-email">
        <div class="mail">
          <div class="mhead"><div class="avatar">${esc(e.fromName[0])}</div><div><b>${esc(e.fromName)}</b><span class="addr">&lt;${esc(e.fromAddr)}&gt;</span><p class="subj">${esc(e.subject)}</p></div><span class="time">${esc(e.time)}</span></div>
          <div class="mbody">${e.body.map((p) => `<p>${esc(p)}</p>`).join('')}
          ${e.link ? `<p><span class="fakebtn">${esc(e.link.text)}</span></p><p class="realurl">Link really goes to: <code>${esc(e.link.url)}</code></p>` : '<p class="muted">(No links or attachments)</p>'}</div>
        </div>
        <div class="verdict ${e.verdict}">
          <div class="stamp">${e.verdict === 'phish' ? 'PHISH 🎣' : 'LEGIT ✅'}</div>
          <ul>${e.clues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          <p class="tally"><b>${right}/${S.order.length}</b> got it right${clickers.length ? ` · clicked the link: ${clickers.join(', ')}` : ''}</p>
        </div></div>`;
      controls = `<span class="hint">Email ${i + 1} of ${EMAILS.length}</span>
        ${i > 0 ? `<button class="ghost" data-act="m3idx" data-v="${i - 1}">◀ Back</button>` : ''}
        <button class="primary" data-act="m3idx" data-v="${i + 1}">${i + 1 < EMAILS.length ? 'Next email ▶' : 'Scores ▶'}</button>`;
    }
  }
  return [`<div class="m3">${body}</div>`, controls];
}

function rAudit() {
  const anon = anonNames();
  const who = (pid) => esc(S.settings.anonymize ? anon[pid] : P(pid)?.name || '?');
  const rows = S.audit.filter((a) => a.kind !== 'join');
  const kindLabel = {
    task: ['Job task', 'ok'],
    browse: ['No task', 'flag'],
    lookup: ['No task', 'flag'],
    click: ['Phishing link', 'flag'],
    clickok: ['Link', 'neutral'],
  };
  const curious = rows.filter((a) => a.kind === 'browse' || a.kind === 'lookup').length;
  const tasks = rows.filter((a) => a.kind === 'task').length;
  const tr = rows.map((a) => {
    const [lbl, cls] = kindLabel[a.kind] || ['', ''];
    return `<tr class="${cls}"><td class="t">${fmtTime(a.ts)}</td><td>${who(a.pid)}</td><td>${esc(a.action)}</td><td class="d">${esc(a.detail)}</td><td><span class="tag ${cls}">${lbl}</span></td></tr>`;
  }).join('');
  const verdict = !S.settings.honeypot
    ? ''
    : curious === 0
      ? `<div class="banner good">No curiosity lookups. Every record viewed had a job reason. That's exactly right.</div>`
      : `<div class="banner warn">${curious} Member Lookup action${curious > 1 ? 's' : ''} with no assigned task. In the real system, every one of these is visible to a reviewer.</div>`;
  const stage = `<div class="audit">
    <div class="audit-head"><div><p class="eyebrow">How access is controlled</p><h1>The system remembers who looked.</h1></div>
    <div class="stats"><div><b>${tasks}</b><small>Job-task views</small></div><div class="f"><b>${curious}</b><small>No-task views</small></div></div></div>
    ${verdict}
    <div class="tablewrap"><table class="auditlog"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th><th></th></tr></thead><tbody>${tr || '<tr><td colspan="5" class="muted">No activity logged yet.</td></tr>'}</tbody></table></div>
  </div>`;
  const controls = `<label class="toggle inline"><input type="checkbox" data-act="anon" ${S.settings.anonymize ? 'checked' : ''}><span></span> Anonymize</label>
    <button class="primary" data-act="phase" data-v="podium">Final standings ▶</button>`;
  return [stage, controls];
}

function rPodium() {
  const ranked = [...S.order].sort((a, b) => P(b).score - P(a).score);
  const top = ranked.slice(0, 3);
  const podium = [1, 0, 2].filter((i) => top[i]).map((i) => `<div class="pod p${i + 1}"><b>${nameOf(top[i])}</b><span>${P(top[i]).score}</span><div class="block">${i + 1}</div></div>`).join('');
  const rest = ranked.slice(3).map((pid, i) => `<li><span>${i + 4}. ${nameOf(pid)}</span><b>${P(pid).score}</b></li>`).join('');
  const stage = `<div class="podium-wrap"><p class="eyebrow">Final standings</p><h1>Mahalo for playing!</h1><div class="podium">${podium}</div>${rest ? `<ol class="ranklist">${rest}</ol>` : ''}</div>`;
  return [stage, `<button class="ghost" data-act="phase" data-v="audit">◀ Audit log</button>`];
}

// ───────────────────────── host controls ─────────────────────────
function onClick(ev) {
  const b = ev.target.closest('[data-act]');
  if (!b || b.tagName === 'INPUT') return;
  const v = b.dataset.v;
  switch (b.dataset.act) {
    case 'phase':
      S.phase = v;
      if (v === 'm1' && S.m1.status === 'idle') S.m1.txIdx = 0;
      return broadcast();
    case 'm1start':
      return m1Start(Number(v));
    case 'm2start':
      return m2Start(Number(v));
    case 'm2reveal':
      return m2Reveal();
    case 'm2choose':
      if (S.m2.status === 'revealed') { S.m2.reveal.choice = v; broadcast(); }
      return;
    case 'm2continue':
      return m2Continue();
    case 'm3open':
      S.m3.status = 'open';
      return broadcast();
    case 'm3reveal':
      if (confirm('Reveal answers? Phones lock their choices.')) m3Reveal();
      return;
    case 'm3idx':
      S.m3.revealIdx = Math.max(0, Math.min(EMAILS.length, Number(v)));
      return broadcast();
    case 'shuffle':
      assignSeats(true);
      return broadcast();
    case 'kick':
      if (!confirm(`Remove ${P(v)?.name}?`)) return;
      delete S.players[v];
      S.order = S.order.filter((x) => x !== v);
      assignSeats();
      return broadcast();
    case 'newsession':
      if (!confirm('Start a brand-new session? Current scores and the audit log will be cleared.')) return;
      S = freshState(newCode());
      return startChannels();
  }
}

function onChange(ev) {
  const t = ev.target;
  if (t.dataset.act === 'honeypot') S.settings.honeypot = t.checked;
  else if (t.dataset.act === 'anon') S.settings.anonymize = t.checked;
  else return;
  broadcast();
}

// ───────────────────────── boot ─────────────────────────
let subscribedCode = null;
function startChannels() {
  if (subscribedCode !== S.code) {
    subscribedCode = S.code;
    T.subscribe(chUp(S.code), onUp, () => broadcast(true));
  }
  broadcast(true);
}

async function boot() {
  cfg = await loadConfig();
  if (!cfg) {
    $('#stage').innerHTML = `<div class="center-msg"><h1>Game is offline</h1><p>The real-time service isn't deployed right now. Deploy the Game stack, then refresh.</p></div>`;
    return;
  }
  T = createTransport(cfg);
  const net = $('#net');
  T.onStatus((s) => (net.dataset.status = s));

  const saved = store(KEY);
  const fresh = saved && Date.now() - saved.created < 12 * 3600 * 1000;
  S = fresh ? saved : freshState(newCode());
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  startChannels();
  // Safety net: rebroadcast periodically so late or reconnected phones always converge.
  setInterval(() => S && T.publish(chDown(S.code), { t: 'state', v: ++S.v, s: publicState() }), 8000);
  setInterval(() => renderSide(), 5000);
  window.__socuHost = { get state() { return S; } }; // test hook
}

boot();
