// SESSION REPORT. Reads the host's saved session from this browser (the TV) and lays it out
// for printing: results, answer log, audit log, and a certificate for the top scorer(s).
// "Save as PDF" is the browser's print dialog, so the PDF keeps real, selectable text.
// Every interpolated value goes through esc(), same as host.js and player.js.
import { EMAILS, TRANSACTIONS, SCENARIOS } from './content.js';
import { esc, $, store } from './common.js';

const S = store('socu-host-session');
const qs = new URLSearchParams(location.search);
const certOnly = qs.get('view') === 'cert';
let anon = false; // the report is the trainer's record: real names unless toggled (the TV's setting is for the room)

const MOD = { m1: 'Route It', m2: 'Help Desk', m3: 'The Inbox' };
const RESULT = {
  correct: ['Correct', 'ok'],
  partial: ['Partial', 'mid'],
  wrong: ['Wrong', 'bad'],
  missed: ['No answer', 'none'],
};
const AUDIT_KIND = {
  task: ['Job task', 'ok'],
  browse: ['No task', 'bad'],
  lookup: ['No task', 'bad'],
  click: ['Phishing link', 'bad'],
  clickok: ['Link', 'none'],
};

const dateLong = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function nameOf(pid, saved) {
  const i = S.order.indexOf(pid);
  if (anon) return i >= 0 ? `Employee #${i + 1}` : 'Employee (removed)';
  return S.players[pid]?.name || saved || '(removed)';
}

// Standard competition ranking: ties share a rank (1, 1, 3).
function standings() {
  const list = S.order.map((pid) => ({ pid, ...S.players[pid] })).sort((a, b) => b.score - a.score);
  list.forEach((p, i) => (p.rank = i && p.score === list[i - 1].score ? list[i - 1].rank : i + 1));
  return list;
}

function statsFor(pid) {
  const mine = S.answers.filter((a) => a.pid === pid);
  const n = (mod, res) => mine.filter((a) => a.mod === mod && (!res || res.includes(a.result))).length;
  return {
    m1First: n('m1', ['correct']),
    m1Steps: n('m1', ['correct', 'partial']),
    m2Best: n('m2', ['correct']),
    m2Rounds: n('m2'),
    m3Right: n('m3', ['correct']),
    clicks: mine.filter((a) => a.mod === 'm3' && a.choice === 'Clicked the link').length,
  };
}

function lastActivity() {
  const ts = [...S.answers, ...S.audit].map((x) => x.ts);
  return ts.length ? Math.max(...ts) : S.created;
}

// ───────────────────────── sections ─────────────────────────
function cover(ranked) {
  const winners = ranked.filter((p) => p.rank === 1 && p.score > 0);
  const lookups = S.audit.filter((a) => a.kind === 'browse' || a.kind === 'lookup').length;
  const clicks = S.audit.filter((a) => a.kind === 'click').length;
  const graded = S.answers.filter((a) => a.result !== 'missed' && a.choice !== 'Clicked the link');
  const acc = graded.length ? Math.round((100 * graded.filter((a) => a.result === 'correct').length) / graded.length) : null;
  const mins = Math.max(1, Math.round((lastActivity() - S.created) / 60000));
  return `<header class="r-cover">
      <img src="/img/logo-full.png" alt="Maui County Federal Credit Union" class="r-logo">
      <p class="r-eyebrow">Student-Operated Credit Union</p>
      <h1>Systems &amp; Data Security Training</h1>
      <p class="r-sub">Session report · ${esc(dateLong(S.created))}</p>
      <dl class="r-meta">
        <div><dt>Session</dt><dd>${esc(S.code)}</dd></div>
        <div><dt>Players</dt><dd>${S.order.length}</dd></div>
        <div><dt>Time played</dt><dd>${time(S.created)}–${time(lastActivity())} (${mins} min)</dd></div>
        <div><dt>Completed</dt><dd>Route It ${S.m1.done.length}/${TRANSACTIONS.length} · Help Desk ${S.m2.done.length}/${SCENARIOS.length} · Inbox ${S.m3.scored ? 'scored' : 'not scored'}</dd></div>
      </dl>
      <div class="r-highlights">
        <div class="hl gold"><b>${winners.length ? esc(winners.map((p) => nameOf(p.pid)).join(' & ')) : '—'}</b><small>Top score${winners.length ? ` · ${winners[0].score} pts` : ''}</small></div>
        <div class="hl"><b>${acc === null ? '—' : acc + '%'}</b><small>Answers correct, all modules</small></div>
        <div class="hl ${lookups ? 'warn' : ''}"><b>${lookups}</b><small>No-task Member Lookups</small></div>
        <div class="hl ${clicks ? 'warn' : ''}"><b>${clicks}</b><small>Phishing links clicked</small></div>
      </div>
    </header>`;
}

function results(ranked) {
  const rows = ranked.map((p) => {
    const s = statsFor(p.pid);
    return `<tr class="${p.rank === 1 && p.score > 0 ? 'top' : ''}">
      <td class="rk"><span class="medal m${p.rank}">${p.rank}</span></td><td class="nm">${esc(nameOf(p.pid))}</td>
      <td class="n">${p.mod.m1 || 0}<small>${s.m1First}/${s.m1Steps} first try</small></td>
      <td class="n">${p.mod.m2 || 0}<small>${s.m2Best}/${s.m2Rounds} best answer</small></td>
      <td class="n">${p.mod.m3 || 0}<small>${s.m3Right}/${EMAILS.length} sorted right${s.clicks ? ` · ${s.clicks} click${s.clicks > 1 ? 's' : ''}` : ''}</small></td>
      <td class="n total">${p.score}</td></tr>`;
  }).join('');
  return `<section class="r-sec">
    <h2>Final standings</h2>
    <table class="r-table r-results"><thead><tr><th></th><th>Player</th><th class="n">${MOD.m1}</th><th class="n">${MOD.m2}</th><th class="n">${MOD.m3}</th><th class="n">Total</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">No players.</td></tr>'}</tbody></table>
    <p class="r-note">Route It: +100 for a correct first try, 0 after a miss. Help Desk: 100 for the best answer, partial credit for reasonable ones. Inbox: +100 per correct call, −50 per phishing link clicked.</p>
  </section>`;
}

function inboxSummary() {
  if (!S.m3.scored) return '';
  const rows = EMAILS.map((e, i) => {
    const right = S.order.filter((pid) => (S.m3.marks[pid] || {})[e.id] === e.verdict).length;
    const clickers = S.order.filter((pid) => (S.m3.clicks[pid] || {})[e.id]).map((pid) => nameOf(pid));
    const pct = S.order.length ? right / S.order.length : 0;
    return `<tr><td class="rk">${i + 1}</td><td>${esc(e.subject)}<small>${esc(e.fromAddr)}</small></td>
      <td><span class="tag ${e.verdict === 'phish' ? 'bad' : 'ok'}">${e.verdict === 'phish' ? 'Phish' : 'Legit'}</span></td>
      <td class="n"><span class="meter"><i style="width:${pct * 100}%"></i></span>${right}/${S.order.length}</td>
      <td>${clickers.length ? esc(clickers.join(', ')) : '—'}</td></tr>`;
  }).join('');
  return `<section class="r-sec">
    <h2>The Inbox, email by email</h2>
    <table class="r-table"><thead><tr><th></th><th>Email</th><th>Answer</th><th class="n">Got it right</th><th>Clicked the link</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

function answerLog() {
  const groups = ['m1', 'm2', 'm3'].map((mod) => {
    const rows = S.answers.filter((a) => a.mod === mod);
    if (!rows.length) return '';
    const tr = rows.map((a) => {
      const [lbl, cls] = RESULT[a.result] || ['', ''];
      return `<tr><td class="t">${time(a.ts)}</td><td class="nm">${esc(nameOf(a.pid, a.name))}</td>
        <td>${esc(a.item)}<small>${esc(a.question)}</small></td><td>${esc(a.choice)}</td>
        <td><span class="tag ${cls}">${lbl}</span></td><td class="n">${a.pts > 0 ? '+' + a.pts : a.pts}</td></tr>`;
    }).join('');
    const right = rows.filter((a) => a.result === 'correct').length;
    return `<h3>${MOD[mod]} <span class="count">${right} correct of ${rows.length}</span></h3>
      <table class="r-table r-log"><thead><tr><th>Time</th><th>Player</th><th>Question</th><th>Answer</th><th>Result</th><th class="n">Pts</th></tr></thead><tbody>${tr}</tbody></table>`;
  }).join('');
  return `<section class="r-sec r-break">
    <h2>Answer log</h2>
    <p class="r-note">Every answer, in order. In Route It, a wrong answer is followed by a retry; "Partial" means correct on a later try.</p>
    ${groups || '<p class="muted">No answers recorded yet.</p>'}
  </section>`;
}

function auditLog() {
  const rows = S.audit.filter((a) => a.kind !== 'join');
  const tasks = rows.filter((a) => a.kind === 'task').length;
  const curious = rows.filter((a) => a.kind === 'browse' || a.kind === 'lookup').length;
  const tr = rows.map((a) => {
    const [lbl, cls] = AUDIT_KIND[a.kind] || ['', ''];
    return `<tr><td class="t">${time(a.ts)}</td><td class="nm">${esc(nameOf(a.pid, a.name))}</td><td>${esc(a.action)}</td>
      <td class="d">${esc(a.detail)}</td><td><span class="tag ${cls}">${lbl}</span></td></tr>`;
  }).join('');
  const verdict = !S.settings.honeypot
    ? '<p class="r-note">Member Lookup was turned off for this session.</p>'
    : curious
      ? `<p class="r-banner warn">${curious} Member Lookup action${curious > 1 ? 's' : ''} with no assigned task. In the real system, every one of these is visible to a reviewer.</p>`
      : '<p class="r-banner good">No curiosity lookups. Every record viewed had a job reason.</p>';
  return `<section class="r-sec r-break">
    <h2>Audit log</h2>
    <div class="r-stats"><div><b>${tasks}</b><small>Job-task record views</small></div><div class="${curious ? 'warn' : ''}"><b>${curious}</b><small>No-task lookups</small></div></div>
    ${verdict}
    <table class="r-table r-log"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th><th></th></tr></thead>
    <tbody>${tr || '<tr><td colspan="5" class="muted">No activity logged.</td></tr>'}</tbody></table>
    <p class="r-note">All members, balances and records in this game are fictional.</p>
  </section>`;
}

// Certificates always use real names: they're for the winner to keep.
function certificates(ranked) {
  const winners = ranked.filter((p) => p.rank === 1 && p.score > 0);
  if (!winners.length) return certOnly ? '<p class="r-empty">No scores yet, so there is no winner to certify.</p>' : '';
  const tie = winners.length > 1;
  // Full names run up to 32 characters; step the type down so long ones stay on one line.
  const size = (name) => (name.length > 24 ? 'xlong' : name.length > 16 ? 'long' : '');
  return winners.map((p) => `<section class="cert">
      <div class="cert-frame">
        <img src="/img/logo-full.png" alt="Maui County Federal Credit Union" class="cert-logo">
        <p class="cert-kicker">Certificate of Achievement</p>
        <p class="cert-small">This certificate is proudly presented to</p>
        <h1 class="cert-name ${size(S.players[p.pid].name)}">${esc(S.players[p.pid].name)}</h1>
        <p class="cert-body">for earning the ${tie ? 'shared ' : ''}top score of <b>${p.score} points</b> in the<br>Student-Operated Credit Union Systems &amp; Data Security Training</p>
        <div class="cert-seal"><span>Top<br>Score</span></div>
        <div class="cert-sign">
          <div><span class="line"></span><small>Trainer</small></div>
          <div><span class="date">${esc(dateLong(S.created))}</span><small>Date</small></div>
          <div><span class="line"></span><small>SOCU Supervisor</small></div>
        </div>
      </div>
    </section>`).join('');
}

// ───────────────────────── page ─────────────────────────
function render() {
  const ranked = standings();
  $('#doc').innerHTML = certOnly
    ? certificates(ranked)
    : `<div class="r-body">${cover(ranked)}${results(ranked)}${inboxSummary()}${answerLog()}${auditLog()}</div>${certificates(ranked)}`;
  document.title = certOnly ? `Certificate · ${S.code}` : `SOCU Training Report · ${S.code}`;
}

function toolbar() {
  $('#toolbar').innerHTML = `
    <button class="primary" id="print">⬇ Save as PDF</button>
    ${certOnly ? '<a href="/report.html">Full report</a>' : `<a href="/report.html?view=cert">Certificate only</a>
      <label class="toggle inline"><input type="checkbox" id="anon" ${anon ? 'checked' : ''}><span></span> Anonymize names</label>`}
    <p class="hint">In the print window, choose <b>Save as PDF</b> and turn off <b>Headers and footers</b>.</p>`;
  $('#print').onclick = () => window.print();
  const box = $('#anon');
  if (box) box.onchange = () => { anon = box.checked; render(); };
}

if (!S || !S.order) {
  $('#doc').innerHTML = '<p class="r-empty">No game session found in this browser. Open the report from the host screen (the TV).</p>';
} else {
  S.answers ||= [];
  toolbar();
  render();
}
window.__socuReport = { ready: true }; // test hook
