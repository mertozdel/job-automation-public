# Runbook — getting this running

State as of 2026-09-24: Postgres 18 on 5432 with the `jobs` database, the CV in `cv/`, and n8n
holding an **older combined canvas** (see Step 5). `portfolioUrl` is still empty.

Nothing here sends mail until **Step 9**. Steps 1–8 are safe.

---

## Step 1 — Create the database and schema

There is no `postgres` database on your install, so connect through `template1`. Local auth is
**trust**, so no password is needed.

```powershell
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
& $psql -U postgres -w -h localhost -d template1 -c "CREATE DATABASE jobs;"
& $psql -U postgres -w -h localhost -d jobs -f C:\Dev\job-automation\schema.sql
```

Verify:

```powershell
& $psql -U postgres -w -h localhost -d jobs -c "\dt"
```

Expect one table, `job_applications`. This is also the step that validates SQL I was never able to
test against a live server — if it errors, stop here and send me the message.

## Step 2 — Put your CV in place

```
C:\Dev\job-automation\cv\CV.pdf
C:\Dev\job-automation\cv\CV_de.pdf
```

Those exact filenames — they're what recipients see as the attachment. `cvPath` points at the
English CV, `cvPathDe` at the German one, which goes with German-language letters. Both are
rendered from `cv/source/CV.html` and `cv/source/CV.de.html` by `cv\render-cv.ps1`.

## Step 3 — OpenRouter key

Get a key from <https://openrouter.ai/keys>. That's all you need — no endpoint URL, no deployments.

Models are set in Config:

| Config field | Value |
|---|---|
| `scoreModel` | `deepseek/deepseek-v4-flash` |
| `letterModel` | `deepseek/deepseek-v4-flash` |

If the letters read flat, raise `letterModel` only. It affects just the ~8 roles that pass the fit
gate, so the cost difference is small. Scoring reads every full job description (up to
`scorePoolSize` per run, in parallel); only survivors get a generation call.

### Where the API key goes

**No key lives in any project file, deliberately** — a key in the repo leaks into git and into
every workflow export. Two options:

**A. n8n credential (recommended — this is the verified path)**

n8n ships a built-in **OpenRouter** credential. Paste the raw key only — it adds the
`Authorization: Bearer ...` header itself, and has a built-in connection test:

```
API Key: sk-or-v1-...
```

The nodes use `Authentication: Predefined Credential Type → OpenRouter`, so the credential
dropdown offers it directly.

n8n stores it **encrypted** in `C:\Users\<you>\.n8n\database.sqlite`, with the encryption key
in `C:\Users\<you>\.n8n\config`. Nothing to hand-edit.

**B. .env file, if you'd rather own the file**

```
C:\Dev\job-automation\.env
```

```powershell
Copy-Item C:\Dev\job-automation\.env.example C:\Dev\job-automation\.env
notepad C:\Dev\job-automation\.env      # paste the key
cd C:\Dev\job-automation ; .\start-n8n.ps1
```

`.env` is git-ignored. `start-n8n.ps1` loads it into the process environment — skipping comments,
blank values and untouched placeholders — then starts n8n. It prints only a masked prefix, never
the key.

⚠️ **Caveat for route B:** the node would have to read `{{ $env.OPENROUTER_API_KEY }}` instead of
using the credential, and whether n8n permits env access inside node expressions depends on a
setting I could not confirm for your version. Test it in ten seconds first — add a Code node with:

```javascript
return [{ json: { v: $env.OPENROUTER_API_KEY ? 'visible' : 'blocked' } }];
```

If it prints `blocked`, use route A. Route A works regardless; route B is only worth it if you
specifically want the key held outside n8n.

**Note:** effort is set by `scoreEffort` / `letterEffort` (`low` / `medium` / `high`, both default
`low`), and temperature by `scoreTemperature` / `letterTemperature`. Some reasoning models (e.g.
gpt-5.x) reject `temperature`. If you switch to one and every call fails, that is why.

## Step 4 — Start n8n

```powershell
cd C:\Dev\job-automation
.\start-n8n.ps1
```

**Use the launcher, not a bare `npx n8n`.** n8n restricts filesystem reads to `~/.n8n-files`
by default, so `Read CV` fails with *"Access to the file is not allowed"* unless
`N8N_RESTRICT_FILE_ACCESS_TO` names the `cv/` folder. The launcher sets that (and loads `.env`
if you have one). A bare `npx n8n` works for everything except attaching the CV.

Then open <http://localhost:5678>. It reuses your existing `~/.n8n`, so old workflows and
credentials are still there.

> If it refuses to start: you're on Node 24, and n8n targets Node 20/22. Install Node 22 via
> nvm-windows rather than forcing it.

## Step 5 — Import both workflows

Workflows → **⋯** → Import from File:

1. `C:\Dev\job-automation\workflow-v2.json` — 49 nodes, daily
2. `C:\Dev\job-automation\workflow-speculative.json` — 26 nodes, weekly
3. `C:\Dev\job-automation\workflow-discovery.json` — 12 nodes, daily at 06:45 (employer discovery)


Ignore `workflow.json` (v1, superseded — kept only as a no-Postgres fallback).

## Step 6 — Create four credentials

| Credential type | Name it | Settings |
|---|---|---|
| **Postgres** | `jobs-db` | host `localhost`, port `5432`, database `jobs`, user `postgres`, password **empty** |
| **OpenRouter** | `openrouter` | Just the API key. n8n adds `Bearer` itself. |
| **Microsoft Outlook OAuth2 API** | `outlook-account` | see below |
| **Custom Auth** *(optional)* | `adzuna` | JSON `{"qs": {"app_id": "…", "app_key": "…"}}`. Not Query Auth: it sends one parameter, Adzuna needs both and answers a 400 page otherwise |

### Microsoft Outlook OAuth2 — the fiddly one

SMTP app passwords stopped working on **30 Apr 2026**, so this is the only route for
`you@example.com`. In Entra ID (portal.azure.com) → **App registrations** → New registration:

1. Supported account types: **"Accounts in any organizational directory and personal Microsoft
   accounts"** — the personal-accounts part is required for a hotmail sender.
2. Redirect URI (Web): `http://localhost:5678/rest/oauth2-credential/callback`
3. **Certificates & secrets** → new client secret → copy the *value* immediately.
4. **API permissions** → Microsoft Graph → **Delegated** → add `Mail.Send`, `offline_access`,
   `User.Read`.
5. In n8n, create the Microsoft Outlook OAuth2 credential with the client ID and secret, click
   **Connect**, sign in as `you@example.com`. Leave scopes at defaults.

Delegated, so no admin consent needed.

## Step 7 — Attach credentials to nodes

Imported workflows have **no credentials bound**. Open each node below and pick the credential:

**workflow-v2.json — 7 nodes**

| Node | Credential |
|---|---|
| `Load History` | Postgres |
| `Load Employers` | Postgres |
| `Save Candidates` | Postgres |
| `Save Application` | Postgres |
| `Score Job` | OpenRouter |
| `Generate Letter` | OpenRouter |
| `Send Application` | Outlook OAuth2 |
| `Send Digest` | Outlook OAuth2 |
| `Fetch Adzuna` | Custom Auth. `useAdzuna` is **on** (it is the only broad Netherlands source, and with `adzunaGermany` it also covers the German cities). No key? Set `useAdzuna` to false |

**workflow-speculative.json — 5 nodes**

| Node | Credential |
|---|---|
| `Load Contacted` | Postgres |
| `Save` | Postgres |
| `Generate Outreach` | OpenRouter |
| `Send Outreach` | Outlook OAuth2 |
| `Send Digest` | Outlook OAuth2 |

**workflow-discovery.json — 5 nodes**

| Node | Credential |
|---|---|
| `Save OSM Candidates` | Postgres |
| `Load Employers` | Postgres |
| `Load Candidates` | Postgres |
| `Save Discovery` | Postgres |
| `Send Report` | Outlook OAuth2 |

## Step 8 — Fill Config, then dry run

In the **Config** node of each workflow, replace the remaining placeholder:

- `portfolioUrl` → `https://github.com/<you>/job-agent` → a real write-up or repo

> `portfolioUrl` matters more than it looks. Showcase mode tells recipients an agent pipeline wrote
> the letter and points them at this link. If it 404s, the letter's central claim is unverifiable
> and actively hurts you. Either publish something there or set `showcaseMode` to `false`.

Also sanity-check `salaryExpectationEur` (default `65000`) — it goes into German letters verbatim.

Now hit **Execute workflow** on `workflow-v2`. `dryRun` is `true`: it searches, ranks, scores and
writes letters, and sends **nothing**.

Expect roughly: 55 board fetches + 40 Bundesagentur searches + Arbeitnow (throttled on purpose,
~30 s), then up to 24 scoring calls and up to 8 letters, each batch in parallel. About a minute
or two. In dry run the send loop doesn't execute.

**What to check in the output:**
- `Dedupe & Cap` → are the 8 picked roles ones you'd actually apply to?
- `Parse Score` → do the `fit` numbers look honest, or is everything 85+?
- `Parse Letter` → read two letters end to end. Do they share sentences? Is the showcase paragraph
  specific to each company, or boilerplate?
- `Build Digest` → the digest HTML, including the LinkedIn notes and talking points.

Tune `minFitScore`, `minRelevance`, `titleExclude` and re-run. Dry runs deliberately don't burn the
dedupe key, so the same roles keep reappearing while you tune.

## Step 9 — Go live (only when the dry-run output reads well)

1. Set `dryRun` → `false` in `workflow-v2`.
2. Execute manually **once** and watch it. Check your Sent Items.
3. Confirm rows landed: `SELECT company, title, status, fit FROM job_applications ORDER BY applied_at DESC;`
4. Only then toggle the workflow **Active** to let the 07:30 schedule run.

Leave `workflow-speculative` in dry run considerably longer — it writes to strangers with no job
posting to anchor it, so the letters need more scrutiny.

---

## Order of operations, condensed

```
1. createdb jobs + schema.sql      <- also validates the untested SQL
2. CV pdf into cv/
3. OpenRouter key ready
4. npx n8n
5. import both workflows
6. 4 credentials
7. bind credentials to 12 nodes
8. fill Config, dry run, read the letters, tune
9. dryRun=false -> manual run -> check Sent Items -> activate
```

## Employer watchlist: reading big employers' own careers sites

Large employers (adesso, DATEV, Siemens Healthineers, Schaeffler, Bosch, Wolters Kluwer...) post
on their own careers sites, not on the Bundesagentur, and those sites run on SuccessFactors,
Workday, SmartRecruiters or Personio. All four have public, keyless job feeds. `Load Employers`
reads the `employers` table every run, and the `ATS Registry` node turns each row into feed
requests: one per search term (`employerSearchTerms`) for the big systems, one full list for
the small ones.

`schema.sql` seeds 14 employers (9 German, 5 Amsterdam-area), each verified live on 2026-09-24.
To add one, find its careers site and insert a row:

```sql
-- SuccessFactors: the careers site's base URL (check <site>/services/rss/job/?keywords=AI returns items)
INSERT INTO employers (name, ats, token, regions) VALUES ('msg', 'successfactors', 'https://jobs.example.com', '{bayern}');
-- Workday: tenant|wdN|site from https://<tenant>.<wdN>.myworkdayjobs.com/<site>
INSERT INTO employers (name, ats, token, regions, options) VALUES
  ('Example', 'workday', 'example|wd3|External', '{amsterdam}',
   '{"facets": {"locationCountry": ["9696868b09c64d52a62ee13b052383cc"]}}');   -- Netherlands only
-- SmartRecruiters / Personio / Greenhouse / Lever / Ashby / Recruitee: the company or board id
INSERT INTO employers (name, ats, token, regions) VALUES ('Example', 'smartrecruiters', 'ExampleGroup', '{berlin}');
-- stop reading one
UPDATE employers SET active = false WHERE name = 'Example';
```

A feed that errors shows up in the digest under "Career feeds that failed". Jobs from watchlist
employers must still match a title keyword: unlike the 55 hand-picked AI companies, Siemens-sized
employers list thousands of roles. Only Bundesagentur ads are ever emailed automatically. An
address inside a Workday or SmartRecruiters ad is usually for questions, and those employers
expect applications through their portal, so those jobs go to the digest with a letter.

## Employer discovery: the watchlist grows by itself

`workflow-discovery.json` runs every morning at 06:45, before the job run. It turns employer
**names** into readable careers feeds and adds what it finds to `employers`:

- **Where names come from.** The daily job run records every employer behind a *relevant*
  Bundesagentur, Adzuna or Arbeitnow ad in `employer_candidates` (agencies excluded). Every
  Monday, discovery also pulls IT companies **with their website** from OpenStreetMap: small
  companies that rarely post to the Bundesagentur. Measured: Berlin 117, München 121, Nürnberg 63.
  Amsterdam is skipped, because OSM has almost no tech employers there.
- **How a name is resolved.** First it guesses the board name on the keyless job-board APIs
  (Greenhouse, Lever, Ashby, SmartRecruiters, Personio, Recruitee). A guess is accepted only
  with jobs in your regions and a matching company name. Otherwise it uses the company's website
  (the OSM one, or a guessed domain confirmed by its page title), finds the careers page and
  detects Workday, SuccessFactors or any of the above. Links in the ads were no help: measured,
  every one pointed at an aggregator, never the employer.
- **Order.** Each run takes 12 companies from job ads, fewest ads first (smaller companies,
  which resolve far more often), and 8 random OSM companies. Misses are retried after 30 days,
  at most 3 times.

**Measured yield, honestly: about 5-8%** (2 of 40 Bundesagentur employers, 3 of 40 OSM
companies). Most small companies publish jobs on a plain web page with a `jobs@` address and
no applicant tracking system, which is nothing to read. At 20 companies a day that is still a
new watched employer every few days, unattended. You get an email when something is added.

```sql
SELECT * FROM discovery LIMIT 30;                                    -- what was checked, and why it missed
SELECT name, ats, token FROM employers WHERE source = 'discovered';  -- what it added
UPDATE employers SET active = false WHERE name = '...';              -- a wrong match
```

## Knowing what you've already applied to

Every run writes a row per role considered, and the next run reads it back. **`sent`, `queued`
and `send_failed` suppress the company** for `rememberDays` (`send_failed` counts because the
digest hands you the letter to send by hand). **`rejected_fit` suppresses only that role** for
`rejectRecheckDays`, so the company's other roles still compete, and only in live runs.
`dry_run`, `deferred`, `score_failed` and `letter_failed` block nothing, so you can dry-run as
often as you like while tuning without burning your target list.

```powershell
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"

# what have I actually applied to?
& $psql -U postgres -w -h localhost -d jobs -c "SELECT * FROM applied;"

# everything considered, including what was rejected and why
& $psql -U postgres -w -h localhost -d jobs -c "SELECT * FROM considered LIMIT 40;"

# weekly funnel by source - is the fit threshold set anywhere near right?
& $psql -U postgres -w -h localhost -d jobs -c "SELECT * FROM job_funnel;"

# did I already approach this company?
& $psql -U postgres -w -h localhost -d jobs -c "SELECT company,title,status,applied_at FROM job_applications WHERE lower(company) LIKE '%helsing%';"
```

**To deliberately re-open a company** (they posted something better, or you want another shot):

```sql
DELETE FROM job_applications WHERE lower(company) = 'helsing';
-- or just clear the suppression while keeping the history:
UPDATE job_applications SET status = 'rejected_fit' WHERE lower(company) = 'helsing';
```

`rememberDays` (default 180) controls how long an approach suppresses a company.

## If something breaks

| Symptom | Cause |
|---|---|
| Every source returns 0 | Bundesagentur moved its API version. Search is `v6`, detail is `v4` — check that split first. |
| `Read CV` fails: **"Access to the file is not allowed"** | n8n restricts file reads to `~/.n8n-files` by default. Start n8n with `.\start-n8n.ps1`, which sets `N8N_RESTRICT_FILE_ACCESS_TO` to include `cv/`. A bare `npx n8n` will always fail here. |
| `Read CV` fails: file not found | `cv/` is empty, or you're on n8n Cloud (the local-file node is self-hosted only). |
| Send fails `550 5.7.30` | Still on SMTP. Must be the Outlook OAuth2 node. |
| Postgres node errors | `jobs` DB missing, or `schema.sql` wasn't run. |
| Letters read generic | `showcaseFacts` is being recited instead of selected from — lower the temperature or tighten `titleExclude` so weaker matches don't reach generation. |
| Applications repeat | `Save Application` isn't writing. Check `job_applications` actually has rows. The digest also says "N history row(s) failed to save". |
| Digest subject starts `[Jobs][CHECK]` | A source returned nothing, a mail failed to send, or history didn't save. The red box at the top says which. |
| Digest says "0 sent" with blank cards | You're running a pre-2026-09-24 copy (the combined canvas). Import the current files. |
