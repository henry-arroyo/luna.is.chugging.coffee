"""End-to-end: one TV host + four phones through every module against the mock AppSync server.
Checks real-time convergence, wrong-answer feedback, honeypot logging, socket loss + recovery,
phishing click penalty, and scoring. Saves screenshots to ./shots.
"""
import json, os, random, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)
NAMES = ["Kai Akana", "Leilani Kamakawiwoʻole", "Makoa", "Noe"]  # one long real name, to check layouts
random.seed(7)
errors = []
vulns = []  # attacks that got through (collected, so one run reports every hole)


def check(ok, msg):
    if not ok:
        vulns.append(msg)
# Against the local mock, sockets are killed server-side via /__kill. Against a real deployment,
# every page records its WebSockets and the test closes them abruptly (what a Wi-Fi drop looks like).
MOCK = BASE.startswith("http://localhost") or BASE.startswith("http://127.")
# The mock's host password is "rehearsal". Against a live deployment, pass the real one in HOST_PASSWORD.
HOST_PASSWORD = os.environ.get("HOST_PASSWORD") or ("rehearsal" if MOCK else None)
if not HOST_PASSWORD:
    sys.exit("Set HOST_PASSWORD to the host password to test a live deployment.")
TRACK_WS = """(() => { const W = window.WebSocket; window.__ws = [];
  window.WebSocket = function (...a) { const w = new W(...a); window.__ws.push(w); return w; };
  window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); })()"""


def kill_sockets(pages):
    if MOCK:
        return urllib.request.urlopen(f"{BASE}/__kill").read().decode()
    n = sum(p.evaluate("() => { const s = window.__ws.filter((w) => w.readyState < 2); s.forEach((w) => w.close()); return s.length }") for p in pages)
    return f"closed {n} sockets client-side"


def hs(host):
    return host.evaluate("() => JSON.parse(JSON.stringify(window.__socuHost.state))")


def ps(page):
    return page.evaluate("() => { const s = window.__socuPlayer && window.__socuPlayer.state; return s ? JSON.parse(JSON.stringify(s)) : null }")


def converge(host, phones, label, timeout=6):
    """Every phone shows the same phase/step as the host's public view."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = hs(host)
        ok = True
        for p in phones:
            s = ps(p)
            if not s or s["phase"] != h["phase"] or s["m1"]["step"] != h["m1"]["step"] or s["m2"]["node"] != h["m2"]["node"] or s["m3"]["status"] != h["m3"]["status"]:
                ok = False
                break
        if ok:
            return time.time() - t0
        time.sleep(0.05)
    raise AssertionError(f"phones did not converge: {label}")


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name + ".png"))


def click(page, sel):
    page.locator(sel).first.click()


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    hostctx = browser.new_context(viewport={"width": 1920, "height": 1080})
    hostctx.add_init_script(TRACK_WS)
    host = hostctx.new_page()
    host.on("pageerror", lambda e: errors.append(f"host: {e}"))
    host.goto(f"{BASE}/host.html")
    host.wait_for_selector("#login")
    shot(host, "00-host-login")
    host.fill("#pw", "not-the-password")
    host.locator("#login button").click()
    host.wait_for_selector("#login .err")
    assert host.evaluate("() => !window.__socuHost"), "host unlocked with a wrong password"
    host.fill("#pw", HOST_PASSWORD)
    host.locator("#login button").click()
    host.wait_for_function("() => window.__socuHost && window.__socuHost.state")
    code = hs(host)["code"]
    print("session code", code)
    host.wait_for_selector(".bigcode")
    shot(host, "01-host-lobby-empty")

    phones = []
    for n in NAMES:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(TRACK_WS)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e, n=n: errors.append(f"{n}: {e}"))
        pg.goto(f"{BASE}/?code={code}")
        pg.fill("#name", n)
        click(pg, "button[type=submit]")
        phones.append(pg)
    shot(phones[0], "02-phone-join-done")
    host.wait_for_function("() => window.__socuHost.state.order.length === 4")
    t = converge(host, phones, "lobby")
    print(f"lobby converged in {t*1000:.0f} ms")
    # turn on honeypot
    host.locator("label.toggle:has(input[data-act=honeypot])").click()
    time.sleep(0.3)
    shot(host, "03-host-lobby-full")
    shot(phones[0], "04-phone-lobby")

    by_pid = {}
    for p in phones:
        by_pid[p.evaluate("() => window.__socuPlayer.me.pid")] = p

    # ── Module 1
    content = host.evaluate("async () => { const m = await import('/js/content.js'); return JSON.parse(JSON.stringify({tx: m.TRANSACTIONS, sc: m.SCENARIOS, em: m.EMAILS})) }")
    click(host, "button[data-act=m1start]")
    lat = []
    for ti, tx in enumerate(content["tx"]):
        host.wait_for_function(f"() => window.__socuHost.state.m1.txIdx === {ti} && window.__socuHost.state.m1.status === 'active'")
        did_wrong = False
        while True:
            h = hs(host)
            if h["m1"]["status"] == "result":
                break
            step = tx["steps"][h["m1"]["step"]]
            pid = h["seats"][step["seat"]]
            page = by_pid[pid]
            converge(host, phones, f"tx{ti} step{h['m1']['step']}")
            if ti == 0 and h["m1"]["step"] == 1 and not did_wrong:
                wrong = [o for o in step["options"] if not o["ok"]][0]
                page.locator(f"button.opt[data-v={wrong['id']}]").click()
                page.wait_for_selector(".fb.bad")
                shot(page, "05-phone-m1-wrong")
                shot(host, "06-host-m1-wrong")
                did_wrong = True
                continue
            if ti == 1 and h["m1"]["step"] == 0:
                # Someone gets curious: Member Lookup (honeypot)
                nosy = phones[1]
                nosy.locator(".lookup-fab").click()
                nosy.locator(".mlist li").nth(0).click()
                nosy.wait_for_selector("table.acct")
                shot(nosy, "07-phone-honeypot")
                nosy.locator(".sheet-head .x").click()
            right = [o for o in step["options"] if o["ok"]][0]
            before = hs(host)["v"]
            t0 = time.time()
            page.locator(f"button.opt[data-v={right['id']}]").click()
            # time until another phone reflects the new step
            other = phones[(phones.index(page) + 1) % 4]
            other.wait_for_function(f"() => window.__socuPlayer.state && (window.__socuPlayer.state.m1.step !== {h['m1']['step']} || window.__socuPlayer.state.m1.status === 'result')")
            lat.append(time.time() - t0)
            if ti == 4 and h["m1"]["step"] == 2:
                shot(host, "08-host-m1-cut")
        converge(host, phones, f"tx{ti} result")
        if ti == 0:
            shot(host, "09-host-m1-result")
            shot(phones[2], "10-phone-m1-result")
        if ti == 2:
            # Simulate every phone and the TV losing their sockets mid-game.
            print("kill:", kill_sockets([host] + phones))
        if ti + 1 < len(content["tx"]):
            click(host, f"button[data-act=m1start][data-v='{ti+1}'].primary")
    print(f"M1 tap->other phone updated: avg {1000*sum(lat)/len(lat):.0f} ms, max {1000*max(lat):.0f} ms")
    converge(host, phones, "after reconnect", timeout=15)

    # ── Module 2
    click(host, "button[data-act=phase][data-v=m2]")
    for si, sc in enumerate(content["sc"]):
        click(host, f"button.chipbtn[data-act=m2start][data-v='{si}']")
        while True:
            host.wait_for_function("() => ['voting','done'].includes(window.__socuHost.state.m2.status)")
            h = hs(host)
            if h["m2"]["status"] == "done":
                break
            converge(host, phones, f"sc{si} {h['m2']['node']}")
            node = sc["nodes"][h["m2"]["node"]]
            for p in phones:
                opt = random.choice(node["options"])["id"]
                p.locator(f"button.opt[data-v={opt}]").click()
            host.wait_for_function("() => Object.keys(window.__socuHost.state.m2.votes).length === 4")
            if si == 1 and not os.path.exists(os.path.join(SHOTS, "11-host-m2-voting.png")):
                shot(host, "11-host-m2-voting")
                shot(phones[0], "12-phone-m2-vote")
            click(host, "button[data-act=m2reveal]")
            host.wait_for_function("() => window.__socuHost.state.m2.status === 'revealed'")
            if si == 1 and not os.path.exists(os.path.join(SHOTS, "13-host-m2-reveal.png")):
                time.sleep(0.7)
                shot(host, "13-host-m2-reveal")
                converge(host, phones, "m2 reveal")
                shot(phones[0], "14-phone-m2-reveal")
            click(host, "button[data-act=m2continue]")
    print("M2 done")

    # ── Module 3
    click(host, "button[data-act=phase][data-v=m3]")
    click(host, "button[data-act=m3open]")
    converge(host, phones, "m3 open")
    shot(phones[0], "15-phone-inbox")
    for i, p in enumerate(phones):
        for e in content["em"]:
            p.locator(f".mails li[data-v={e['id']}]").click()
            if e["link"]:
                if i == 3 and e["id"] == "e1":
                    p.locator("button.mailbtn").click()  # falls for it
                    p.wait_for_selector(".modal-in")
                    shot(p, "16-phone-phished")
                    p.locator("button[data-a=modalclose]").click()
                else:
                    p.locator("button[data-a=inspect]").click()
            if i == 0 and e["id"] == "e5":
                p.locator("button[data-a=addr]").click()
                shot(p, "17-phone-email-inspect")
            verdict = e["verdict"] if random.random() < 0.8 else ("legit" if e["verdict"] == "phish" else "phish")
            p.locator(f"button.v.{verdict}").click()
    host.wait_for_function("() => Object.values(window.__socuHost.state.m3.marks).every(m => Object.keys(m).length === " + str(len(content["em"])) + ") && Object.keys(window.__socuHost.state.m3.marks).length === 4")
    shot(host, "18-host-m3-progress")
    host.once("dialog", lambda d: d.accept())
    click(host, "button[data-act=m3reveal]")
    host.wait_for_function("() => window.__socuHost.state.m3.status === 'reveal'")
    shot(host, "19-host-m3-reveal")
    for k in range(len(content["em"])):
        click(host, "footer button.primary")
    shot(host, "20-host-m3-scores")

    # ── Audit + podium
    click(host, "button[data-act=phase][data-v=audit]")
    host.wait_for_selector("table.auditlog")
    shot(host, "21-host-audit")
    host.locator("footer label.toggle").click()
    time.sleep(0.3)
    shot(host, "22-host-audit-anon")
    # Phones never get the audit log (it carries real names, even with Anonymize on),
    # and the broadcast never carries a private player id.
    pids = list(hs(host)["players"].keys())
    s = ps(phones[0])
    check(not s.get("audit"), "audit log (with real names) broadcast to phones")
    check(not any(pid in json.dumps(s) for pid in pids), "private player ids in broadcast state")
    click(host, "button[data-act=phase][data-v=podium]")
    converge(host, phones, "podium")
    shot(host, "23-host-podium")
    shot(phones[0], "24-phone-podium")

    # ── Session report + certificate (opened from the podium, as the host would)
    h = hs(host)
    for pid in h["order"]:
        logged = sum(a["pts"] for a in h["answers"] if a["pid"] == pid)
        assert logged == h["players"][pid]["score"], f"answer log points {logged} != score {h['players'][pid]['score']}"
    with hostctx.expect_page() as rp:
        click(host, "button[data-act=report]")
    report = rp.value
    report.on("pageerror", lambda e: errors.append(f"report: {e}"))
    report.wait_for_function("() => window.__socuReport && window.__socuReport.ready")
    report.wait_for_selector(".cert-name")
    n_ans = report.locator("table.r-log").first.locator("tbody tr").count()
    print("report: answer rows (Route It):", n_ans, "| certificates:", report.locator(".cert").count())
    assert report.locator(".r-results tbody tr").count() == 4
    report.emulate_media(media="print")
    report.pdf(path=os.path.join(SHOTS, "session-report.pdf"), prefer_css_page_size=True, print_background=True)
    report.emulate_media(media="screen")
    shot(report, "25-report")
    report.close()

    h = hs(host)
    kinds = [a["kind"] for a in h["audit"]]
    print("audit kinds:", {k: kinds.count(k) for k in set(kinds)})
    print("scores:", {h["players"][p]["name"]: h["players"][p]["score"] for p in h["order"]})
    assert kinds.count("browse") >= 1 and kinds.count("lookup") >= 1, "honeypot not logged"
    assert kinds.count("task") == 3, "core task accesses should be logged (tx1, tx3, tx4)"
    assert kinds.count("click") == 1, "phish click should be logged once"
    noe = [p for p in h["order"] if h["players"][p]["name"] == "Noe"][0]

    # ── Attacks. The API key is public, so a student can publish on both channels.
    # The rogue page borrows the site's own transport, exactly as someone in dev tools could.
    rogue = browser.new_context().new_page()
    rogue.on("pageerror", lambda e: errors.append(f"rogue: {e}"))
    rogue.goto(f"{BASE}/")
    rogue.evaluate("""async (code) => {
      const t = await import('/js/transport.js');
      const c = await import('/js/common.js');
      const cfg = await t.loadConfig();
      const T = t.createTransport(cfg);
      await new Promise((r) => T.onStatus((st) => st === 'online' && r()));
      // Try to read the phones' channel (private ids travel on it): with the API key, then with a guessed password.
      const tryRead = (tr) => new Promise((r) => tr.subscribe(c.chUp(code), () => (window.__rogue.heard += 1), () => r('subscribed'), () => r('refused')));
      window.__rogue = { up: (m) => T.publish(c.chUp(code), m), down: (m) => T.publish(c.chDown(code), m), newId: c.newId, heard: 0 };
      const guess = t.createTransport({ ...cfg, hostToken: 'password123' });
      window.__rogue.read = { key: await tryRead(T), guess: await tryRead(guess) };
    }""", code)
    reads = rogue.evaluate("() => window.__rogue.read")
    check(reads == {"key": "refused", "guess": "refused"}, f"phones' channel readable without the host password: {reads}")
    member = rogue.evaluate("async () => (await import('/js/content.js')).LOOKUP_MEMBERS[0].id")
    audit_before = len(hs(host)["audit"])

    # 1. A fake TV broadcast with HTML in the scores and a version far ahead of the TV's.
    fake = ps(phones[0])
    for p in fake["players"]:
        p["score"] = '<b id="pwn">pwned</b>'
    rogue.evaluate("(s) => window.__rogue.down({ t: 'state', v: 1e15, s })", fake)
    time.sleep(1)
    check(all(p.locator("#pwn").count() == 0 for p in phones), "fake broadcast injected HTML on phones")
    click(host, "button[data-act=phase][data-v=audit]")
    try:
        converge(host, phones, "after fake broadcast")
    except AssertionError:
        vulns.append("phones stopped following the real TV after a fake broadcast")
    click(host, "button[data-act=phase][data-v=podium]")

    # 2. Acting as a classmate using the id the broadcast shows for them.
    first = ps(phones[1])["players"][0]
    victim = first.get("id") or first.get("pid")  # "pid" is what builds before public ids exposed
    rogue.evaluate("([id, member]) => { window.__rogue.up({ t: 'act', pid: id, pub: id, a: { k: 'lookup', member } });"
                   " window.__rogue.up({ t: 'act', pid: id, a: { k: 'browse' } }) }", [victim, member])

    # 3. "__proto__" as a player id (prototype pollution on the TV).
    rogue.evaluate("""(member) => { const r = window.__rogue;
      r.up({ t: 'join', pid: '__proto__', pub: r.newId(), name: 'Kalani' });
      r.up({ t: 'act', pid: '__proto__', a: { k: 'lookup', member } });
      r.up({ t: 'act', pid: '__proto__', a: { k: 'browse' } }); }""", member)
    time.sleep(1)
    h = hs(host)
    forged = h["audit"][audit_before:]
    check(not forged, f"forged audit entries: {[(a['name'], a['action']) for a in forged]}")
    check(host.evaluate("() => Object.keys(Object.prototype).length === 0 && ({}).name === undefined"), "Object.prototype polluted on the TV")
    check(len(h["order"]) == 4, "rogue messages added a player")

    # 4. Heartbeat flood from one joined player: broadcasts are coalesced, not one per message.
    rogue.evaluate("() => { const r = window.__rogue; r.flood = { pid: r.newId(), pub: r.newId() }; r.up({ t: 'join', name: 'Flood', ...r.flood }) }")
    host.wait_for_function(f"() => window.__socuHost.state.order.length === {len(h['order']) + 1}")
    time.sleep(0.5)
    v0 = hs(host)["v"]
    rogue.evaluate("() => { const r = window.__rogue; for (let i = 0; i < 200; i++) r.up({ t: 'hello', ...r.flood }) }")
    time.sleep(2)
    flood_bcasts = hs(host)["v"] - v0
    print("broadcasts during a 200-message hello flood:", flood_bcasts)
    check(flood_bcasts <= 5, f"hello flood caused {flood_bcasts} broadcasts")

    # 5. Join flood: the TV stops adding players at its cap.
    rogue.evaluate("() => { const r = window.__rogue; for (let i = 0; i < 70; i++) r.up({ t: 'join', name: 'Bot', pid: r.newId(), pub: r.newId() }) }")
    time.sleep(2)
    n = len(hs(host)["order"])
    print("players after a 70-join flood:", n)
    # AppSync drops part of a burst this fast from one connection, so live runs may not reach the cap.
    check(n == 60 if MOCK else n <= 60, f"join cap not enforced: {n} players")
    check(rogue.evaluate("() => window.__rogue.heard") == 0, "rogue received phone messages")
    print("attacks that got through:", vulns or "none")
    if MOCK:
        print("stats:", urllib.request.urlopen(f"{BASE}/__stats").read().decode())
    browser.close()

print("page errors:", errors or "none")
sys.exit(1 if errors or vulns else 0)
