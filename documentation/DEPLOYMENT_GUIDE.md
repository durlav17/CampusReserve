# Deployment Guide

Target architecture: **Netlify** (static React build) → **Render** (Node.js API) → **Oracle Autonomous Database** (or any reachable Oracle 19c+). Nothing in this repository has been deployed yet; every step below is yours to perform with your own accounts. Steps marked **(account-specific)** depend on choices in your consoles; the configuration files in the repository (`netlify.toml`, `render.yaml`) are written against the providers' documented formats.

## 0. Before you start

- A GitHub account, a Netlify account, a Render account, an Oracle Cloud account (Always Free tier includes Autonomous Database).
- Node.js 20+ and Git installed locally.
- Never commit `.env`, wallets or passwords. `.gitignore` already excludes them.

## 1. Create the GitHub repository

```bash
cd CampusReserve
git init
git add .
git commit -m "CampusReserve BCSE302P individual mini project"
git branch -M main
git remote add origin https://github.com/<your-username>/CampusReserve.git
git push -u origin main
```

Create the empty repository on github.com first (no README, no .gitignore — they already exist here). The workflow in `.github/workflows/ci.yml` runs lint, unit tests and the frontend build on every push.

## 2. Oracle Autonomous Database (account-specific)

1. Oracle Cloud Console → **Autonomous Database** → *Create*. Workload type *Transaction Processing* (or *JSON*); "Always Free" toggle on; set an ADMIN password.
2. **Network access.** For a cloud API host such as Render, the simplest working option is *Secure access from everywhere*. If you prefer an access control list, add the outbound IP addresses Render lists for your service's region (Render dashboard → service → *Connect* → *Outbound*); these can change, so re-check after redeploys.
3. **TLS without a wallet.** On the database's details page, set *Mutual TLS (mTLS) authentication* to **Not required** (Oracle only allows this when an access control list is configured; otherwise use the wallet option in step 5). Then *Database connection* → choose **TLS** in the drop-down and copy the connection string for the `_low` (or `_tp`) service. It looks like:
   ```
   (description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1521)(host=adb.ap-mumbai-1.oraclecloud.com))(connect_data=(service_name=xxxx_campus_low.adb.oraclecloud.com))(security=(ssl_server_dn_match=yes)))
   ```
   node-oracledb Thin mode accepts this full descriptor directly as `DB_CONNECT_STRING`; no Oracle Client libraries are needed.
4. Create the application schema. In *Database Actions → SQL* as ADMIN:
   ```sql
   CREATE USER campus IDENTIFIED BY "<StrongAppPassword1>";
   GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER, CREATE SEQUENCE TO campus;
   ALTER USER campus QUOTA UNLIMITED ON data;
   ```
   Then connect as `campus` (SQL Developer or SQLcl with the same descriptor) and run `database/run_all.sql`.
5. **Wallet alternative.** If you keep mTLS required: download the *Instance wallet*, unzip it on the API host, and set `DB_WALLET_DIR` (folder containing `tnsnames.ora` and `ewallet.pem`), `DB_WALLET_PASSWORD`, and `DB_CONNECT_STRING=<alias>_low`. On Render this requires a *Secret File* or a disk; the walletless option is simpler.

**Local alternative (no cloud):** Oracle Database Free in Docker (`EVIDENCE_CAPTURE_GUIDE.md` §0) with `DB_CONNECT_STRING=localhost:1521/FREEPDB1`, or Oracle XE 21c with `localhost:1521/XEPDB1`. The database technology is unchanged. A database on your own machine is for local development only: Render cannot reach it, and the API refuses to start in production with a localhost connection string.

## 3. Deploy the API on Render

Option A — Blueprint (uses `render.yaml`):
1. Render dashboard → **New → Blueprint** → select the GitHub repository.
2. Render reads `render.yaml` and proposes one web service `campusreserve-api` with `rootDir: backend`.
3. Fill the variables marked `sync: false` when prompted: `DB_PASSWORD`, `DB_CONNECT_STRING`, `CORS_ORIGINS` (set after step 4; you can enter a placeholder and edit later). `JWT_SECRET` is generated automatically.
4. Deploy. Health check path is `/api/health`; it returns 200 only when the database is reachable.

Option B — manual web service: Root directory `backend`, build `npm ci`, start `npm start`, health check `/api/health`, and the environment variables from `.env.example`.

Free Render web services sleep after inactivity; the first request after sleeping is slow.

## 4. Deploy the front end on Netlify

1. Netlify → **Add new site → Import an existing project** → GitHub → choose the repository.
2. `netlify.toml` already sets: base directory `frontend`, build command `npm run build`, publish directory `dist`, and an SPA fallback redirect to `/index.html`.
3. Site settings → **Environment variables** → add `VITE_API_URL = https://<your-render-service>.onrender.com` (no trailing slash, no `/api`). Vite embeds it at build time, so trigger a new deploy after setting it.
4. Note your site URL, e.g. `https://campusreserve-24bce2361.netlify.app`.

## 5. Connect the two

- On Render set `CORS_ORIGINS=https://campusreserve-24bce2361.netlify.app` (comma-separate several origins, e.g. add `http://localhost:5173` for local testing) and redeploy the API.
- On Netlify confirm `VITE_API_URL` and redeploy.

## 6. Verify the live system

1. `https://<render-service>.onrender.com/api/health` → `{"status":"ok","database":"up"}`.
2. Open the Netlify URL, sign in with a seeded account, open *Availability*, create a booking, try an overlapping booking (expect the conflict message), approve it as `coord.scope@campusreserve.example`.
3. Check the audit page shows the changes.
4. Screenshot the browser address bar together with the page for the report if you include deployment evidence.

## 7. Environment variables

| Variable | Where | Required | Meaning |
|---|---|---|---|
| `DB_USER` | API | yes | schema owner (default `campus`) |
| `DB_PASSWORD` | API | yes | schema password |
| `DB_CONNECT_STRING` | API | yes | Easy Connect, alias, or full TLS descriptor |
| `DB_WALLET_DIR`, `DB_WALLET_PASSWORD` | API | only for mTLS wallets | wallet folder and password |
| `JWT_SECRET` | API | yes in production (≥32 chars) | token signing key |
| `JWT_EXPIRES_IN` | API | no | default `8h` |
| `CORS_ORIGINS` | API | yes | allowed front-end origins |
| `TZ` | API | no | default `Asia/Kolkata`; booking times are campus-local |
| `PORT` | API | no | Render injects it |
| `VITE_API_URL` | Netlify build | yes in production | API origin |

## 8. Official references used

- Render Blueprint YAML reference: https://render.com/docs/yaml-spec
- Oracle: *Connect Node.js and other scripting languages without a wallet* (Autonomous Database): https://docs.oracle.com/en-us/iaas/autonomous-database-shared/doc/connecting-nodejs-tls.html
- node-oracledb documentation (Thin mode, connection strings, wallets): https://node-oracledb.readthedocs.io/
- Netlify documentation (file-based configuration, redirects, environment variables): https://docs.netlify.com/

Console labels change over time; if a menu name differs, search the provider's documentation for the setting named above.
