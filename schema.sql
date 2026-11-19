-- Durable application history. Replaces n8n workflow static data, which is wiped on re-import.
-- Run once against the database behind your n8n Postgres credential.

CREATE TABLE IF NOT EXISTS job_applications (
  id            BIGSERIAL PRIMARY KEY,
  dedupe_key    TEXT        NOT NULL UNIQUE,
  source        TEXT        NOT NULL,
  company       TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  city          TEXT,
  country       TEXT,
  region        TEXT,
  url           TEXT,
  contact_email TEXT,
  fit           INTEGER,
  score_reason  TEXT,
  lang          TEXT,
  letter        TEXT,
  channel       TEXT,        -- 'email' | 'ats' | 'link' | 'unknown'
  status        TEXT,        -- 'sent' | 'manual' | 'applied_manually' | 'dry_run' | 'rejected_fit' | ...
  replied_at    TIMESTAMPTZ, -- reserved for the reply loop (phase 5)
  reply_kind    TEXT,        -- 'rejection' | 'interview' | 'info_request'
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Set by the job list UI (ui/, start-ui.ps1) when you hide a role you won't apply to. The workflow
-- never reads it: status stays 'manual', so the role stays suppressed exactly as before. A new
-- status would not work - Load History ignores unknown statuses, and Save Application would
-- overwrite it on the next run. The UI also adds this column itself on start.
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS job_applications_applied_at_idx ON job_applications (applied_at DESC);
CREATE INDEX IF NOT EXISTS job_applications_company_idx     ON job_applications (lower(company));
CREATE INDEX IF NOT EXISTS job_applications_status_idx      ON job_applications (status);

-- Funnel view: is the fit threshold set anywhere near right?
CREATE OR REPLACE VIEW job_funnel AS
SELECT
  date_trunc('week', applied_at)::date        AS week,
  source,
  count(*)                                    AS scored,
  count(*) FILTER (WHERE status = 'sent')     AS emailed,
  count(*) FILTER (WHERE status IN ('queued', 'manual')) AS queued,
  count(*) FILTER (WHERE replied_at IS NOT NULL) AS replies,
  round(avg(fit)::numeric, 1)                 AS avg_fit
FROM job_applications
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- ---------------------------------------------------------------------------
-- Tracking: "what have I actually applied to?"
-- 'sent', 'send_failed' and 'applied_manually' suppress the company for rememberDays.
-- 'manual' (no email address: apply through the careers page yourself) suppresses only that
-- role, so the company's other roles keep coming. 'queued' is the pre-2026-09-29 name of 'manual'.
-- 'dry_run' and 'rejected_fit' are kept for analysis but never suppress a company.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW applied AS
SELECT applied_at::date AS day, company, title, city, region, status, fit,
       contact_email, url
FROM job_applications
WHERE status IN ('sent', 'queued', 'manual', 'applied_manually')
ORDER BY applied_at DESC;

-- The apply-yourself list: open the url, paste the letter, then mark it done with
--   UPDATE job_applications SET status = 'applied_manually' WHERE id = <id>;
CREATE OR REPLACE VIEW manual_queue AS
SELECT id, applied_at::date AS day, company, title, city, region, fit, url, lang, letter
FROM job_applications
WHERE status = 'manual'
ORDER BY applied_at DESC;

-- Everything the pipeline has ever considered, including what it rejected and why
CREATE OR REPLACE VIEW considered AS
SELECT applied_at::date AS day, company, title, status, fit, score_reason, source
FROM job_applications
ORDER BY applied_at DESC;

-- ---------------------------------------------------------------------------
-- Employer watchlist (layer 2): companies whose OWN careers site is read every run.
-- Big employers post there, not on the Bundesagentur - SuccessFactors, Workday,
-- SmartRecruiters, Personio. `token` is what the feed needs:
--   greenhouse / lever / ashby / recruitee / smartrecruiters / personio : the board or company id
--   successfactors : the careers site's base URL (its public RSS lives under /services/rss/job/)
--   workday        : "tenant|wdN|site" from https://<tenant>.<wdN>.myworkdayjobs.com/<site>
-- options.keywordSuffix (SuccessFactors) is appended to every search: the RSS ignores location
--   parameters, but "Software DE" ranks German jobs first (Schaeffler: 0/20 -> 14/20).
-- options.facets restricts a Workday search to one country (ids are the same on every tenant):
--   Germany     {"facets": {"locationCountry": ["dcc5b7608d8644b3a93716604e78e995"]}}
--   Netherlands {"facets": {"locationCountry": ["9696868b09c64d52a62ee13b052383cc"]}}
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employers (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  ats         TEXT        NOT NULL,
  token       TEXT        NOT NULL,
  regions     TEXT[]      NOT NULL,            -- berlin | bayern | amsterdam
  options     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source      TEXT        NOT NULL DEFAULT 'manual',   -- manual | seed | discovered
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ats, token)
);

-- Seeds: every feed below was requested live on 2026-09-24 and returned jobs.
INSERT INTO employers (name, ats, token, regions, options, source) VALUES
  ('adesso',                    'successfactors',  'https://jobs.adesso-group.com', '{berlin,bayern}', '{}', 'seed'),
  ('Schaeffler',                'successfactors',  'https://jobs.schaeffler.com',   '{bayern}',        '{"keywordSuffix": "DE"}', 'seed'),
  ('adidas',                    'successfactors',  'https://jobs.adidas-group.com', '{bayern}',        '{"keywordSuffix": "DE"}', 'seed'),
  ('DATEV',                     'workday',         'datev|wd3|Datev_Careers',       '{bayern}',        '{}', 'seed'),
  ('Siemens Healthineers',      'workday',         'onehealthineers|wd3|SHSJB',     '{bayern}',
     '{"facets": {"locationCountry": ["dcc5b7608d8644b3a93716604e78e995"]}}', 'seed'),
  ('Bosch',                     'smartrecruiters', 'BoschGroup',                    '{bayern,berlin}', '{}', 'seed'),
  ('Delivery Hero',             'smartrecruiters', 'DeliveryHero',                  '{berlin}',        '{}', 'seed'),
  ('TNG Technology Consulting', 'personio',        'tngtech',                       '{bayern,berlin}', '{}', 'seed'),
  ('N26',                       'greenhouse',      'n26',                           '{berlin}',        '{}', 'seed'),
  ('Wolters Kluwer',            'workday',         'wk|wd3|External',               '{amsterdam}',
     '{"facets": {"locationCountry": ["9696868b09c64d52a62ee13b052383cc"]}}', 'seed'),
  ('Coolblue',                  'smartrecruiters', 'coolblue',                      '{amsterdam}',     '{}', 'seed'),
  ('Picnic',                    'smartrecruiters', 'picnic',                        '{amsterdam}',     '{}', 'seed'),
  ('bol',                       'greenhouse',      'bolcom',                        '{amsterdam}',     '{}', 'seed'),
  ('Miro',                      'ashby',           'miro',                          '{amsterdam}',     '{}', 'seed'),
  -- Added 2026-10-13. Workday country facets differ per tenant: NVIDIA's is locationHierarchy1.
  ('NVIDIA',                    'workday',         'nvidia|wd5|NVIDIAExternalCareerSite', '{amsterdam}',
     '{"facets": {"locationHierarchy1": ["2fcb99c455831013ea52d0e0e4583290"]}}', 'seed'),
  ('ServiceNow',                'smartrecruiters', 'ServiceNow',                    '{amsterdam}',     '{}', 'seed')
ON CONFLICT (ats, token) DO NOTHING;

-- Added 2026-11-16 (js-check/coverage__boards.json, tier "watchlist"): larger Dutch employers and consultancies
-- found by resolving the employer names on englishjobsearch.nl. Each board was read live and had at least one
-- matching role in the Amsterdam area. Watchlist, not registry: here the title still has to say what the role is.
-- To switch one off:  UPDATE employers SET active = false WHERE name = '...';
INSERT INTO employers (name, ats, token, regions, options, source) VALUES
  ('KPN',                       'smartrecruiters', 'kpn',                     '{amsterdam}', '{}', 'discovered'),
  ('Sia',                       'smartrecruiters', 'sia',                     '{amsterdam}', '{}', 'discovered'),
  ('Devoteam',                  'smartrecruiters', 'devoteam',                '{amsterdam}', '{}', 'discovered'),
  ('TOPdesk',                   'smartrecruiters', 'topdesk',                 '{amsterdam}', '{}', 'discovered'),
  ('Instant Commerce',          'smartrecruiters', 'instantcommerce',         '{amsterdam}', '{}', 'discovered'),
  ('DPG Media',                 'recruitee',       'dpgmedia',                '{amsterdam}', '{}', 'discovered'),
  ('Schuberg Philis',           'greenhouse',      'schubergphilis',          '{amsterdam}', '{}', 'discovered'),
  ('Sytac',                     'greenhouse',      'sytac',                   '{amsterdam}', '{}', 'discovered'),
  ('Vinted',                    'greenhouse',      'vinteden',                '{amsterdam}', '{}', 'discovered'),
  ('Lefebvre Sdu',              'recruitee',       'lefebvresdu',             '{amsterdam}', '{}', 'discovered'),
  ('Yellowtail Conclusion',     'recruitee',       'yellowtail',              '{amsterdam}', '{}', 'discovered'),
  ('Artefact',                  'greenhouse',      'artefact',                '{amsterdam}', '{}', 'discovered'),
  ('Monks',                     'greenhouse',      'monks',                   '{amsterdam}', '{}', 'discovered'),
  ('CLEVR',                     'greenhouse',      'clevr',                   '{amsterdam}', '{}', 'discovered'),
  ('Amsterdam Data Collective', 'recruitee',       'amsterdamdatacollective', '{amsterdam}', '{}', 'discovered'),
  ('Riverflex',                 'recruitee',       'riverflex',               '{amsterdam}', '{}', 'discovered'),
  ('ISISPACE',                  'recruitee',       'isispace',                '{amsterdam}', '{}', 'discovered'),
  ('Vitestro',                  'recruitee',       'vitestro',                '{amsterdam}', '{}', 'discovered'),
  ('ViCentra',                  'recruitee',       'vicentra',                '{amsterdam}', '{}', 'discovered'),
  ('Qualinx',                   'recruitee',       'qualinx',                 '{amsterdam}', '{}', 'discovered'),
  ('CCS Connects',              'recruitee',       'ccsconnects',             '{amsterdam}', '{}', 'discovered'),
  ('ILIAS Solutions',           'personio',        'ilias-solutions',         '{amsterdam}', '{"language": "en"}', 'discovered'),
  ('YTEC',                      'personio',        'ytec',                    '{amsterdam}', '{"language": "en"}', 'discovered')
ON CONFLICT (ats, token) DO NOTHING;

-- Added 2026-11-18 (js-check/germany-fde__boards.json, tier "watchlist"): German employers found by resolving the
-- German employer_candidates to boards. Each had at least one matching role in Bayern, Berlin or remote.
INSERT INTO employers (name, ats, token, regions, options, source) VALUES
  ('SIXT',       'smartrecruiters', 'sixt',       '{bayern,berlin}', '{}', 'discovered'),
  ('ALTEN',      'smartrecruiters', 'alten',      '{bayern,berlin}', '{}', 'discovered'),
  ('Vattenfall', 'smartrecruiters', 'vattenfall', '{berlin}',        '{}', 'discovered'),
  ('inovex',     'recruitee',       'inovex',     '{bayern,remote}', '{}', 'discovered'),
  ('Accso',      'recruitee',       'accso',      '{bayern}',        '{}', 'discovered')
ON CONFLICT (ats, token) DO NOTHING;

-- Added 2026-11-18 (second, js-check/gate8__boards.json): from resolving the englishjobs.de employers to boards.
INSERT INTO employers (name, ats, token, regions, options, source) VALUES
  ('Snowflake',     'ashby',           'snowflake',    '{berlin,remote}', '{}', 'discovered'),
  ('Mirantis',      'smartrecruiters', 'mirantis',     '{berlin,remote}', '{}', 'discovered'),
  ('Roland Berger', 'smartrecruiters', 'rolandberger', '{bayern}',        '{}', 'discovered')
ON CONFLICT (ats, token) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Layer 3: employers seen in job ads (and OpenStreetMap) that the Employer Discovery
-- workflow tries to resolve to a readable careers feed. Found ones move into `employers`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employer_candidates (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  norm_name   TEXT        NOT NULL UNIQUE,          -- legal forms and punctuation folded
  regions     TEXT[]      NOT NULL DEFAULT '{}',
  sources     TEXT[]      NOT NULL DEFAULT '{}',    -- bundesagentur | adzuna | arbeitnow | osm
  website     TEXT,                                 -- known for OpenStreetMap companies
  ads         INT         NOT NULL DEFAULT 0,       -- most relevant ads in one run: small-first order
  seen_count  INT         NOT NULL DEFAULT 1,       -- runs it appeared in
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT        NOT NULL DEFAULT 'new',   -- new | found | not_found | skipped
  attempts    INT         NOT NULL DEFAULT 0,
  checked_at  TIMESTAMPTZ,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS employer_candidates_due_idx ON employer_candidates (status, ads, last_seen DESC);

-- what discovery has found, and what it could not read
CREATE OR REPLACE VIEW discovery AS
SELECT c.status, c.name, c.regions, c.sources, c.ads, c.attempts, c.checked_at::date AS checked, c.note
FROM employer_candidates c
ORDER BY c.checked_at DESC NULLS LAST, c.ads;
