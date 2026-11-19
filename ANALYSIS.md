# Gap analysis: what's missing for full automation

Everything below is measured against the live APIs, not assumed. Numbers come from 118 real
AI/ML postings in Berlin/München/Nürnberg (30-day window) plus direct probes of the ATS APIs.

---

## The headline finding: the current pipeline is aimed at the wrong market segment

Here is who actually posts AI roles to the Bundesagentur, from the live sample:

> BMW, BWI, Bayer, Siemens Energy, Zalando, Google Germany, JetBrains, EY, Capgemini,
> Deloitte, Avanade, inovex, BridgingIT, ARRK Engineering, Union Investment

Enterprises, Konzerne and consultancies. Now the ones that are **completely absent** — and what
they have open right now, which I checked directly:

| Company | Openings on their ATS | In Bundesagentur? |
|---|---|---|
| Helsing (München/Berlin) | **156** | no |
| Parloa (Berlin) | **50** | no |
| Anthropic | 608 | no |
| GitLab | 220 | no |

AI-native companies do not post to the federal employment agency. They hire through
Greenhouse, Lever and Ashby. **The current workflow structurally cannot see the segment most
relevant to an AI engineer.** This is the single biggest gap and it isn't a tuning problem —
no threshold change reaches those jobs.

A second measured point kills the obvious workaround. Of 118 postings, 71% contained a URL, but
almost none were apply links. The hosts were:

```
17  arbeitsagentur.de        10  get-in-it.de       6  jobexport.de
 5  empfehlungsbund.de        4  job.fish           2  gute-jobs.de
```

These are **aggregator redirects**, not ATS endpoints. Exactly one posting in 70 had a direct
apply link (`aconium.jobs.personio.de/job/2647793#apply`). So you cannot derive an application
endpoint from agency postings — you have to go to the ATS boards directly.

---

## Gaps, in priority order

### P0 — Add an ATS board registry as a first-class source

Greenhouse, Lever and Ashby all serve **public, keyless, auth-free** job board APIs. Verified:

```
GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs        200, 608 jobs
GET https://api.lever.co/v0/postings/{token}?mode=json             200
GET https://api.ashbyhq.com/posting-api/job-board/{token}          200, 71 jobs
```

There is no central directory of board tokens — you curate a list of target companies once
(Berlin/München/Amsterdam AI companies, maybe 80–150 tokens) and it becomes a durable asset.
This is a few hours of research that outperforms every other change on this list.

### P0 — Replace workflow static data with a real database

`$getWorkflowStaticData` is currently the only memory of what you've applied to. It is **wiped
when the workflow is re-imported or replaced**, and it has size limits. The failure mode is
concrete and embarrassing: re-import the workflow, and the next run re-applies to companies you
already contacted. You are one import away from that today.

A Postgres table also unlocks everything in P1 — reply matching, funnel analytics, cross-workflow
dedupe, an audit trail of what was actually sent.

### P1 — Application submission: READ is open, WRITE is not

> **Correction.** An earlier draft of this document claimed the Greenhouse and Lever apply
> endpoints were usable to submit applications automatically. That was wrong, and it was the
> central claim — so it is corrected here rather than quietly edited away.

The distinction that matters:

| | Greenhouse | Lever | Ashby |
|---|---|---|---|
| **Read** job board | public, keyless ✅ | public, keyless ✅ | public, keyless ✅ |
| **Submit** application | employer API key ❌ | employer API key ❌ | `candidatesWrite` ❌ |

Verbatim from the docs:
- Greenhouse: *"This method requires HTTP Basic Auth over SSL/TLS: the Basic Auth username is
  your API key (found on the API Credentials page)."*
- Lever: *"not usable by unauthenticated third parties... Candidates cannot submit applications
  directly using this endpoint without the employer's credentials."*

These endpoints exist so a **company** can wire its own careers page to its own ATS. The key
belongs to the employer. A candidate cannot obtain one, and using one you weren't issued isn't a
grey area.

Greenhouse also states its application path has *"built-in spam protection measures"* — which is
the answer to "why not drive the form with a browser instead".

**So the final submit stays manual.** That is not the defeat it sounds like. Everything *around*
the submit automates cleanly: discovery, ranking, the cover letter, the tailored CV, the salary
and start-date lines, and pre-computed answers to the screening questions. The human action
reduces to opening a deep link and pasting prepared content — call it 30 seconds per role.

One caution that still applies to those prepared answers: **screening questions decide outcomes.**
A live Greenhouse example — *"Are you currently located in SF/NYC or open to relocating?"*,
required, single-select. These need answers you have mapped deliberately, not answers a model
guessed. Greenhouse now also returns `ai_disclaimer` / `include_ai_disclaimer` /
`ai_opt_out_request_url`; some employers state policies on AI-generated applications. Worth
reading rather than ignoring.

Workday, SuccessFactors and Personio have no public apply API either. See "what not to build".

### P1 — The reply loop (this is what "fully automated" actually means)

The system is currently write-only. It sends and never learns. Missing:

- IMAP/Graph polling of the inbox, matched back to applications by thread or company
- LLM classification: rejection / interview invite / info request / auto-acknowledgement
- Auto-response to the easy ones, calendar hold for interview invites
- Follow-up nudge after N days of silence
- **Funnel metrics**: response rate by source, by fit score, by letter language

Without the last one you have no evidence that any threshold is set correctly. `minFitScore: 70`
is a guess right now, and will stay a guess until replies are tracked.

### P1 — Score before generating, not after

Current order is backwards: a letter is generated for **every** job, then filtered on a `fit`
score produced by *the same call that wrote the letter*. The model is grading its own homework —
it has just spent 250 words arguing you're a good match, so the score is biased upward.

Invert it: a cheap scoring pass (small model, no letter) → gate → full generation only for
passers. Roughly 3–5× lower LLM cost and an unbiased gate. This is a small change with
disproportionate payoff.

### P2 — Email deliverability will become the bottleneck

Sending volume from `you@example.com` is a liability: you don't control SPF/DKIM on
hotmail.com, personal Microsoft accounts have send limits and burst heuristics, and a suspension
takes your primary address down with it. Move to a domain you own with proper SPF/DKIM/DMARC via
Postmark, Resend or SES. Keep the reply-to on an address you actually read.

Also: all 8 applications currently fire simultaneously at 07:30. Real people don't do that. Jitter
across a few hours.

### P2 — Cross-board deduplication needs fuzzy matching

Once there are 4+ sources, the same job arrives repeatedly as `AI Engineer (m/w/d)` /
`AI Engineer (w/m/d), Berlin` / `Senior AI Engineer`. The current key is exact-normalized
`company|title`, which treats all three as distinct — meaning three applications to one company.
Needs token-set ratio or embedding similarity with a threshold. You have already built exactly
this (the 13-step fuzzy matcher over 58k DETSIS records) — it transfers directly.

### P2 — German application conventions are unhandled

Mittelstand and Konzern applications frequently treat these as mandatory, and filter on their
absence before a human reads anything:

- **Gehaltsvorstellung** (salary expectation) and **Eintrittstermin** (start date)
- **Bewerbungsmappe**: Anschreiben + Lebenslauf + Zeugnisse as one merged PDF, not a bare CV
- Arbeitszeugnisse / degree certificates attached

Currently a bare CV goes out with no salary line and no start date. For the enterprise segment —
which is precisely what the Bundesagentur source returns — that is a silent, structural reject.

### P2 — Silent failure has no alarm

The v6/v4 version split will break eventually, and the workflow is built to degrade quietly
(`continueRegularOutput` everywhere). That's correct for resilience and dangerous for trust: a
broken source produces an empty digest that looks identical to a slow week. Needed: an n8n Error
Trigger workflow, per-source result counts persisted daily, and an alert when any source returns
zero for two consecutive runs.

### P3 — Smaller items

- **Per-role tailored CV.** Reorder projects to match the posting, render via QuestPDF (already
  in your stack). Discipline required — reordering is fine, embellishment is not.
- **Secrets.** `adzunaAppId`/`adzunaAppKey` sit in plain text in the Config node and travel in any
  workflow export. Move to n8n credentials or env vars.
- **Amsterdam coverage is thin** — Adzuna only, and always review-queue. ATS boards fix this too.
- **Letter quality has no eval.** A small golden set with a rubric would catch regressions when
  you change the prompt.

---

## What I'd advise against building

- **LinkedIn Easy Apply automation.** Against ToS, and detection means losing the account. LinkedIn
  is also where referrals actually happen for AI roles — the account is worth more than the
  automation. Genuinely a bad trade.
- **Indeed.** Public API was discontinued; the publisher programme is closed.
- **Workday / SuccessFactors form automation.** Per-tenant DOM differences, anti-bot, multi-step
  wizards with account creation. High build cost, permanent maintenance, breaks silently.
- **Raising volume much past ~10/day.** German AI hiring is a small, networked market. Recruiters
  at Helsing, Parloa and Merantix talk to each other. Reputation damage here is not recoverable,
  and response rate falls faster than volume rises.

---

## join.com — checked, and not viable as a source

Probed directly, since it was specifically asked about:

| Path | Result |
|---|---|
| `api.join.com/v1` | `410 Gone` — deprecated |
| `api.join.com/v2/jobs` | `422` — *"'Authorization' header required"* |
| v2 token | generated in the JOIN **employer** dashboard — same employer-side pattern as the ATSs |
| `join.com/companies/sitemap-jobs-index.xml` | `403` Cloudflare challenge |
| `join.com/sitemap-index.xml` | `200`, but contains only marketing pages — blog, glossary, templates, customers. **No job listings.** |

So: the API is employer-only, and the one public path to listings is Cloudflare-gated. There is no
supported candidate-side way in. Their `robots.txt` does welcome crawlers, but the jobs index sits
behind the challenge regardless, so that welcome doesn't translate into access.

**You lose almost nothing.** join.com's own product pitch is *"post to 250+ job boards"* — its
customers' jobs are multiposted to the Bundesagentur and the aggregators you already read. join.com
is a distribution layer, not a distinct pool. You reach those jobs anyway, through sources that
don't fight you.

---

## Cold-emailing AI companies directly — measured, and it doesn't work

The plan was: mail every AI company a CV plus an LLM cover letter. It fails, but not for the reason
you'd expect. It fails on **data availability**, before any question of etiquette arises.

I took 18 companies from the registry and fetched their `/impressum`, `/karriere`, `/careers`,
`/jobs`, `/kontakt` and home pages, extracting every published `mailto:`:

```
any published email address : 8/18
careers-specific address    : 1/18     <- Nebius, hr@nebius.com
```

The other seven publish `info@`, `contact@`, `hello@`, `support@`, `press@` — general inboxes where
a CV reaches a support queue or a marketing person, not a recruiter. Helsing, Celonis, Doctolib,
Mollie, Catawiki, Zenjob, Polarsteps, Vay, Luminovo and Langdock publish **no** usable address at all.

That's not an accident. These companies route hiring through Greenhouse and Ashby deliberately;
not publishing a careers address is the point of having an ATS.

**And guessing addresses is actively harmful.** Sending to `jobs@<domain>` patterns produces hard
bounces. Hard bounces damage sender reputation, and once reputation drops, the ~31% of applications
that *do* work today start landing in spam folders. From `hotmail.com` you control neither SPF nor
DKIM, so there is nothing to repair it with. A blast doesn't just underperform — it sabotages the
channel that currently works.

There is also a German legal edge worth knowing: using Impressum-listed addresses for unsolicited
mail has case law against it under UWG §7. That is aimed at advertising, and a job application is
not advertising, so individual Initiativbewerbungen are fine. Automated bulk sending to general
inboxes is a different character of thing.

### OpenStreetMap as a company-discovery source — works, but the yield is thin

Overpass API, queried live for `office=it` and IT-industry companies:

```
Berlin    209 companies · 177 with a website · 52 with an email tag
München   161 companies · 123 with a website · 49 with an email tag
Amsterdam HTTP 429 - Overpass rate-limits; needs backoff and caching
                                    -> 287 unique companies by host
```

The OSM `email` tags are mostly `info@`, so they are not mailable targets. The **websites** are the
useful part: they feed the careers-page discovery step. So I measured that end to end — fetched
`/karriere`, `/jobs`, `/impressum`, `/kontakt` for 60 of those companies and extracted published
careers addresses:

```
careers address found: 3/60  (5%)
  job@optimal-systems.de     (OPTIMAL SYSTEMS)   /karriere
  bewerbung@hh-berlin.de     (H&H Datenverarbeitung) /karriere/stellenangebote
  jobs@ratiodata.de          (Ratiodata SE)      /karriere
```

5% is better than the 1/18 for AI startups, and the addresses are genuine purpose-built recruiting
mailboxes. But extrapolated across all 287 companies it is roughly **14 mailable addresses** — for
a fair amount of crawling. Worth having as an optional feed into the speculative workflow; not
worth treating as a primary channel. And these are IT-services and Mittelstand firms, not AI
product companies, so fit will generally be lower than the registry.

Overpass is also a shared free service — any real use needs caching and backoff, not a fresh crawl
every run.

### Where speculative applications *do* work — the inverse of the assumption

Published careers addresses are concentrated in exactly the segment the ATS registry doesn't cover:
German Mittelstand and SMEs. Real examples pulled from live Bundesagentur postings:

```
bewerbung@puresolution.de · karriere@legalhero.de · jobs@silbury.com
recruiting@adesso-group.com · jobs@set-gmbh.com
```

Those are genuine, published, purpose-built recruiting addresses — and the workflow already mails
them automatically. So the capability you asked for **mostly exists**; it is simply pointed at the
segment where it can actually land.

For the 47 registry companies, the digest fast-path is strictly better than any email: it carries
the specific role, a written cover letter, and a deep link to the real application form. Mailing
`info@` instead would be a downgrade.

---

## XING and LinkedIn — checked, and the answer is no for both

Neither offers a candidate-side route, so there is no supported way to add them:

| | Status |
|---|---|
| **XING** | Public API registration at dev.xing.com is **closed**. Existing ConsumerKey holders only; new applications cannot be registered. |
| **LinkedIn** | Jobs API is gated to **Talent Solutions partners** with an enterprise Recruiter contract. There is no public jobs-search API. Automated access is prohibited by the User Agreement. |

That leaves driving either with a personal login, which is not built here and is not recommended:

- It breaks both platforms' terms, and detection is routine rather than unlikely.
- The credentials would have to be stored in n8n in recoverable form.
- 2FA and checkpoint challenges break the automation anyway, so it needs babysitting.
- **The asymmetry is the real argument.** A LinkedIn ban is typically permanent, and LinkedIn is
  where referrals for AI roles actually happen. Risking the account to scrape listings trades a
  durable, high-value asset for a marginal one — most of those listings are reachable elsewhere.

**What was added instead: [Arbeitnow](https://www.arbeitnow.com/api/job-board-api)** — a genuine
public German job-board API, no key, no curation, no terms problem. Measured live: 800 jobs over 5
pages → 219 in-region → 7 AI-relevant, at employers the ATS registry does not reach (Nebius,
Machine Learning Reply, Legalhero, neoshare). It is German-only, so it adds nothing for Amsterdam.

### Everything else that was probed

19 further sources were tested live. Most are not worth wiring in, and saying so is more useful
than a long list of "supported" integrations that yield nothing:

| Source | Result |
|---|---|
| **ai-jobs.net** | **Dead.** Redirects to foorilla.com; `/api/`, `/feed/` and even `/robots.txt` all serve the SPA shell. |
| **SmartRecruiters** | Works, server-side filtering works (`?q=AI&country=de`). But only 2 of 40 tested employer IDs resolved, and just **BoschGroup** had in-region AI roles — **4 roles** for a whole integration. Not worth it. |
| **Personio** | Works (`{company}.jobs.personio.de/search.json`), but 3 of 10 subdomains resolved. Per-company curation for a small tail. |
| **RemoteOK / Jobicy / Remotive / WeWorkRemotely / Himalayas** | All reachable, all return AI roles — but **0 in Berlin/Bayern/Amsterdam**. US- and remote-centric. |
| **Berlin Startup Jobs RSS** | 12 items, Berlin-native, but started returning `403` under repeated requests. Unreliable. |
| **EURES** | The public URL is a web app, not an API. Would need a different endpoint. |
| **Workable / Recruitee / BreezyHR / Teamtailor / BambooHR** | URL patterns are real; my test tokens 404'd. All need per-company curation, same as the registry. |
| **The Muse** | Reachable, US-centric, 1 AI role, none in region. |

**The conclusion that matters: there are no more good aggregator APIs to add.** The lever is more
*companies* on the APIs that already work — which is where the registry expansion below came from.

---

## Amsterdam: was the weakest region, now the best-served

Before: Adzuna only, no contact emails ever, so every Amsterdam hit landed in the manual queue with
nothing automated about it.

The registry changes that. Verified open engineering roles in/around Amsterdam, right now:

```
Nebius 57 · Adyen 29 · Databricks 19 · IMC 11 · Flow Traders 7 · Mollie 5
Catawiki 4 · DEPT 3 · Typeform 3 · Datadog 2 · Polarsteps 2 · GitLab 2 …   = 153 roles
```

Better quality than the German keyword search returns, and these are exactly the trading-firm and
scale-up employers that pay well for AI engineers. Amsterdam needs no separate integration — it is
the same registry source, filtered by region.

Full registry as measured: **47 companies, 494 in-region engineering roles** —
Bayern 186, Berlin 155, Amsterdam 153.

---

## Realistic ceiling (revised down, honestly)

With submission closed off, end-to-end automation covers the **~31% of Bundesagentur postings that
carry a contact email**. Everything else ends at a prepared, one-click-away application.

But the ceiling on *useful* automation is much higher than that number suggests, because the
expensive part was never the submit — it was finding the right 8 roles out of 379 and writing 8
letters. That is fully automatable and is what this system should do.

Reframed target: **zero manual effort up to the submit button, ~30 seconds per role after it.**
Not *a browser bot fighting spam protection at 3am*.

---

## Suggested sequence

| Phase | Work | Why first |
|---|---|---|
| **1** | Postgres store + migrate dedupe off static data | Everything else needs it; stops the re-apply failure |
| **2** | ATS board registry as a source (35 companies, 379 roles) | Unlocks the segment you're actually targeting, and fixes Amsterdam |
| **3** | Score-then-generate inversion | Cheap, removes scoring bias, cuts LLM spend |
| **4** | German conventions: Gehaltsvorstellung, Eintrittstermin, merged Mappe | Silent auto-reject today in the enterprise segment |
| **5** | Reply loop + funnel metrics | Turns guessed thresholds into measured ones |
| **6** | Own sending domain, send jitter | Protects the channel before volume rises |
| **7** | Error trigger, zero-result alerting, letter evals | Keeps it trustworthy unattended |

Phases 1–3 hold most of the leverage. Phase 2 alone matters more than everything built so far.
