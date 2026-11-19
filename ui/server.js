// Local UI for the apply-yourself list. Reads and writes the same `jobs` database the n8n
// workflow uses, so "Mark applied" here is exactly the documented
//   UPDATE job_applications SET status = 'applied_manually' WHERE ...
// and the next run treats that company as approached for rememberDays.
//
// "Hide" deliberately does NOT change status. Load History only reads the statuses it knows, so a
// new one (say 'dismissed') would let the role back in and Save Application would overwrite it to
// 'manual' on the next run. hidden_at is a column the pipeline never reads: the role stays
// suppressed exactly as before, it just leaves this list.
//
// Binds to 127.0.0.1 only. Start with ..\start-ui.ps1 or `npm start`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.UI_PORT) || 5690;
const HOST = '127.0.0.1';
const URL_BASE = `http://localhost:${PORT}`;
const CV_PATH = path.join(root, 'cv', 'CV.pdf');

// ids are BIGSERIAL, which pg returns as strings. They are far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, v => Number(v));

// Same database as the n8n Postgres credential (RUNBOOK step 6). PG* env vars override.
const pool = new pg.Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'jobs',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,   // local auth is trust
  max: 4,
});
const DB_LABEL = `${pool.options.host}:${pool.options.port}/${pool.options.database}`;

// Statuses that mean "on the apply-yourself list". send_failed: the email bounced, apply by hand.
const OPEN = ['manual', 'send_failed'];
const LISTED = [...OPEN, 'applied_manually', 'sent'];

async function ensureSchema() {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'job_applications' AND column_name = 'hidden_at'`);
  if (!rows.length) {
    await pool.query('ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ');
    console.log('Added column job_applications.hidden_at');
  }
}

// ------------------------------------------------------------------ API

const api = {
  'GET /api/jobs': async () => {
    const { rows } = await pool.query(
      `SELECT id, company, title, city, region, country, url, contact_email, fit, score_reason,
              lang, letter, channel, source, status, applied_at, hidden_at
       FROM job_applications
       WHERE status = ANY($1)
       ORDER BY applied_at DESC`, [LISTED]);
    return { jobs: rows };
  },

  'GET /api/meta': async () => ({
    db: DB_LABEL,
    cvPath: CV_PATH,
    cvExists: fs.existsSync(CV_PATH),
  }),

  // Returns each row's previous status and applied_at, so the client can undo exactly.
  'POST /api/jobs/apply': async (body) => {
    const ids = idList(body.ids);
    const { rows } = await pool.query(
      `WITH old AS (
         SELECT id, status, applied_at FROM job_applications
         WHERE id = ANY($1::bigint[]) AND status = ANY($2)
         FOR UPDATE)
       UPDATE job_applications j SET status = 'applied_manually', applied_at = now()
       FROM old WHERE j.id = old.id
       RETURNING old.id, old.status, old.applied_at::text AS applied_at`, [ids, OPEN]);  // ::text: a JS Date would drop the microseconds
    return { changed: rows.length, undo: rows };
  },

  // Back onto the list: [{id, status?, applied_at?}]. Without a status it goes back as 'manual'.
  'POST /api/jobs/reopen': async (body) => {
    if (!Array.isArray(body.rows) || body.rows.length > 1000) throw badRequest('rows must be an array');
    const rows = body.rows.map(r => r || {}).map(r => ({
      id: idList([r.id])[0],
      status: OPEN.includes(r.status) ? r.status : 'manual',
      applied_at: r.applied_at || null,
    }));
    const res = await pool.query(
      `UPDATE job_applications j
       SET status = r.status, applied_at = COALESCE(r.applied_at, j.applied_at)
       FROM jsonb_to_recordset($1::jsonb) AS r(id bigint, status text, applied_at timestamptz)
       WHERE j.id = r.id AND j.status = 'applied_manually'`, [JSON.stringify(rows)]);
    return { changed: res.rowCount };
  },

  'POST /api/jobs/hide': async (body) => {
    const ids = idList(body.ids);
    const res = await pool.query(
      `UPDATE job_applications SET hidden_at = CASE WHEN $2 THEN now() END
       WHERE id = ANY($1::bigint[])`, [ids, body.hidden !== false]);
    return { changed: res.rowCount };
  },

  // Edits to the letter before pasting it. A later pipeline run only replaces it if it writes a
  // new one (Save Application: letter = COALESCE(EXCLUDED.letter, letter)).
  'POST /api/jobs/letter': async (body) => {
    const [id] = idList([body.id]);
    if (typeof body.letter !== 'string') throw badRequest('letter must be a string');
    const res = await pool.query(
      `UPDATE job_applications SET letter = $2 WHERE id = $1 AND status = ANY($3)`,
      [id, body.letter, [...OPEN, 'applied_manually']]);
    return { changed: res.rowCount };
  },
};

function idList(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000) throw badRequest('ids must be a non-empty array');
  return ids.map(x => {
    const n = Number(x);
    if (!Number.isSafeInteger(n) || n <= 0) throw badRequest(`bad id: ${x}`);
    return n;
  });
}

function badRequest(msg) {
  return Object.assign(new Error(msg), { status: 400 });
}

// ------------------------------------------------------------------ HTTP

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 1_000_000) { reject(badRequest('body too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(badRequest('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Personal data and write endpoints: refuse other hosts (DNS rebinding) and cross-site pages.
  // Requiring a JSON content type forces a CORS preflight, which this server never answers.
  const origin = req.headers.origin;
  if (!ALLOWED_HOSTS.has(req.headers.host) || (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, '')))) {
    return send(res, 403, { error: 'forbidden' });
  }
  const url = new URL(req.url, URL_BASE);

  if (req.method === 'GET' && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    return send(res, 200, fs.readFileSync(path.join(here, 'public', file)), type);
  }
  if (req.method === 'GET' && url.pathname === '/cv') {
    if (!fs.existsSync(CV_PATH)) return send(res, 404, { error: `no CV at ${CV_PATH}` });
    return send(res, 200, fs.readFileSync(CV_PATH), 'application/pdf');
  }

  const handler = api[`${req.method} ${url.pathname}`];
  if (!handler) return send(res, 404, { error: 'not found' });
  try {
    let body = {};
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 415, { error: 'expected application/json' });
      }
      body = await readJson(req);
    }
    send(res, 200, await handler(body));
  } catch (e) {
    const status = e.status || 503;
    if (status >= 500) console.error(e);
    send(res, status, { error: status >= 500 ? `Database ${DB_LABEL}: ${e.message}` : e.message });
  }
});

function openBrowser() {
  if (process.argv.includes('--open')) {
    spawn('cmd', ['/c', 'start', '', URL_BASE], { detached: true, stdio: 'ignore' }).unref();
  }
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is in use - the UI is probably already running at ${URL_BASE}`);
    openBrowser();
    process.exit(0);
  }
  throw e;
});

try {
  await ensureSchema();
} catch (e) {
  console.error(`Cannot reach Postgres at ${DB_LABEL}: ${e.message}`);
  console.error('Is the PostgreSQL service running, and was schema.sql applied? (RUNBOOK step 1)');
  process.exit(1);
}
server.listen(PORT, HOST, () => {
  console.log(`Job list UI: ${URL_BASE}   (database ${DB_LABEL})`);
  openBrowser();
});
