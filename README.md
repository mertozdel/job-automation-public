# AI Engineer job application automation (n8n)

Finds AI/ML engineering roles across **Bayern, Berlin and Amsterdam**, ranks them, scores fit
against your CV, writes a tailored cover letter, emails the CV where a contact address exists, and
sends one morning digest with everything else ready to submit in ~30 seconds.

| File | What it is |
|---|---|
| **`workflow-v2.json`** | **Current.** 49 nodes, Postgres-backed. Sources: Bundesagentur, Adzuna (NL + DE), Arbeitnow, 55 curated boards and the `employers` watchlist. Import this. |
| `workflow.json` | v1 — simpler, no database. Kept as a fallback if you don't want Postgres. |
| `companies.json` | The verified ATS registry (55 companies, 4 ATS platforms). Edit to add/remove targets. |
| **`workflow-speculative.json`** | Weekly speculative outreach (Initiativbewerbung), showcase-framed. 26 nodes. |
| **`workflow-discovery.json`** | Employer discovery: grows the `employers` watchlist from job ads and OpenStreetMap. 12 nodes, daily. See RUNBOOK. |
| `cv/source/CV.html`, `CV.de.html` | Editable CV, English and German. `cv/render-cv.ps1` re-renders both PDFs the workflows attach. |
| `cv/source/Portfolio.html` | Editable project portfolio (10 pages). `cv/render-cv.ps1` renders it to `cv/Portfolio.pdf`; no workflow attaches it. |
| `schema.sql` | Run once against your Postgres before first use. Shared by both workflows. |
| **`start-ui.ps1`** / `ui/` | Job list UI: browse the apply-yourself list, open a posting with its letter copied, mark it applied. See "Job list UI". |
| `ANALYSIS.md` | Gap analysis, measured against the live APIs. Read this to understand the design. |

---

## Read this first: what is and isn't automatable

**Reading** job boards is public and keyless on Greenhouse, Lever and Ashby — verified live.
**Submitting** applications is not:

| | Greenhouse | Lever | Ashby |
|---|---|---|---|
| Read job board | public ✅ | public ✅ | public ✅ |
| Submit application | employer API key ❌ | employer API key ❌ | `candidatesWrite` ❌ |

Greenhouse: *"the Basic Auth username is your API key (found on the API Credentials page)."*
Lever: *"not usable by unauthenticated third parties."* Those endpoints exist so a **company** can
wire its own careers page to its own ATS. A candidate cannot get one.

**So the final submit stays manual** — and that's fine, because the submit was never the expensive
part. Finding the right 8 roles out of 350 and writing 8 letters was. That part is fully automated.

Realistic split per run:
- **~31% of Bundesagentur postings** carry a contact email → emailed end-to-end, zero touch.
  (This path was broken until 2026-09-24 and never actually sent. See "Changes 2026-09-24".)
- **Everything else** → digest entry with the letter written, gaps flagged, deep link ready.

### XING / LinkedIn — not supported, deliberately

Neither has a candidate-side API. XING closed new registrations at dev.xing.com (existing keys
only); LinkedIn's Jobs API is gated to Talent Solutions partners with an enterprise Recruiter
contract. That leaves login-credential automation, which isn't built here: it breaks both ToS,
stores your password in n8n, and breaks on 2FA challenges regardless. A LinkedIn ban is usually
permanent and LinkedIn is where AI-role referrals come from — bad trade for listings you can
mostly reach elsewhere.

**Added instead: Arbeitnow** — public German job-board API, no key, no terms problem. Live: 800
jobs / 5 pages → 219 in-region → 7 AI-relevant, at employers the registry misses (Nebius, Machine
Learning Reply, Legalhero). German-only; contributes nothing to Amsterdam.

**Probed and rejected** (see ANALYSIS.md for the full table): ai-jobs.net is dead (redirects to
foorilla, HTML only); SmartRecruiters works but only BoschGroup had in-region AI roles — 4 of them;
Personio resolved 3 of 10 subdomains; RemoteOK/Jobicy/Remotive/WeWorkRemotely return AI roles but
**zero** in your regions. There are no more good aggregator APIs — the lever is more *companies* on
the APIs that already work.

### Showcase mode — the emails say an agent wrote them

`showcaseMode` (on by default) rewrites the letter to state plainly, in the first paragraph, that
an agent pipeline found the role and drafted the mail — and frames that as the point rather than an
apology. For an AI-engineering role the system is a working sample of the skill being hired for,
and transparency turns the one real objection into the pitch.

The second paragraph describes the build from `showcaseFacts` only — the model may not invent
capabilities. It must name one concrete **tradeoff**, not a feature list, and must include the
honest limitation: the ATS apply APIs need the employer's own key, so the final submit stays
manual. That line is the most credible sentence in the letter, because it shows real investigation
rather than a claim.

Set `portfolioUrl` to a write-up or repo before enabling. Without something checkable it is an
unverifiable boast; with it, it is a work sample.

> **Be ready to defend it.** Anyone who bites will open with "walk me through the pipeline."
> `ANALYSIS.md` is the interview prep — the v6/v4 API split, why scoring was inverted, why the
> registry beats keyword search, the 1/18 address measurement. Know those before switching this on.

### Cold-emailing AI companies — measured, doesn't work

Fetched the Impressum/careers/contact pages of 18 registry companies: **1 of 18** publishes a
careers address (Nebius). The rest publish `info@`/`support@`/`press@` or nothing. That's by
design — they route hiring through their ATS. Guessing `jobs@<domain>` produces hard bounces, and
bounces wreck the sender reputation the working ~31% depends on. Speculative applications work in
the *opposite* segment: German Mittelstand, which publishes real `bewerbung@`/`karriere@` addresses
in its postings — and those the workflow already mails automatically.

`workflow-speculative.json` does this properly: it fetches each company's own `/karriere`,
`/careers`, `/jobs`, `/impressum` and `/contact` pages and mails **only an address actually
published there**, on that company's own domain. A guessed pattern is never sent.

Addresses are **tiered**, best-available-wins, so one company receives at most one mail:

| Tier | Matches | Letter behaviour |
|---|---|---|
| `careers` | `jobs@` `karriere@` `bewerbung@` `recruiting@` `hiring@` | writes straight to the hiring team |
| `people` | `hr@` `people@` `talent@` `personal@` | addresses HR/People directly |
| `general` | `info@` `kontakt@` `contact@` `hello@` `office@` | opens by asking to be forwarded to whoever handles engineering hiring |

`addressTiers` controls which are allowed (default: all three). Set it to `["careers"]` for the
strictest behaviour. **Always blocked regardless of setting:** `support@`, `sales@`, `presse@`,
`datenschutz@`, `legal@`, `billing@`, `noreply@`, `postmaster@` — wrong desk or legally sensitive.

Including `general` widens reach roughly 8× (8/18 companies publish *some* address vs 1/18 a
careers-specific one), at lower conversion per mail. That tradeoff is yours to set; the forwarding
request is there to make a general-inbox mail actually actionable for whoever opens it.

**OpenStreetMap** can widen the funnel in Germany: Overpass returns 209 IT companies in Berlin and
161 in München (287 unique by host). Measured end to end, 3 of 60 yielded a real careers address
(5%) — about 14 across the full set. Optional; needs caching and backoff.

**OSM is useless for Amsterdam, measured.** The same query over Amsterdam/Noord-Holland returned 91
POIs, 88 named — of which exactly **one** (Booking.com) is a recognisable tech employer. The rest
are local IT-support shops (Zwagerman IT, Veul-IT, Encis ICT), consultancies (Xebia, Levi9, Infosys)
and research institutes. Adyen, Mollie, Miro, Optiver, IMC, Flow Traders, Databricks, Nebius and
Catawiki are all **absent** — OSM maps premises someone bothered to tag, and a tech office in a
shared tower doesn't get `office=it`. Using it for Amsterdam would dilute coverage, not extend it.

**What the OSM detour did produce: Recruitee.** Following an ATS link found on a mapped company
(Q42, on Homerun) led to testing the Dutch-native ATSs. Homerun serves only an SPA shell, but
**Recruitee's offers API is public and keyless** — `{company}.recruitee.com/api/offers/` — and it
returns an exact `country_code`, which beats regexing free-text locations. Added as a fourth ATS:
7 companies, **38 NL engineering roles** (Xomnia, Budget Energie, funda, True, Aidence, Channable,
CZ), including "Python Software Engineer - AI team" and "Senior Data Platform Engineer, Amsterdam".

### join.com — checked, not usable

| Path | Result |
|---|---|
| `api.join.com/v1` | `410 Gone` |
| `api.join.com/v2/jobs` | `422` — *"'Authorization' header required"*, employer-dashboard token |
| `companies/sitemap-jobs-index.xml` | `403` Cloudflare |
| `sitemap-index.xml` | `200` but marketing pages only — no job listings |

No candidate-side way in. You lose little: join.com's pitch is *"post to 250+ job boards"*, so its
customers' jobs are multiposted to the Bundesagentur and aggregators you already read.

### Instaffo — added 2026-10-02, live workflow only

Instaffo is a matching platform: you keep a profile and companies write to you. It also runs a
public board, `jobs.instaffo.com` (~1,860 jobs, Next.js). Its `/api/` is disallowed in robots.txt,
so the workflow reads the server-rendered **category pages** instead
(`/de/jobs/software-entwicklung-muenchen?page=2`). Each page carries its job cards — title,
company, locations, `postedAt`, remote/hybrid — inside the React Server Component payload, so the
age filter runs before the cap. The description comes from the job page's schema.org `JobPosting`,
fetched by `Fetch Detail` only for jobs that make the scoring pool.

Measured 2026-10-02 over Berlin, München and Nürnberg: 99 tech jobs, **51 pass the title filter,
12 within `maxDaysOld` 30**, mostly at small companies the registry misses (VESTIGAS "Senior AI
Engineer", PartSpace "AI Developer" in Nürnberg, inovex, MeinGPT). Instaffo has no city pages for
Augsburg or Amsterdam. Ads carry no employer address — you apply through your Instaffo account — so
these jobs always land in the digest, never in the auto-send path.

---

## Setup

### 1. Postgres (required for v2)

```bash
psql "$YOUR_CONN" -f schema.sql
```

This replaces n8n's workflow static data, which is **wiped whenever a workflow is re-imported** —
meaning v1 could re-apply to companies you'd already contacted. That was the single worst failure
mode in v1 and it is the reason v2 requires a database.

> The SQL is **not yet verified against a live server** — no Postgres was available here. The
> column lists across `INSERT`, `jsonb_to_record`, `schema.sql` and the workflow were
> cross-checked programmatically and match exactly, but run `schema.sql` once and do a manual
> execution before trusting it unattended.

### 2. CV

```
C:\Dev\job-automation\cv\CV.pdf          English (cvPath)
C:\Dev\job-automation\cv\CV_de.pdf  German (cvPathDe)
```
The filename is what recipients see. Letters written in German (`lang` = `German`, set by
`Build Letter Prompt` / `Build Outreach Prompt`) get the Lebenslauf; all others get the English CV.
To change the CV, edit `cv/source/CV.html` and `cv/source/CV.de.html` and run `cv\render-cv.ps1`,
which renders both. The LLM reads the `cvText` field in each Config node, so update that too. `Read CV` uses the local-filesystem node — **self-hosted n8n
only**. On Cloud, swap it for *Google Drive → Download*.

### 3. Credentials (4)

| Credential | Used by | Notes |
|---|---|---|
| **Microsoft Outlook OAuth2** | `Send Application`, `Send Digest` | `microsoftOutlookOAuth2Api`. See the note below — SMTP app passwords no longer work. |
| **OpenRouter** | `Score Job`, `Generate Letter` | Built-in credential type — paste the raw key. Models set in Config. |
| **Postgres** | `Load History`, `Save Application` | Points at the DB you ran `schema.sql` against. |
| **Custom Auth** | `Fetch Adzuna` | Optional. Free key at developer.adzuna.com. JSON: `{"qs": {"app_id": "…", "app_key": "…"}}`. **Not Query Auth** — it holds one parameter, Adzuna needs two (see "Changes 2026-10-13"). |

No secrets live in the Config node any more — v1 had the Adzuna keys in plain text, which
travelled in every workflow export.

#### Sending from you@example.com — OAuth2, not SMTP

Microsoft finished retiring Basic Authentication for SMTP AUTH on **30 April 2026**. App passwords
depended on Basic Auth, so they are gone too. Probed live: `smtp-mail.outlook.com:587` still
advertises `AUTH LOGIN XOAUTH2` and still completes STARTTLS — so it *looks* fine — but a Basic Auth
submission now returns:

```
550 5.7.30 Basic authentication is not supported for Client Submission
```

n8n's generic **Send Email (SMTP)** node only does Basic Auth, so it cannot send from this account
at all. Both workflows therefore use the **Microsoft Outlook** node (Graph API, `/sendMail`) with a
`microsoftOutlookOAuth2Api` credential.

Setup, once:

1. Entra ID (portal.azure.com) → **App registrations** → New registration.
2. Supported account types: **"Accounts in any organizational directory and personal Microsoft
   accounts"** — the personal-accounts part is required for an `@hotmail.com` sender.
3. Redirect URI (Web): the callback n8n shows in the credential dialog, typically
   `http://localhost:5678/rest/oauth2-credential/callback`.
4. Certificates & secrets → new client secret.
5. API permissions → Microsoft Graph → **Delegated** → `Mail.Send`, `offline_access`, `User.Read`.
6. In n8n: create a **Microsoft Outlook OAuth2 API** credential with that client ID and secret, then
   click Connect and sign in as `you@example.com`. Leave the scopes at their defaults.

Mail then sends as your account and lands in its Sent Items, which is what you want — replies come
back to a mailbox you actually read.

Note this is delegated (you sign in), not application permissions. No admin consent needed for a
personal account.

The Bundesagentur, Arbeitnow and all three ATS boards need no credentials at all.

### 4. Run dry

`dryRun` defaults to **`true`**: sources, ranking, scoring and letters all run; nothing is sent.
Read the digest, tune, then set it false.

---

## How v2 differs from v1

**Four sources, not two.** The big one is the ATS registry.

The Bundesagentur returns enterprises and consultancies — BMW, BWI, Bayer, Siemens Energy, EY,
Capgemini. AI-native companies don't post there. Measured, in-region, right now:

```
Berlin 154 · Bayern 143 · Amsterdam 143    = 440 engineering roles / 55 companies
Helsing 66 · Nebius 55 · Isar Aerospace 38 · Databricks 37 · Adyen 27 · Celonis 22 …
across Greenhouse, Ashby, Lever and Recruitee
```

**Amsterdam went from worst-served to well-served.** It was Adzuna-only, no contact emails ever,
so every hit was a dead-end queue entry. Now: Adyen, Databricks, IMC Trading, Flow Traders, Mollie,
Catawiki, Nebius, DEPT, Typeform, Datadog, Polarsteps — 153 roles, same registry, by region.

**Score before generating.** v1 wrote a letter for every job, then filtered on a score produced by
*the same call that wrote the letter* — the model grading its own homework. v2 runs a cheap scoring
pass first (`scoreModel`, no letter) and only pays for generation above `minFitScore`.
Unbiased gate, roughly 3–5× less LLM spend.

**Ranking before the cap.** At a curated AI company the roles are titled *"Senior Software
Engineer"* — the company is the filter, not the title. But broad intake also drags in
*"Integration Engineer, Building Services & MEP"* and *"AIT Operations Engineer – Launch Vehicle"*.
v2 applies a hard software boundary, then ranks by title relevance, so the 8 that reach letter
generation are the best 8, not the first 8. Live: 350 → 122 → top 8.

**Fuzzy dedupe.** `AI Engineer (m/w/d)` / `Senior AI Engineer (w/m/d), Berlin` are one job.
Titles are canonicalised (gender tags, seniority, contract noise stripped) and compared by Jaccard
overlap at 0.6. Plus one application per company per run, and companies in history are skipped.

**German conventions.** German-language letters now close with **Gehaltsvorstellung** and
**Eintrittstermin** (`salaryExpectationEur`, `earliestStart`, `noticePeriod`). Many Mittelstand
employers filter on their absence before a human reads anything — v1 sent neither.

**Outreach briefing in the digest.** Each shortlisted role now carries an **Angle** (one sentence
on why you fit), **Your evidence** (2-3 items mapping a named CV project to a requirement the
posting actually states), and a **LinkedIn note** capped at 300 characters — the connection-request
limit — that *you send by hand*.

That last one is deliberate. Individual employees' addresses aren't published anywhere readable, so
the only automated route would be guessing `firstname.lastname@`, which means bounces and spam
complaints against the account the whole pipeline sends from. And a personal work address is
personal data under GDPR in a way `jobs@` is not. More to the point: "an agent found you and mailed
you" undercuts the showcase angle that a message from *you* carries. So the agent does the research
and the draft; you do the sending, on the channel where being human is the advantage.

Measured for context: of 110 German postings checked, **1 named a contact person — and that one was
a false positive.** There is no published individual to address, which is why this path is manual
rather than automated.

**Everything is company-specific.** Two rules are enforced in the prompts: every paragraph must
contain something true of *this* company and *this* posting, and two letters to two companies must
share no sentence. Generic employer praise ("innovative", "market leader", "exciting projects") is
banned outright. Where a posting is thin, the model is told to write less rather than pad.

The showcase paragraph no longer recites the fact list — it selects the **one** system detail
relevant to the posting (retrieval/eval role → the two-stage scoring gate; data role → the dedupe
and Postgres design) and ties it to a named requirement.

Speculative outreach gets a **company brief** built from their own board plus their own pages: how
many roles are open and how many are engineering, which disciplines are growing, tech recurring in
their ad titles, and real example openings — engineering ones only, since their accounting and
sales ads are noise. Measured on live boards: Helsing 90/155 engineering, Nebius 222/375,
Catawiki 11/46, with pairwise brief overlap of 0.45 (distinct).

**Send spacing.** Mails go out 20–55 s apart (`sendGapMinSeconds` / `sendGapMaxSeconds`), not
all at the same second, and not minutes apart either (see "Changes 2026-09-24").

**Silent-failure alarm.** Every HTTP node degrades quietly by design, so a broken source looks
identical to a quiet week. The digest now names any source that returned nothing.

---

## Tuning (Config node)

| Field | Default | Notes |
|---|---|---|
| `dryRun` | `true` | the safety catch |
| `maxPerRun` | `8` | hard daily ceiling on letters |
| `scorePoolSize` | `24` | roles fit-scored per run (cheap, parallel); the best `maxPerRun` get letters |
| `minRelevance` | `5` (live: `8`) | title-rank gate for Germany, before any LLM spend. At 8 every AI/ML/LLM/FDE title passes; plain software titles from search sources (5-7) do not |
| `baDeepTerms` / `baDeepPages` | KI, Softwareentwickler / `11` | Bundesagentur searches that run past `baPages` × 100 ads, read to this page |
| `relocationNoteNL` | "I am relocating to the Netherlands …" | one sentence the Dutch letters include, and the scorer is told; empty switches both off |
| `minFitScore` | `70` | LLM fit gate, before letter generation |
| `regions` | berlin, bayern, amsterdam | drives both the registry and the searches |
| `rememberDays` | `180` | how long a company stays suppressed |
| `maxDaysOld` | `30` | posting age window. Was 7, which missed most open roles; history makes a wide window safe |
| `perQuery` / `baPages` | `100` / `1` | Bundesagentur rows per query, pages per query |
| `employerSearchTerms` | KI, AI, ML, ... | what the watchlist feeds (Workday, SuccessFactors, SmartRecruiters) are searched for |
| `useAdzuna` / `adzunaGermany` | `true` / `true` | Adzuna for the Netherlands, and for the German cities too |
| `nlLocations` / `nlRadiusKm` | Amsterdam, Utrecht, Rotterdam / `30` | Adzuna search centres; together they cover the Randstad from Haarlem and Almere to Amersfoort, Den Haag and Delft |
| `nlKeywords` / `nlKeywordsFullStack` | 7 AI / 7 full-stack terms, English | NL Adzuna terms. The second list only with `includeFullStack` |
| `adzunaMaxCalls` | `100` | Adzuna calls per run, NL first, then DE. Live: 45 NL + 38 DE = 83 queries, about 3.6 minutes at one call per 2.6 s. Free keys: 25/min, 250/day, 1000/week, 2500/month, so at most three runs a day |
| `skipDutchRequired` | `true` | skip NL ads written in Dutch or demanding fluent Dutch; "Dutch is a plus" stays in |
| `minRelevanceNL` | = `minRelevance` | own title gate for Netherlands roles. Search-tier jobs (Workable, Adzuna, Arbeitnow) get no curated bonus, so a plain "AI Engineer" scores 8 |
| `priorityRegion` | `amsterdam` | letter slots: email jobs first, then this region, then fit; also orders the export |
| `priorityPoolShare` / `maxRolesPerCompany` | `0.8` / `3` | share of the scoring pool reserved for priorityRegion; roles per company per run for apply-yourself jobs (email jobs stay at one). Live: pool 300 × 0.8 = 240 Amsterdam slots, 60 for the rest |
| `useEnglishJobs` / `englishJobsSearches` | `true` / 18 searches, 46 pages | englishjobsearch.nl result pages, each `"area/query/pages"` (area: `amsterdam`, a city, or a province such as `zuid-holland`). 20 jobs a page, best title matches first; about 2 minutes a run |
| `useDevITjobs` | `true` | DevITjobs.nl, English ads only (about 20 nationwide) |
| `englishJobsSearchesDE` | 16 searches, 33 pages | englishjobs.de, the same site for Germany, `"area/query/pages"` with area `bayern` or `berlin` (a Bavarian city slug such as `muenchen` counts as bayern). Also switched by `useEnglishJobs` |
| `applyYourselfLetters` / `maxApplyYourselfLetters` | `true` / `15` | apply-yourself jobs (no address) get letters, from their own cap |
| `emailTarget` / `emailHuntFactor` | = `maxPerRun` / `2` | Email Hunt searches the reserve until emailTarget × factor addresses are found |
| `minFitScoreEmail` | `40` | no automatic email below this fit; the job goes on the apply-yourself list with its address |
| `minRelevanceEmail` / `emailSearchMax` | `5` / `300` | how far below the title gate the hunt may go, and how big the reserve may be |
| `exportDir` | `C:/Dev/job-automation/exports` | `apply-yourself.xlsx`, one file, rebuilt from the database each run |
| `nlApplyByEmail` | `true` | NL ads that name the person to send the application to are emailed there |
| `useWorkable` / `workableTerms` | `true` / AI, machine learning, data scientist, engineer, developer | Workable job search around each `nlLocations` centre, 30 days, up to 6 pages per query |
| `rejectRecheckDays` | `30` | how long a role that failed the fit gate stays skipped |
| `salaryExpectationEur` | `65000` | appears in German letters only |
| `sendGapMinSeconds` / `sendGapMaxSeconds` | `20` / `55` | random gap between mails; keep under 65 |
| `arbeitnowPages` | `5` | 250 jobs/page; raise for more DACH coverage |
| `useInstaffo` | `true` | Instaffo category pages for Berlin, München, Nürnberg (live workflow) |
| `instaffoCategories` / `instaffoPages` | software-entwicklung, data-jobs / `6` | 10 jobs per page, pages not date-sorted, so all are read; largest category measured at 5 pages |

**Adding a company:** append to `companies.json` **and** the `REGISTRY` array in the `ATS Registry`
node (the node is self-contained so the workflow imports cleanly). Find the token from the careers
URL — `boards.greenhouse.io/<token>`, `jobs.lever.co/<token>`, `jobs.ashbyhq.com/<token>` — then
confirm it resolves:

```bash
curl -s "https://boards-api.greenhouse.io/v1/boards/<token>/jobs" | head -c 200
```

---

## Job list UI (2026-10-15)

```powershell
.\start-ui.ps1        # http://localhost:5690, opens the browser; installs `pg` on first run
```

A local page over the same `jobs` database, for working through the apply-yourself list instead of
the spreadsheet. It binds to 127.0.0.1 only. The pipeline does not need to be running.

| Tab | What's in it |
|---|---|
| **To apply** | status `manual` or `send_failed`. Best fit first. Filter by region, search, or "letter ready only" |
| **Applied** | status `applied_manually`: what you marked here (or by SQL) |
| **Emailed** | status `sent`: what the pipeline mailed itself, with the letter it sent. Read-only |
| **Hidden** | roles you hid. They stay off the list until you unhide them |

Applying to one: **Open posting + copy letter** (`o`) copies the letter, then opens the ad. Paste
it, and upload the CV. **Copy CV path** puts `cv\CV.pdf` on the clipboard for the file
dialog. Then **Mark applied** (`a`), which moves on to the next job and offers Undo. Tick several
(`x`, or "Select all") to mark or hide them together. Letter edits save as you type.

What each action writes:

- **Mark applied** sets `status = 'applied_manually'` and `applied_at = now()`, the documented
  route. Load History reads it as "approached", so the company is skipped for `rememberDays`
  from the day you applied. Undo restores the previous status and date exactly.
- **Hide** sets `hidden_at` only (a column the UI adds on start; see `schema.sql`). Status stays
  `manual`, so the pipeline keeps suppressing that role as before. Not a new status: Load History
  ignores statuses it doesn't know, so the role would come back and Save Application would set it
  to `manual` again. The Excel export doesn't read `hidden_at`, so hidden roles still appear there.
- **Letter edits** update `letter`. A later run only replaces it if it writes a new letter for that
  role.

Gaps, subject and LinkedIn note are not in the UI: the database doesn't store them (only this
run's rows in the Excel export have them).

## Changes 2026-11-18 (second): German title gate 8, more German pages, relocation to Amsterdam

Patch: `js-check/patch-gate8-relocation.py` (boards in `js-check/gate8__boards.json`). Test:
`node js-check/gate8-relocation-test.js` (`germany-fde-test`, `germany-remote-test`, `nl-sources-test` and
`email-hunt-test` updated). Before copy: `archive/2026-11-18/workflow-live.before-gate8.json`. Watchlist rows:
`node js-check/apply-watchlist.mjs js-check/gate8__boards.json`.

**Your choices that day:** you move to Amsterdam; the rest of Germany stays fully remote (no hybrid elsewhere);
German title gate 8; no job-alert email reader.

**Measured live**, Germany, on the same day's data: Bundesagentur (all Build DE Queries requests, the nationwide
remote search included), englishjobs.de and the registry and watchlist boards, each ad counted once. Workable,
Arbeitnow, Instaffo, Jobicy, service.bund.de, Adzuna and the Workday tenants are in neither column.

| | Before | After |
|---|---|---|
| Requests: Bundesagentur / englishjobs.de / boards | 134 / 33 / 220 | 166 / 50 / 263 |
| Roles that pass `Filter Relevant` | 284 | 629 (Bayern 283, Berlin 303, remote 43) |
| Not on the list yet | 82 at 55 employers | 326 at 195 employers (Bayern 134, Berlin 164, remote 28) |

**Why Germany looked thin: the title gate, not fetching.** On the same fetched data (before this patch's other changes):

| German gate (`minRelevance`) | 10 | 9 | 8 | 7 | 5 (the NL gate) |
|---|---|---|---|---|---|
| Not on the list yet | 82 | 180 | 290 | 346 | 571 |

At 10, a plain "AI Engineer (m/w/d)" from a search source scored 8 and was dropped, and so was "Senior AI Engineer"
(9) from the Bundesagentur. At 8 every AI, ML, LLM and FDE title passes from any source. Plain software titles from
search sources (5-7) still do not; on a company board they pass when senior or remote/hybrid (+1) on top of the
curated bonus (+2). Bundesagentur ads below the gate still go to Email Hunt's reserve, as before.

| Change | Detail |
|---|---|
| `minRelevance` 10 → 8 | Germany only; the Netherlands keeps `minRelevanceNL` 5 |
| Bundesagentur | `baDeepTerms` (KI, Softwareentwickler) are read to `baDeepPages` (11). The list is relevance-ordered and 170 of 178 relevant ads (gate 8) are on pages 1-3; only "KI" (Bayern 1,060 ads, Berlin 571) and "Softwareentwickler" (Bayern 453) run past 300, and reading them to the end added 8. 32 more requests, some of them empty pages |
| englishjobs.de | 33 → 50 pages: `ai_engineer` to page 6 in both regions, `backend_engineer` to 5 in Bayern, and `agentic_ai` and `llm_engineer` searches. At gate 8: 60 → 99 roles that pass |
| **7 boards** (registry) | Redcare Pharmacy, AeroVect, eGroup, matchmatch, Zattoo, AMBOSS, Clariness: found by resolving 460 englishjobs.de employer names to ATS boards (52 boards, 17 with a role that passes) |
| **3 employers** (watchlist, `schema.sql`) | Snowflake, Mirantis, Roland Berger |
| Relocation (`relocationNoteNL`) | Dutch letters say once, in the close, that you are relocating and need no visa or work permit. The scorer is told location is no gap for Dutch jobs |
| Ads that want an NL resident | An ad saying you must already live in the Netherlands, or that it comes without relocation help, gets "Wants someone already living in the Netherlands." in front of its reason (the list and the export show it), and its letter comes after every other job's. 8 of 381 Amsterdam ads with full text |

**Checked, not built:**
- get-in-it.de: an IT board for graduates and young professionals, 3,490 jobs, mostly German-language admin and public-sector IT; few would pass gate 8.
- jobs.de (robots.txt: crawl-delay 10), stellenanzeigen.de and meinestadt.de allow their listing pages (meinestadt has
  schema.org lists of 20; stellenanzeigen.de job links carry title and city). Not measured: how many of their ads are
  not on the Bundesagentur already. They are the next candidates if Germany needs more.
- Talent.com, Careerjet, Jobsora and Jooble: robots.txt disallows their search pages. Jobware disallows AI agents by
  name. Jobvector answered 403.

## Changes 2026-11-18: Germany, and Forward Deployed Engineer roles

Patch: `js-check/patch-germany-fde.py` (node code in `js-check/germany-fde__*.js`, boards in
`js-check/germany-fde__boards.json`). Test: `node js-check/germany-fde-test.js` (`nl-search-test` and
`ams-coverage-test` updated). Before copy: `archive/2026-11-18/`. Watchlist rows:
`node js-check/apply-watchlist.mjs js-check/germany-fde__boards.json`.

**Measured live on 2026-11-18** with the node code of the workflow before and after, on the same day's data.
Germany: registry and watchlist boards, the Bundesagentur's FDE ads and englishjobs.de; the rest of the
Bundesagentur, Workable, Arbeitnow, Instaffo, Jobicy, service.bund.de and Adzuna are not in either column.

| | Before | After |
|---|---|---|
| Germany: pass `Filter Relevant` | 139 (Bayern 63, Berlin 61, remote 15) | 232 (Bayern 94, Berlin 117, remote 21) |
| Germany: not on the list yet | 27 | 85 (Bayern 33, Berlin 42, remote 10) |
| Germany: Forward Deployed Engineer roles passing | 8 | 52, 32 of them not on the list yet |
| Netherlands: pass `Filter Relevant` (replay, all NL sources but Adzuna) | 633 | 656 |
| Netherlands: Forward Deployed Engineer roles passing | 5 | 27, 15 of them not on the list yet |

| Change | Detail |
|---|---|
| **englishjobs.de** (feeds branch) | The German twin of englishjobsearch.nl: same operator, same layout, same robots.txt (result pages allowed, `/clickout/` disallowed and never fetched). 33 pages a run for Bayern and Berlin, about a minute at 1.5 s apart. A 50-page harvest held 167 roles in Bayern and Berlin that pass the title rules, 112 of them at 79 employers the workflow had never read or listed (AMD, SIXT, Scalable Capital, Redcare Pharmacy, Dassault Systèmes, Huawei, ...). The rest of Germany counts only when the title or extract says fully remote: 1 ad in 598 did, and the site's "remote work" tag alone is not taken as evidence. Of the 307 cards kept, 35 pass the German title gate (`minRelevance` 10): full-stack titles from search sources score 5-7 there |
| **Forward Deployed Engineer** | A plain "Forward Deployed Engineer" scored 0-2 and was dropped everywhere, on the registry boards too. Now +10 when engineer, developer or scientist follows "forward deployed" within three words, or the title says "FDE". Onodrim's "Forward Deployed Operator - Legal & Compliance" stays out. Added to the Bundesagentur, Adzuna (NL and DE), Workable, watchlist and both englishjobs searches, and to `titleMustMatch`. Managers, consultants and interns stay out through `titleExclude` |
| Adzuna budget | `adzunaMaxCalls` 60 → 100. The 42 NL queries ran first, so Germany got 18 of its 36 and the full-stack terms never ran there |
| Titles | `working student`, `postdoc`, ` phd` join `titleExclude` ("Werkstudent" was there; "Working Student - LLM Inference Performance" was not caught) |
| **6 boards** (registry) | Almetra (Berlin), tensordyne (Munich), adjoe (Berlin), Checkly (Berlin), Customer.io and SearchApi (remote). From resolving the 621 German `employer_candidates` and a 250-company sample of the remoteintech list to ATS boards |
| **5 employers** (watchlist, `schema.sql`) | SIXT, ALTEN, Vattenfall (Berlin), inovex (remote), Accso |

**Germany-wide remote is thin in public sources.** Measured that day:
- Bundesagentur: of 740 ads read nationwide, 69 had a relevant title outside Bayern and Berlin, and 5 said fully remote
  anywhere in the ad text (7%). The list's `homeofficemoeglich` flag means home office is possible, not full remote.
  The API has no home-office filter: the `arbeitszeit` facet holds only vz, tz, snw and mj, and `ho` returns 0.
- Remote-first companies: 15 of 250 sampled from remoteintech (876 companies) have a board with remote roles open to
  Germany or the EU, and 3 of those roles pass the title rules.
- HN "Who is hiring" (November 2026): 31 of 243 posts are remote and open to the EU or Germany.
- englishjobs.de: 1 fully remote ad in 598.

**Not built, needs a decision** (decided the same day: no alert reader, no hybrid elsewhere, German gate 8; see
"Changes 2026-11-18 (second)"):
- **Job alert emails** from LinkedIn, StepStone, Indeed and XING. Those sites cannot be read by a script (terms and
  robots.txt), but their alerts arrive in your mailbox, and the Wohnung workflow already reads alert emails from an
  Outlook folder with the same credential. Needs alerts set up (for example "Remote", Germany) and a mail rule into a
  folder. Not measured: no alerts exist yet.
- **Rest of Germany beyond fully remote.** "KI" ads in 30 days: Bayern 1,058 and Berlin 571 (50 km), against Köln 760,
  Frankfurt 590, Stuttgart 468 and Hamburg 455 (50 km each); 4,872 nationwide.
- **A lower German title gate** (`minRelevance` 10). Full-stack titles from search sources score 5-7, so most of
  englishjobs.de's Berlin and Munich software roles stop there.

**Netherlands: "only in the Netherlands".** Of 381 board ads in the Amsterdam area with the full text, 8 say you must
already live in the Netherlands and 5 are "Remote – Netherlands" only. 41 offer relocation support, 14 visa sponsorship,
and 10 ask for the right to work in the Netherlands or the EU, which EU citizens have. No source needed a VPN:
every Dutch source answered from Germany.

**Probed and rejected:**
- germantechjobs.de (DevITjobs' German site, `/api/jobsLight`): 579 jobs, 567 in German, 8 remote ones in the
  relevant categories, mostly system administration.
- hiring.cafe: robots.txt disallows the search pages (`?searchState=`). Remote Rocketship: robots.txt disallows `/api`.
- The German census found 38 boards for 585 names; 9 had a role that passes. Most German employers in the history are
  Bundesagentur advertisers on systems the workflow cannot read (softgarden, d.vinci, SuccessFactors without RSS).

## Changes 2026-11-16: Amsterdam coverage beyond the hand-picked boards

Patch: `js-check/patch-ams-coverage.py` (node code in `js-check/coverage__*.js`, boards in
`js-check/coverage__boards.json`). Test: `node js-check/ams-coverage-test.js`. Before copy:
`archive/2026-11-16/workflow-live.before-coverage.json`. Watchlist rows: `node js-check/apply-watchlist.mjs`.

**Measured live on 2026-11-16**, Netherlands only, by replaying the node code on the same day's data
(registry and watchlist boards, Workable, Arbeitnow and the feeds; Adzuna is not in either column, because
its key cannot be used outside n8n):

| | Before | After |
|---|---|---|
| Board requests for the Netherlands | 138 | 253 |
| NL jobs in | 810 | 1,518 |
| Pass `Filter Relevant` | 287 roles at 76 employers | 645 roles at 276 employers |
| Of those, not on the list yet | 190 roles at 60 employers | 416 roles at 232 employers |
| ...with an AI/ML title (relevance 8+) | 129 | 246 |
| Amsterdam slots in one run | 40 | 240 |
| ...that go to roles not in the database yet | 15 | 217 |

**Three reasons roles were missing.**

1. **No feed for the employer.** The registry reads boards one company at a time. englishjobsearch.nl, a
   search engine for English-language jobs in the Netherlands, showed what that leaves out: 46 result pages
   held 384 fresh ads at 286 employers, and 227 of them pass the filter. Among the employers: eBay, Atlassian,
   Accenture, Cisco, TomTom, Just Eat Takeaway, DEGIRO, Elsevier and a long tail of start-ups.
2. **The pool.** 40 Amsterdam slots a run against 190 waiting roles (416 now).
3. **Listed roles without a letter came back every run.** A role on the list without a letter is let back in to
   get one, and nothing limited that to the 15 letters a run. 150 roles were in that state. Replaying the old
   selection on the day's data, 25 of Amsterdam's 40 slots went to roles already in the database (20 listed
   without a letter, 3 rejected, 2 whose letter had failed) and 15 to new ones.

| Change | Detail |
|---|---|
| **englishjobsearch.nl** (feeds branch) | `useEnglishJobs`, `englishJobsSearches`. robots.txt allows the result pages. It disallows `/clickout/` (the job links: stored for you to click, never fetched by the workflow) and `?posted=` (not used). One page per request, 1.5 s apart (`Fetch Feed` batch interval). A job arrives with title, employer, city, date and a two-line extract, not the full ad, so its fit score rests on less text than a board job's |
| Repost sites and agencies | The site shows who posted the ad. Sites that repost others' ads (Jobgether, FDE Times, Vacaturebank, eFinancialCareers, ...) are dropped. Agencies are flagged, and `excludeAgencies` drops them: 58 of 391 ads in the replay. Both lists are in `Normalize Feeds` and come from the 765 ads harvested that day. They are not complete |
| **DevITjobs.nl** (feeds branch) | `useDevITjobs`. One JSON list, 255 jobs, 19 in English. Only those are kept. The list has no ad text, so the description is built from stack, level and salary |
| One employer, two names (`Dedupe & Cap`) | "Booking.com" and "Booking Holdings", "Picnic" and "picnic.app", "IMC" and "IMC Trading" count as one employer: for the companies already approached, for roles already listed, and inside a run. Decorating words (com, app, holdings, technologies, international, ...) are ignored and then one name must be the other plus more words. The stored dedupe keys are unchanged |
| Same role once per run | A role found on a board and on a search source was taken twice. Now the best-ranked copy stays, which is the board's (full ad, direct link) |
| Aggregator copies of board employers | englishjobsearch.nl rewrites titles ("Machine learning engineer in inference platforms"), so title matching cannot pair its copy with the board's. For an employer the run reads directly, the board is the full list and the aggregator's copies are dropped: 227 englishjobs ads pass the filter, 132 are listed |
| Come-back cap | At most `maxApplyYourselfLetters` (15) listed-without-letter roles come back per run. A role that now names someone to email still comes back |
| Pool | `scorePoolSize` 100 → 300, `priorityPoolShare` 0.4 → 0.8: 240 Amsterdam slots, and 60 for the other regions as before. After one or two runs only new ads fill it. To go back: 100 and 0.4 in Config |
| **42 boards** (registry) | Found by resolving the employer names from englishjobsearch.nl and the 114 Amsterdam rows of `employer_candidates` (679 names; board-name guesses on six ATS APIs, then the employer's own site). Kept only with a live matching role in the area. AI: CuspAI, Tavily, Pinely, Optics11, UbiOps, Lleverage, Ascending AI, SkinVision, Indurex, Aquablu, Axelera AI, Deepgram, Mimica, INDG, Toku. Engineering: Tebi, Manychat, Overstory, Fidamy, FeedbackFruits, Poki, Teero, Clipbook, QuantWare, Redwood Software, Telnyx, Workwize, OpenUp, Momo Medical, iwell, Freeday, Intelic, Fixico, Vesper, Roamler, Luscii, Shiftbase, Learned, Online Payment Platform, Budget Thuis, Moonwatt, Revelane |
| **23 employers** (watchlist, `schema.sql`) | Larger employers and consultancies, where the title still has to say what the role is: KPN, DPG Media, Schuberg Philis, Sytac, Vinted, Sia, Devoteam, TOPdesk, Lefebvre Sdu, Yellowtail Conclusion, Artefact, Monks, CLEVR, Amsterdam Data Collective, Riverflex, ISISPACE, Vitestro, ViCentra, Qualinx, CCS Connects, ILIAS Solutions, YTEC, Instant Commerce |

**Not verified.** Whether an englishjobsearch.nl job link still works days later. The links are signed
redirects, and fetching one to test it is what robots.txt disallows, so none was fetched. Click one from the
list. If old links turn out to expire, the role is still findable by title and employer.

**Probed and rejected:**
- EURES (`europa.eu/eures/api/jv-searchengine/public/jv-search/search`, public, crawl-delay 10): tens of
  thousands of Dutch ads, but nearly all come without the employer's name, and most are in Dutch.
- JobFluent: robots.txt disallows AI agents by name, so it was not probed.
- Dutch Tech Jobs and Scaleup Jobs: the domains now serve gambling spam.
- Techleap's job board: both known hosts no longer resolve.
- Amazon (`amazon.jobs/en/search.json`, public): 2 software roles in the Netherlands.
- NoFluffJobs: robots.txt disallows `/api/` and `/nl/posting/`.
- Relocate.me: no job links in the page HTML. Magnet.me (students and graduates): looked at one page, not pursued.
- englishjobsearch.nl sorted by date: 6 to 9 relevant ads in 40, against about 10 in 20 in best-match order.
  Its Noord-Holland province page: 3 new ads in 6 pages on top of the Amsterdam city page.

**Found, not added.**
- Workday tenants for Accenture, Elsevier (`relx|wd3|ElsevierJobs`), PwC, Palo Alto Networks, Signify and Red
  Hat. Workday answered 429 to 10 of 11 requests one second apart while they were being checked, so they
  could not be verified. If the digest's "Career feeds that failed" line names Wolters Kluwer or NVIDIA, the
  existing Workday feeds hit the same limit: `Fetch Workday` sends 4 at a time.
- Employers on systems the workflow cannot read: Teamtailor (ParkBee, Quatt, Signicat, Bugaboo), Workable
  accounts (Runware, Deployteq, Expereo), BambooHR (Context Labs), Homerun (Trustoo, Snappcar). Their jobs
  still arrive through englishjobsearch.nl, without the full ad.
- `rejectRecheckDays` is 0 in the live Config (the tuning table says 30), so a rejected role is not held back
  and is scored again whenever it is picked. 24 rows are in that state; 3 of them took Amsterdam slots in the
  replay.

## Changes 2026-11-09 (third): much more Amsterdam data

Patch: `js-check/patch-ams-more.py`. Test: `node js-check/ams-more-test.js`. Before copy:
`archive/2026-11-09/workflow-live.before-ams.json`.

**Why Amsterdam looked thin.** The scoring pool (60) was filled by title relevance across all regions. In
the live replay Amsterdam got **3 of 60** slots: Bavarian and Berlin Bundesagentur AI titles outrank it. And
one job per company per run meant a big Amsterdam employer showed one role a run.

| Change | Detail |
|---|---|
| `priorityPoolShare` 0.4 | 40% of the pool goes to `priorityRegion` (amsterdam) first, best relevance first; the rest by relevance |
| `scorePoolSize` 60 → 100 | more roles scored, listed and exported per run |
| `maxRolesPerCompany` 3 | apply-yourself jobs: up to 3 per company per run. A job that can be emailed still keeps its company to itself |
| `minRelevanceNL` 10 → 5 | measured earlier: 81 → 225 NL roles pass |
| **Booking.com** (`jibe` type) | public jobs API on jobs.booking.com (robots allows /, crawl-delay 5): 60 Amsterdam roles, 19 engineering/data, with full descriptions |
| **ING**, **ABN AMRO** (`sitemap` type) | robots-allowed job sitemaps. Title and (for ING) city come from the URL; the ad comes from the page's schema.org JobPosting via Fetch Detail. ING: 32 NL roles; ABN AMRO: 141 vacancies, 32 engineering/data |
| 8 boards | Robin Radar, Eye Security, Samba TV, Ohpen, Gain, Surfly, GreenFlux, The Inner Circle |
| Workable | 6 more terms (software, python, backend, full stack, data engineer, platform): Amsterdam 84 → 118 English jobs in 30 days |
| Dutch gate after detail | Email Hunt drops NL ads in Dutch, or demanding Dutch, that arrived only with the detail fetch (sitemap/Workday/Eightfold) |

**Probed and rejected:**
- Built In "Amsterdam": 567 cards, **0** located in the Netherlands (Berlin/Munich/multi-location).
- EURES: the search endpoint has moved (404).
- Uber: robots.txt disallows `/api/`.
- TomTom: its sitemap has no location.
- Philips: no NL job URLs in its sitemap.
- ASML: Veldhoven, outside the Amsterdam area.
- Discovery is near saturation: of 94 more company candidates, 8 had live NL roles.

## Changes 2026-11-09 (second): Bavaria any mode, rest of Germany fully remote, more German sources

Patch: `js-check/patch-germany-remote.py`. Test: `node js-check/germany-remote-test.js`. Before copy:
`archive/2026-11-09/workflow-live.before-remote.json`.

**Rules (the user's choice):**
- Bavaria, the Berlin area and the Amsterdam area: office, hybrid or remote.
- Anywhere else in Germany: **fully remote only**, either Germany-wide or EU/Europe-wide remote.

`regions` = amsterdam, berlin, bayern, remote.

| Source | Change | Measured |
|---|---|---|
| Bundesagentur, Bavaria | `wo=Bayern` is a whole-state search (`BUNDESLANDSUCHE`); `deLocations` = Berlin, Bayern | "KI": 1,888 ads in Bavaria vs 901 within 50 km of München |
| Bundesagentur, remote | Nationwide (`wo=Deutschland`) search for `remoteKeywords`. A job outside Bayern/Berlin counts only if its title says fully remote ("100% remote", "full remote", a plain "remote" without "möglich/hybrid/Tage") | 32 dev roles (8 AI), 17 with an application address |
| Bundesagentur, agencies | `pav=false&zeitarbeit=false` on every query: agencies are dropped by the API | "KI": 7,602 → 6,553 |
| Registry boards | "Remote - Europe/Germany/EMEA/DACH" locations, plus Ashby/Lever/Recruitee remote flags, map to `remote` when no city matches; US-only remote is dropped | 109 such dev roles (35 AI) on the existing boards had been thrown away |
| Arbeitnow | `remote: true` outside the cities → `remote` | 40 dev roles |
| Workable | Munich, Nuremberg, and Germany with `workplace=remote` | 24 remote dev roles in Germany |
| **Jobicy** (new feeds branch) | Remote jobs open to Germany or Europe; public API, two calls per run | 28 Germany-eligible dev roles |
| **service.bund.de** (new feeds branch) | The federal job portal's RSS (robots.txt blocks only its search pages); only Bavaria/Berlin postcodes are kept | about 5 IT roles per refresh, e.g. "Forschungsreferentin Deep Learning für Bildanalyse und Generative KI" |
| **37 boards** | Bavaria: Alexander Thamm, Clera, AutoScout24, Perelyn, Uncountable, JetBrains, NavVis, appliedAI, ottonova, IntraFind, Kyrall, KINEXON, Workato, Manex AI, Intrinsic, Smartsheet, Flix, nerdware, TWAICE, Munich Electrification. Berlin: IONOS, Tide, Zeta, NICE, Ubiquiti, Planet Labs, Sony Interactive, Flatiron, Domino, ImmoScout24, Gallup. Remote: Mozilla, Grafana Labs, Oneleet, Mitratech, Camunda, Fivetran | from web search, a public list of 52 Germany-hiring Greenhouse boards, and the YC dataset; each probed live |

**Probed and rejected:**
- heise jobs, kimeta, StepStone and ZEIT Jobs: robots.txt disallows search/API access.
- Munich Startup: jobs load through a disallowed `/api/`.
- Remotive, Himalayas, We Work Remotely, RemoteOK, Working Nomads, Landing.jobs: 0–4 Germany/EU-eligible dev roles each.
- The Bundesagentur `homeoffice` filter rejects every value; the API answers "Wert ungültig".

## Changes 2026-11-09: Amsterdam + Berlin only, a quality floor for email, more Berlin sources

Patch: `js-check/patch-berlin-ams.py`. Test: `node js-check/berlin-ams-test.js` (other NL tests
updated). Before copy: `archive/2026-11-09/`.

**What went wrong.** Between 13 Oct and 9 Nov the flow emailed 71 applications: 51 in Bayern, 17 in
Berlin, 3 in Amsterdam. 22 of them had fit 20–38. They included a Junior HR Manager trainee post, a
professorship, a translation officer, a WordPress admin at a landscaping firm, and three placement agencies.

| Fix | Detail |
|---|---|
| `regions` = amsterdam, berlin | Plus a hard region gate in Filter Relevant. The database backlog bypasses Filter Relevant, so Plan Run and Dedupe & Cap filter it too |
| Region from the query | Normalize DE filed every non-"Berlin" place under Bayern, so Hennigsdorf and Nuthetal (Berlin suburbs in Brandenburg) counted as Bayern. The region now comes from the search that found the job |
| `minFitScoreEmail` (40) | Below it, an address never reaches Auto-send?. The job goes on the apply-yourself list with the address shown (`publishedEmail`, the export's Email column). At 40, 15 of the 20 past Amsterdam/Berlin mails would still have gone out; at 50, only 7. The scorer is harsh |
| `emailHuntFactor` (2) | Email Hunt collects twice the target, because some finds will fall under the floor |
| `titleExclude` | Adds professur, dualer, referent, assistent, koordinator, administrator, patent, sps, übersetzung, produkt-/projektmanager, product owner, enablement, manager, berater, systemintegration. All 11 bad titles from the past mails are now dropped |
| Agency names | Adds Arbeitsvermittlung, Personalmanagement, Talent Partner, TEMPTON |
| `baPages` 3 | Berlin goes from 428 to 676 unique ads, and from 1 to 3 not-yet-contacted ads with an address |

**New sources.**
- **Workable job search** now covers Berlin as well (about 60 jobs in 30 days, nearly all in English).
- **24 boards** from web searches of Ashby, Greenhouse, Lever and Personio, HN "Who is hiring" (Nov 2026)
  and the YC company dataset (`yc-oss`), each probed live:
  - AI: Prior Labs, Aleph Alpha, Sensmore, Bluefish AI, Smartly, Intercom, ICEYE, Cresta, HTGF, super.AI,
    Autonomous Teaming, Moss.
  - Engineering: Air Apps (Berlin and Amsterdam), LiveEO, 1KOMMA5°, NetBird, Kombo, telli, thermondo,
    Grover, Powerus, Billie, Merantix AI Campus, Stream (Amsterdam).
- **Personio** is now a registry ATS, including the newer `*.jobs.personio.com` boards (the token is the full
  host). Descriptions come in English.

**Measured live on 2026-11-09** (morning workflow vs now, Amsterdam + Berlin only): Berlin roles passing
the filter went from 94 to 128 and Amsterdam from 82 to 84. Workable intake went from 89 to 138.

**Probed and rejected:** Berlin Startup Jobs, startup.jobs and Welcome to the Jungle (Cloudflare blocks
scripts). GermanTechJobs RSS: public, but only about 23 of 646 items mention Berlin, and location is not
a field. Recruiter addresses in Berlin board, Workable and Arbeitnow ads: 0 of 28 new ads invite an email
application.

**Email volume in Amsterdam and Berlin is low, by design of those markets.** Bayern produced 51 of the
71 mails. In Berlin, most Bundesagentur ads with an address are from companies already contacted
(suppressed for `rememberDays`), and today's run found 1–3 new ones. Startups and scale-ups there
hire through their own forms. So for these two cities the main output is the apply-yourself list with
letters.

## Changes 2026-10-13 (fourth pass): search until there are enough jobs to email; one list file

Patch: `js-check/patch-email-hunt.py`. Test: `node js-check/email-hunt-test.js` (gate-test and
nl-email-export-test updated). Before copy: `archive/2026-10-13/workflow-live.before-email-hunt.json`.

**Where the email jobs were.** Measured live on the Bundesagentur search, with your real history:

| Setting | Candidates (one per company) | With an address |
|---|---|---|
| Title gate 10 (yours), 1 page | 29 | 4 |
| Title gate 10, 3 pages | 31 | 4 |
| Title gate 5, 1 page | 289 | 79 (62 of them beyond the 60-role pool) |

Deeper pages add nothing. The addresses sit in roles one or two steps under the title gate, mostly
"AI Engineer", "Senior AI Developer" or "KI-Architekt" at search-tier relevance 8–9, which miss
10 by the curated bonus.

**Email Hunt.** Filter Relevant now keeps roles that can be emailed (Bundesagentur ads, NL ads
naming someone) down to `minRelevanceEmail` (5) as a reserve. Dedupe & Cap passes the reserve on,
one per company, history applied, priority region first and then relevance. If the pool holds fewer
than `emailTarget` (= `maxPerRun`, 30) jobs with an address, Email Hunt fetches reserve ads 5 at a
time and stops the moment the target is met. Unused reserve is not recorded, so it is considered
again next run. Live replay: 4 in the pool, 26 found after 90 ads, 7 seconds. The digest shows
target, checked and found. Apply-yourself letters now have their own cap (`maxApplyYourselfLetters`,
15), so a full email run can't starve them.

Also: the Bundesagentur agency filter missed "Recruitment", "Personalservice" and Ratbacher, which the
below-gate roles are full of. Added.

**One list file.** `exportDir/apply-yourself.xlsx` replaces a new dated file per run. It is
overwritten every run and rebuilt from Postgres: every open apply-yourself job (status `manual` or
`send_failed`, last 2 × `maxDaysOld` days), Amsterdam first, then fit, with a "new" column for
today's. There is no digest attachment any more; the digest says how many rows were written or
why not (file open in Excel, or n8n not restarted with `start-n8n.ps1`). To take a job off the
list once you've applied, use "Mark applied" in the job list UI, or:

```sql
UPDATE job_applications SET status = 'applied_manually' WHERE url = '<link>';
```

## Changes 2026-10-13 (third pass): email first, letters and an Excel list for the rest

Patch: `js-check/patch-nl-email-export.py`. Test: `node js-check/nl-email-export-test.js`
(gate-test.js updated). Before copy: `archive/2026-10-13/workflow-live.before-email-export.json`.

**Email first.** Letter slots (`maxPerRun`) go to jobs with an address first: the database backlog,
then `priorityRegion` (amsterdam), then fit. Apply-yourself jobs take the slots that are left.

**Netherlands ads with an application address.** Of 457 live NL ads, 27 contain an address.
Most are for questions ("Should you have any questions, contact jobs@crisp.nl"), privacy requests,
campus recruiting or open applications, and those never count. An address counts only when the
sentence leading up to it invites the application or contact: "Apply now or reach out to our
Recruiter Marco: …", "Send your application … to Liesbeth at …". Free-mail and role addresses
(`support@`, `privacy@`, …) never count. The rule is checked against 10 real sentences in the
test. It also applies when a Workday or Eightfold ad arrives with the detail fetch. Extract
Contact used to overwrite every non-Bundesagentur address with an empty one; now it keeps them.

**Letters for apply-yourself jobs.** Since 2026-09-29 these got none. Now they get letters from the
free slots. Roles already on your list without a letter (16 Amsterdam, 19 Berlin) come back once to
get one. A listed role whose ad now names someone to email also comes back, and is emailed.

**Export.** `Build Export → Export to Excel → Send Digest` (attached) `+ Write Export`
(`exportDir/apply-yourself-<date>.xlsx`). It has one row per apply-yourself job, priority region
first: company, role, city, fit, status, link, why you fit, gaps, subject, cover letter and
LinkedIn note. Failed sends are included. Writing to disk needs `exports/` in
`N8N_RESTRICT_FILE_ACCESS_TO`, which `start-n8n.ps1` now sets: restart n8n with it once. Until
then the disk write fails without stopping anything, and the attachment still arrives.

## Changes 2026-10-13 (second pass): more Netherlands sources

Patch: `js-check/patch-nl-sources.py`, run after the first one. Test: `node js-check/nl-sources-test.js`.
Before copy: `archive/2026-10-13/workflow-live.before-sources.json`.

| Source | What it adds | How it was found / checked |
|---|---|---|
| **Workable job search** (new branch, 3 nodes) | International scale-ups on Workable: Enjins, Modash, Soda Data, Keylane, Station, Expereo. 67 unique NL jobs in 30 days, all English | `jobs.workable.com/api/v1/jobs`, keyless JSON. robots.txt disallows only the HTML `/search` pages. `location=Amsterdam` already returns Utrecht and Haarlem jobs; Rotterdam adds Den Haag |
| **Eightfold** (new ATS type) | Qualcomm AI Research ("Senior Deep Learning Researcher – Model Efficiency") and Netflix Amsterdam ("Research Scientist – ML and Inference Research") | robots.txt allows `/api/apply` and `/api/pcsx`. The list has no description, so `Fetch Detail` reads `/api/apply/v2/jobs/<id>` |
| **17 more registry boards** | Mistral AI (24 NL roles, 12 AI), Together AI, Yuno, Airwallex, Monumental, myTomorrows, Altura, Plumerai, qlub, Attendi, MotherDuck, Awin, Coda, Tether, Rentman (Utrecht), plus the two Eightfold sites | Web searches of `jobs.ashbyhq.com`, `job-boards.greenhouse.io`, `jobs.lever.co` and HN "Who is hiring" (Oct/Sep 2026); every token probed live |
| **Watchlist** (Postgres + `schema.sql`) | NVIDIA ("Deep Learning Software Engineer, Inference"), ServiceNow ("Applied AI FDE") | Workday country facets differ per tenant: NVIDIA's is `locationHierarchy1` |

**Measured live, NL only.** The same day's data was replayed through the morning's workflow and the
current one (registry boards, Workable with the node's own pagination expressions, Arbeitnow):

| | Morning | Now |
|---|---|---|
| NL boards queried | 42 | 63 |
| NL jobs in | 450 | 660 |
| Pass `Filter Relevant` at gate 10 | 38 | 81 (46 new roles at 13 companies new to the shortlist) |
| Pass at `minRelevanceNL` 5 | 148 | 225 (Workable: 13) |

Workable passes nothing at 10. Its jobs are search-tier, so "Lead AI Engineer" at Enjins scores 6 and
"AI Content Engineer" at Soda Data scores 9. It earns its place only with a lower `minRelevanceNL`.

Also fixed: Normalize ATS's engineering-title filter had `\bresearch\b`, which never matches
"Researcher", so every "Deep Learning Researcher" title was dropped before ranking. Arbeitnow now
carries Amsterdam jobs too (187 NL entries in 5 pages on 2026-10-13), and its location list matches
the others.

**Probed and rejected:** The Muse (ignores the location filter; its NL roles are Flexport and
Celonis, already in the registry), Landing.jobs (Portugal; 0 of 50 in NL), IamExpat
(robots.txt disallows `/job/`), adzuna.nl (CloudFront blocks scripts), Workday for Qualcomm,
Netflix, Intel and Philips (Qualcomm and Netflix moved to Eightfold; Philips' NL roles are
internships). Utrecht Recruitee employers (Conflux, adesso, NVM) write in Dutch. HN "Who is hiring"
has 6–7 NL posts a month in free text: good for finding companies, too thin to parse as a source.

## Changes 2026-10-13: Netherlands search (Amsterdam area, Utrecht, Randstad)

Patch: `js-check/patch-nl-search.py`. Test: `node js-check/nl-search-test.js`. Before copy in
`archive/2026-10-13/`.

**Adzuna had never returned a job.** Runs 41 and 43: 36 of 36 calls failed with an nginx
`400 "Uh oh, something isn't right"` page. That page is what Adzuna sends when `app_id` or `app_key`
is *missing* (a wrong key gets a JSON `401 AUTH_FAIL`). n8n's Query Auth credential holds exactly one
name/value pair, so it can never send both. Moving the keys out of Config broke this source, and the
Netherlands has run on the company boards alone since then. `Fetch Adzuna` now uses a **Custom
Auth** credential (see Credentials). Until you create one, the digest keeps saying "Source returned
nothing: adzuna", as it has been.

**NL Adzuna queries.** Each query returns only the 50 newest ads, so the old single 60 km circle
around Amsterdam saw the newest 50 for the whole Randstad. Now three centres at 30 km (Amsterdam,
Utrecht, Rotterdam) each get their own 50, with English terms only, since "KI" and "Softwareentwickler"
find nothing useful there. Overlapping centres are deduped by Adzuna id. Free keys allow
25 calls/min and 250/day, so `Fetch Adzuna` sends one call per 2.6 s. `adzunaMaxCalls` (60) caps a
run, with NL queries first: 42 NL plus 18 DE, about 2.5 minutes. The NL query design is not yet
measured live, because no working key existed and adzuna.nl blocks scripted requests.

**Company boards, measured live on 2026-10-13** by replaying the old and new node code on all
Netherlands boards:

| | Before | After |
|---|---|---|
| NL boards | 42 | 46 (+DataSnipper, ClickHouse, Flexport, Insify) |
| NL engineering roles after region match | 262 | 315 |
| Pass `Filter Relevant` at your `minRelevance` 10 | 36 | 49 |

- **Secondary locations.** Ashby `secondaryLocations` and Lever `allLocations` are now read.
  ElevenLabs, Cradle and Prosus list Amsterdam as one location among several. A job whose primary
  location is in a wanted region keeps that region. Greenhouse `offices` is *not* used: Nebius tags
  a Singapore electrical-engineering role with its Amsterdam office.
- **Dutch-language gate** (`skipDutchRequired`). It skips NL ads written in Dutch, and English ads
  that demand fluent Dutch. A requirement softened in the same sentence keeps the job: "Dutch is a
  plus", "English and/or Dutch", "or want to learn", "useful but not required". On live data it
  skipped 38 roles: 20 written in Dutch (CZ, True, Xccelerated) and 18 English ads with a hard
  requirement ("Dutch is a must", "mandatory", "B2 level Dutch"). All 38 were checked by hand.
  Utrecht's Recruitee employers (Conflux, adesso, NVM/brainbay) write every engineering ad in Dutch,
  which is why the boards add little for Utrecht. Your Utrecht route is the international employers
  already listed (bol, Channable) plus Adzuna.
- **Title relevance.** Bare "ML" ("ML Infrastructure Engineer" scored 4, now 11), "agentic" and
  "inference" count as AI. Two patterns never matched their own titles: `\b(data scien)\b` and
  `applied scien\b` need a word boundary mid-word, so "Data Scientist" and "Applied Scientist" scored
  0 there. Now 4 and 8. This applies to every region.
- Region regex: commuter towns (Nieuwegein, Zeist, Houten, Zoetermeer, Rijswijk, Capelle, Weesp,
  Purmerend, …) and Noord-/Zuid-Holland. "Medior" folds like "Senior" in dedupe. "stagiair" and
  "afstudeer" join the title excludes; " ml " and "agentic" join `titleMustMatch`.

**`minRelevance` 10 is the biggest remaining NL limit.** At 10, 49 NL roles pass. At the README
default of 5, 141 pass. A full-stack title at a curated company maxes out around 9
(full-stack 5 + curated 2 + senior 1 + remote 1). So at 10, the `nlKeywordsFullStack` Adzuna terms
and roles like Adyen's "Senior Backend Engineer" can't pass at all. That was left as you set it.

---

## Changes 2026-09-24: faster sending, plus bugs found by running it

All three live workflows were run end to end in n8n 2.39.8 against a local mock of every API
(boards, Bundesagentur, Arbeitnow, OpenRouter, Outlook, Postgres). Doing that surfaced bugs that
reading the JSON never had. Originals are in `archive/2026-09-24/`.

**Speed.** Before, one job at a time went detail → score → letter → wait → send, with a random
**1–25 minute** wait before *every* mail (1–40 in speculative). A real
run took **68 minutes for 3 mails**, and 65 of those minutes were the wait node sleeping. Now:

- Detail fetches, scoring and letters run **concurrently** (batched HTTP): 8 scores in ~1 call's
  time instead of 8×, and the same for letters.
- Mails are spaced **20–55 s** apart (`sendGapMinSeconds` / `sendGapMaxSeconds`); the first goes
  immediately. 3 mails take ~1 minute instead of up to an hour. Under 65 s n8n keeps the wait
  in memory rather than parking the execution in the database.

**Bugs fixed** (each one reproduced first, then verified fixed):

| Bug | Effect |
|---|---|
| `Fetch DE Detail` used `$base64Encode()`, which n8n doesn't have. The URL evaluated to `undefined` | Every Bundesagentur detail fetch failed: no descriptions, **no contact emails, so nothing was ever auto-sent**, and scoring saw titles only. Now `$json.ref.base64Encode()` |
| `Dedupe & Cap` ranked `$input`, which is `Load History`'s Postgres rows | v2 scored history rows instead of jobs. Now reads `Filter Relevant` |
| Every digest was built from `$input`, i.e. the INSERT result `{success:true}` | Digests reported "0 sent" with blank cards (seen in a real run that sent 3). Now built from the recorded outcomes |
| Lever returns a JSON array, which the HTTP node splits into one item per job | Qonto was silently dropped; a Lever board earlier in the registry would shift every later board onto the wrong company. Boards are now fetched as text, one item each |
| Company matching was case-folded only | "Rohde & Schwarz" in history didn't match "Rohde & Schwarz GmbH & Co. KG", and Nebius / Nebius B.V. / Nebius GmbH counted as three companies, so the same company got several applications. Legal forms and punctuation are now folded |
| `rejected_fit` never suppressed anything | The same top-ranked rejected role won its company's slot every morning, so the company's better roles were never scored. Now the rejected role (and near-identical reposts) is skipped for `rejectRecheckDays` |
| API failures looked like `fit 0` / empty letters and were logged as `rejected_fit` | Now `score_failed` / `letter_failed` / `send_failed`, shown in the digest; the first two are retried next run |
| An empty day stopped before the digest | The "source returned nothing" alarm could never fire on the day everything broke. The digest now always goes out, tagged `[CHECK]` |
| Source alarm counted only the ~8 shortlisted roles | False "returned nothing" whenever a source had no role in the shortlist. Now counts raw intake |
| `Load History` / `Load Contacted` ran once per incoming item | 168 identical SELECTs per run. Now `executeOnce` |

**Flow.** v2 scores a wider pool (`scorePoolSize`, 24) because scoring is cheap and parallel.
The `maxPerRun` letter slots go to the best *fit*, not the best title; passers beyond the cap
are listed as "held for a later run".

## Verified behaviour

Tested against live APIs, not assumed:

- Bundesagentur: search is **v6**, detail is **v4** (v5/v6 detail → 403). Results under
  `ergebnisliste`. This mixed-version split is the most likely future breakage.
- Contact emails appear only in description free-text, ~31% of postings, and run into the next
  word (`jobs@firma.comBewerbende` was real). Extraction trims on a TLD boundary, lowercases, and
  drops `noreply`/`postmaster`.
- All 35 registry boards resolve; company attribution verified correct across 350 roles.
- Dedupe verified: re-running with history produces **0 repeat companies**; fuzzy matching collapses
  same-company title variants.
- `Record Outcome` verified at runtime to emit exactly the 15 columns `INSERT` expects, across all
  three branches (sent / queued / rejected_fit).

## Not built, deliberately

**LinkedIn Easy Apply** — against ToS, and detection costs the account. LinkedIn is where referrals
actually happen for AI roles; the account is worth more than the automation.
**Workday / SuccessFactors form automation** — per-tenant DOM, anti-bot, permanent maintenance.
**Volume past ~10/day** — German AI hiring is small and networked. Recruiters at Helsing, Parloa and
Merantix talk to each other; response rate falls faster than volume rises.

See `ANALYSIS.md` for the full reasoning and the remaining roadmap (reply loop, funnel metrics,
own sending domain).
