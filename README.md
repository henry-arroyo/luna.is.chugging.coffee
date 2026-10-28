# MCFCU SOCU Systems Training Game

A real-time, phone-based game for the SOCU systems and data security session. The TV runs the host screen. Students join on their phones with a 4-letter code. Every tap shows up on the TV and on the other phones in well under a second, with no refreshing.

- **Player (phones):** `https://luna.is.chugging.coffee/`
- **Host (TV):** `https://luna.is.chugging.coffee/host.html`

---

## Architecture

```
 Phones ──┐                                  ┌── TV (host.html)
          │  wss  AppSync Events  wss        │   holds the authoritative game state
          ├──►  /game/<CODE>/up   ───────────►│   validates every action
          │◄──  /game/<CODE>/down ◄───────────┤   broadcasts versioned snapshots
          │                                  │
          └── HTTPS ── CloudFront (OAC) ── private S3 (static site + /runtime/config.json)
```

| Stack | Lifetime | Contents |
|---|---|---|
| `SocuGame-Cert` | Persistent | ACM certificate for `luna.is.chugging.coffee` (us-east-1, DNS validated in Cloudflare) |
| `SocuGame-Site` | Persistent | Private S3 bucket, CloudFront with Origin Access Control, security headers (CSP, HSTS, frame-deny, no-referrer) |
| `SocuGame-Game` | **Ephemeral** | AppSync Events API, `game` channel namespace with an `onPublish` guard, API key (48 h), `runtime/config.json` |

Everything is in **us-east-1**, because CloudFront requires its certificate there and one region avoids cross-region references.

**Why the TV is the referee:** phones only send intents ("I picked option B"). The TV checks the move, applies it, and broadcasts the whole public state with a version number. Phones render whatever the newest version says. There's no database and no Lambda, and all game rules live in one place.

**Resilience:**
- Phones reconnect automatically: after a screen lock, a Wi-Fi drop, or switching apps. They resubscribe, say hello, and the TV rebroadcasts.
- The TV also rebroadcasts every 8 seconds as a safety net.
- The TV's state is saved in its browser's local storage, so refreshing the TV mid-game resumes the same session for up to 12 hours.

---

## Prerequisites (once)

- Node.js 20+ and AWS CLI 2.32+ (for `aws login`)
- An IAM user or IAM Identity Center user with admin rights in your **personal** account (not root: root can't assume roles)

Access is keyless. You sign in with `aws login` (browser, temporary credentials that expire with your console session), and deploys run as a narrowly scoped role:

```bash
cd infra
npm ci
access/setup-access.sh
```

That script deploys `socu-claude-access` ([access/deployer-access.yaml](infra/access/deployer-access.yaml)) and bootstraps CDK with its own qualifier, `socugame`, so it never touches another project's CDK bootstrap in the same account:

| Created | Purpose |
|---|---|
| Role `socu-claude-deployer` | Assumed for deploys. Can only assume the `cdk-socugame-*` bootstrap roles, plus read-only status checks. |
| Policy `socu-cdk-execution` | What CloudFormation may do: us-east-1 only; S3 `socugame-*`, CloudFront, ACM, AppSync, Lambda `SocuGame-*`, Logs; IAM only on `SocuGame-*` roles, with two allowed AWS-managed policies. |
| Stack `CDKToolkit-socugame` | CDK bootstrap, using the policy above instead of AdministratorAccess. |

Every deploy command below runs through the deployer role:

```bash
access/as-deployer.sh npm run deploy:cert
```

Cut access early with `aws logout --profile socu-admin`. To remove the access setup entirely after the session: delete the `CDKToolkit-socugame` stack, then `socu-claude-access` (empty the `cdk-socugame-assets-*` bucket first if the delete stalls).

---

## Tonight: first deploy

### 1. Certificate (one time)

```bash
npm run deploy:cert
```

CloudFormation will **wait** until the certificate validates. While it waits, open a second terminal and get the validation record:

```bash
ARN=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='luna.is.chugging.coffee'].CertificateArn" --output text)
aws acm describe-certificate --region us-east-1 --certificate-arn "$ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

In **Cloudflare → chugging.coffee → DNS**, add:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | the `Name` from ACM, minus `.chugging.coffee` (looks like `_a1b2c3….luna.is`) | the `Value` from ACM | **DNS only** (grey cloud) |

Validation usually completes within a few minutes, and then the deploy finishes. Leave this record in place permanently.

### 2. Site (one time)

```bash
npm run deploy:site
```

The CloudFront distribution takes several minutes to create. Note the `CloudFrontDomain` output (`dxxxxxxxxxxxx.cloudfront.net`), then add in Cloudflare:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `luna.is` | `dxxxxxxxxxxxx.cloudfront.net` | **DNS only** (grey cloud) |

> **Keep both records grey-cloud.** Cloudflare's free Universal SSL only covers one subdomain level (`*.chugging.coffee`), so proxying `luna.is.chugging.coffee` through Cloudflare would fail TLS. CloudFront serves the ACM certificate itself.

### 3. Real-time layer

```bash
npm run deploy:game
```

This takes about a minute. The output shows the API key's approximate expiry, which is 48 hours from deploy. AppSync rounds expiry down to the hour.

### 4. Test

1. On your laptop, open `https://luna.is.chugging.coffee/host.html`.
2. Scan the QR code with your phone, plus a second device if you have one.
3. Click through one transaction, one scenario, and a few emails.
4. Lock the phone for 30 seconds, then unlock it. It should catch back up on its own.

### 5. Tear down the real-time layer

```bash
npm run destroy:game
```

This deletes the API and invalidates the key. The site stays up and shows **"Game is offline."** Cert and Site cost next to nothing to keep, and keeping them means no DNS changes tomorrow.

---

## Tomorrow morning

```bash
cd infra && npm run deploy:game
```

That creates a new API and a fresh 48-hour key. Then open `host.html` on the conference room computer and test with your phone **from the conference room**. Branch guest Wi-Fi can block WebSockets. If it does, have students use cellular data.

After the session: `npm run destroy:game`.

**Full teardown, if you ever want everything gone:** `npm run destroy:all`. The CloudFront domain will be different on the next deploy, so you'd update the `luna.is` CNAME. The ACM validation record usually stays the same for the same domain and account; check `describe-certificate` again to confirm.

---

## Running the session (host cheat sheet)

| Module | What you do |
|---|---|
| **Lobby** | Students scan the QR code. Seats (Member / Front door / Network / Core) assign automatically. **Shuffle seats** if you want. Toggle **Member Lookup** on if you're running the honeypot. |
| **1 · Route It** | Click **Start transaction 1**. The phone holding the active seat gets the decision; everyone else sees where the transaction is. Wrong answers show feedback on the TV and that phone, and the student retries for no points. Use **Next transaction ▶** to advance. Transaction 5 cuts the branch connection, which sets up Module 2. |
| **2 · Help Desk** | **Start scenario** → students lock in → **Reveal**. The room's most popular answer decides the next step, and ties go to the better answer. **Click any answer bar to override** before **Continue** if you want to steer the story. |
| **3 · The Inbox** | **Open the inbox.** The TV grid shows progress only (●), not answers. **Reveal answers** scores everything (+100 per correct call, −50 per phishing link clicked), then step through each email with its clues. |
| **Audit Log** | Shows job-task record views (Core seat, transactions 1, 3 and 4) next to any no-task views from Member Lookup, plus phishing-link clicks. Use the **Anonymize** toggle if you'd rather show "Employee #2" than names. |
| **Podium** | Final standings. |

You can jump to any module from the top tabs at any time. The × next to a player's name removes them. **New session** wipes scores and the audit log, so it asks for confirmation first.

**The honeypot:** "Member Lookup" is off by default. When it's on, phones show the button during Modules 1–3. It opens a directory of fictional members with balances. Every open and every record view is logged, and nothing on the phone hints at that. The contrast in the audit log between Core's job-task views and curiosity views is the lesson.

---

## Rehearse without AWS

```bash
cd test && npm i && npm run mock    # local AppSync Events stand-in on :8787
```

- Host: `http://localhost:8787/host.html`
- Phones on the same Wi-Fi: `http://<your-laptop-LAN-IP>:8787/`
- Single machine, no server at all: serve `site/` with any static server and add `?local=1` to both URLs (tabs talk over BroadcastChannel).

The mock implements the documented AppSync Events WebSocket protocol and runs the **actual** `onPublish` handler code extracted from the synthesized template. `npm run e2e` drives a TV and four phones through every module, including killing every socket mid-game. The test requires Python Playwright.

---

## Security notes

- **The API key is public by design.** It sits in `config.json` so phones can connect. Someone with it could publish junk into a training game. They could not reach anything else, and no member data exists anywhere in this system. Mitigations:
  - The key expires in 48 hours, and you destroy the stack after each session.
  - Channels are scoped per 4-letter session code.
  - The `onPublish` handler drops anything that isn't a small, well-formed game message on `/game/<code>/up|down`.
- **Students' data:** first name or nickname only. Nothing is stored server-side; AppSync Events relays and forgets. Game state lives only in the TV's browser.
- **No third-party requests from students' phones:** fonts, QR code and logos are self-hosted. CSP allows only this site and AppSync in us-east-1.
- **All content is fictional:** members, balances, card numbers and phishing domains.

**If the onPublish handler misbehaves after deploy** (symptom: the TV never sees students join), redeploy without it:

```bash
npx cdk deploy SocuGame-Game -c publishGuard=false
```

---

## Editing content

All transactions, scenarios, emails, and Member Lookup records are in `site/js/content.js`. Edit the file, then run `npm run deploy:site`. That pushes the files and invalidates the CloudFront cache.

## Layout

```
infra/   CDK app (bin/app.ts, lib/*-stack.ts)
site/    static site: index.html (phones), host.html (TV), js/, css/, img/, fonts/
test/    mock-appsync.js (local AppSync Events), e2e.py (Playwright end-to-end)
```
