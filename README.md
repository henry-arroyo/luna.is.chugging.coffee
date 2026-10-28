# MCFCU SOCU Systems Training Game

A real-time, phone-based game for the SOCU systems and data security session. The TV runs the host screen. Students join on their phones with a 4-letter code. Every tap shows up on the TV and on the other phones in well under a second, with no refreshing.

- **Player (phones):** `https://luna.is.chugging.coffee/`
- **Host (TV):** `https://luna.is.chugging.coffee/host.html`

---

## Architecture

```
 Phones ──┐                                  ┌── TV (host.html, unlocked with the host password)
          │  wss  AppSync Events  wss        │   holds the authoritative game state
          ├──►  /up/<CODE>     ──────────────►│   validates every action
          │◄──  /down/<CODE>   ◄──────────────┤   broadcasts versioned snapshots
          │                                  │
          └── HTTPS ── CloudFront (OAC) ── private S3 (static site + /runtime/config.json)
```

| Channel | Publish | Subscribe |
|---|---|---|
| `/up/<CODE>` (phones → TV) | API key | Host password only |
| `/down/<CODE>` (TV → phones) | Host password only | API key |

The host password is checked by a Lambda authorizer against a salted hash in SSM Parameter Store, so only the TV can broadcast or read what phones send.

| Stack | Lifetime | Contents |
|---|---|---|
| `SocuGame-Cert` | Persistent | ACM certificate for `luna.is.chugging.coffee` (us-east-1, DNS validated in Cloudflare) |
| `SocuGame-Site` | Persistent | Private S3 bucket, CloudFront with Origin Access Control, security headers (CSP, HSTS, frame-deny, no-referrer) |
| `SocuGame-Game` | **Ephemeral** | AppSync Events API, `up` and `down` channel namespaces with an `onPublish` guard, API key (72 h), host-password Lambda authorizer, `runtime/config.json` |

Everything is in **us-east-1**, because CloudFront requires its certificate there and one region avoids cross-region references.

**Why the TV is the referee:** phones only send intents ("I picked option B"). The TV checks the move, applies it, and broadcasts the whole public state with a version number. Phones render whatever the newest version says. There's no database, and all game rules live in one place. The only Lambda is the password check.

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
| Policy `socu-cdk-execution` | What CloudFormation may do: us-east-1 only; S3 `socugame-*`; AppSync APIs, CloudFront distributions and ACM certificates only if tagged `project=mcfcu-socu-training` (and created only with that tag); Lambda `SocuGame-*`; the project's own log groups; IAM only on `SocuGame-*` roles, and only roles that carry the boundary below. |
| Policy `socu-role-boundary` | Permissions boundary on every role the stacks create (set through `cdk.json`). Caps them at the site bucket, CloudFront invalidations, the project's log groups and the host-password parameter, so a stack can't create an admin role or one another account can assume. |
| Stack `CDKToolkit-socugame` | CDK bootstrap, using the policy above instead of AdministratorAccess. |

Every deploy command below runs through the deployer role:

```bash
access/as-deployer.sh npm run deploy:cert
```

Then set the host password, which the TV asks for before it will run a game:

```bash
access/set-host-password.sh
```

It stores only a salted hash, at `/socugame/host-password-hash` in SSM Parameter Store. That parameter isn't part of any stack, so it survives teardowns. Run the script again any time to change the password; the change applies within about 5 minutes, with no redeploy.

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

This takes about a minute. The output shows the API key's approximate expiry, which is 72 hours from deploy. AppSync rounds expiry down to the hour.

### 4. Test

1. On your laptop, open `https://luna.is.chugging.coffee/host.html` and enter the host password.
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

That creates a new API and a fresh 72-hour key. Then open `host.html` on your computer, enter the host password, and put the browser window on the TV. Test with your phone **from the conference room**. Branch guest Wi-Fi can block WebSockets. If it does, have students use cellular data.

After the session: `npm run destroy:game`.

**Full teardown, if you ever want everything gone:** `npm run destroy:all`. Before deploying the Site stack again, **delete the `luna.is` CNAME** in Cloudflare and give it about 5 minutes: CloudFront refuses to attach `luna.is.chugging.coffee` to a new distribution while DNS still points at the old one. Once the Site stack outputs the new `CloudFrontDomain`, add the CNAME back with that value. The ACM validation record stays the same for the same domain and account (it did on the October 2026 rebuild), so leave it in place.

The host password isn't part of any stack, so it survives a full teardown.

---

## Running the session (host cheat sheet)

| Module | What you do |
|---|---|
| **Lobby** | Students scan the QR code and enter their first and last name (the winner's name goes on the certificate). Seats (Member / Front door / Network / Core) assign automatically. **Shuffle seats** if you want. Toggle **Member Lookup** on if you're running the honeypot. |
| **1 · Route It** | Click **Start transaction 1**. The phone holding the active seat gets the decision; everyone else sees where the transaction is. Wrong answers show feedback on the TV and that phone, and the student retries for no points. Use **Next transaction ▶** to advance. Transaction 5 cuts the branch connection, which sets up Module 2. |
| **2 · Help Desk** | **Start scenario** → students lock in → **Reveal**. The room's most popular answer decides the next step, and ties go to the better answer. **Click any answer bar to override** before **Continue** if you want to steer the story. |
| **3 · The Inbox** | **Open the inbox.** The TV grid shows progress only (●), not answers. **Reveal answers** scores all 10 emails (+100 per correct call, −50 per phishing link clicked), then step through each email with its clues. |
| **Audit Log** | Shows job-task record views (Core seat, transactions 1, 3 and 4) next to any no-task views from Member Lookup, plus phishing-link clicks. Use the **Anonymize** toggle if you'd rather show "Employee #2" than names. |
| **Podium** | Final standings. **📄 Session report** opens a printable report (standings, the Inbox email by email, the full answer log with right/wrong for every attempt, and the audit log). **🏆 Winner certificate** prints a landscape certificate for the top scorer (one each if tied). Click **Save as PDF** and choose *Save as PDF* in the print window, with *Headers and footers* off. The report is also on the Audit Log screen. |

You can jump to any module from the top tabs at any time. The × next to a player's name removes them. **New session** wipes scores and the audit log, so it asks for confirmation first.

**The honeypot:** "Member Lookup" is off by default. When it's on, phones show the button during Modules 1–3. It opens a directory of fictional members with balances. Every open and every record view is logged, and nothing on the phone hints at that. The contrast in the audit log between Core's job-task views and curiosity views is the lesson.

---

## Rehearse without AWS

```bash
cd test && npm i && npm run mock    # local AppSync Events stand-in on :8787
```

- Host: `http://localhost:8787/host.html` (password `rehearsal`, or set `HOST_PASSWORD` before `npm run mock`)
- Phones on the same Wi-Fi: `http://<your-laptop-LAN-IP>:8787/`
- Single machine, no server at all: serve `site/` with any static server and add `?local=1` to both URLs (tabs talk over BroadcastChannel).

The mock implements the documented AppSync Events WebSocket protocol. From the synthesized template it takes the **actual** `onPublish` handler code and each namespace's publish and subscribe rules, and it checks the host password with the authorizer's own code (`infra/lambda/auth-core.js`). `npm run e2e` drives a TV and four phones through every module, including killing every socket mid-game, then runs the attacks listed under Security notes. The test requires Python Playwright. Against a live deployment, pass the host password: `HOST_PASSWORD=… python3 e2e.py https://luna.is.chugging.coffee`.

---

## Security notes

- **The API key is public by design.** It sits in `config.json` so phones can connect. With it, someone can send phone messages and read TV broadcasts, and nothing else: no member data exists anywhere in this system. Mitigations:
  - **Only the TV can broadcast, and only the TV can read what phones send.** AWS enforces both with the host password (see Architecture), so a student with dev tools can't fake a TV broadcast or see other phones' messages.
  - The host page's code is public, but it does nothing without the password. The password is never in the page or the repo: the TV keeps it in its tab's session storage (closing the tab forgets it), and AWS stores only a salted scrypt hash.
  - Each phone has a private id, which the TV accepts actions from, and a separate public id, which is how the phone appears in broadcasts. Private ids travel only on the channel the TV alone can read, so nobody can answer or log a lookup as a classmate.
  - Phones still only render a broadcast whose fields are the right types and point at real content, and never insert any of it as HTML.
  - The audit log is never broadcast. Phones don't need it, and it carries real names even with **Anonymize** on.
  - The TV caps a game at 60 players and coalesces broadcasts, so floods of joins or heartbeats can't swamp it.
  - The key expires in 72 hours, and you destroy the stack after each session.
  - Channels are scoped per 4-letter session code.
  - The `onPublish` handler drops anything that isn't a small, well-formed game message on `/up/<code>` or `/down/<code>`.
- **Students' data:** students enter their real first and last name, because the winner's name goes on a certificate. Nothing is stored server-side; AppSync Events relays and forgets. Names live in the TV's browser and in the session report you save.
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
infra/   CDK app (bin/app.ts, lib/*-stack.ts), lambda/ (host-password authorizer), access/ (deploy access, host password)
site/    static site: index.html (phones), host.html (TV), js/, css/, img/, fonts/
test/    mock-appsync.js (local AppSync Events), e2e.py (Playwright end-to-end)
```
