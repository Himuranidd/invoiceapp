# Manu Invoice Studio

A responsive invoice and receipt generator with email/password accounts, server-side sessions, and per-account invoice data.

The Settings workspace includes account details, searchable preferences, language and region controls, appearance options, notifications, security status, and business/invoice defaults. Display preferences are saved locally in the current browser; password reset, two-factor authentication, and push/SMS delivery are not configured.

## Run the app

Create and activate a Python virtual environment, install the dependencies, then start FastAPI from the repository root:

```powershell
pip install -r requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 4173
```

Open http://127.0.0.1:4173/. The app redirects unauthenticated users to `/login`; new accounts can be created at `/register`. SQLite stores users, password hashes, sessions, and API invoices in the project-root file `papertrail.sqlite3`. On startup, the server prints the exact database path it is using; open that file in SQLite Browser. In DB Browser for SQLite, choose **Browse Data** → **users** and refresh the view after registering. If `PAPERTRAIL_DB_PATH` is set, the server uses that path instead.

Invoice payloads and app preferences are stored in browser `localStorage`, scoped to the signed-in account on that browser. The PWA caches public assets and an offline notice; it never serves the protected dashboard from cache when the authentication service cannot be reached.

The API also provides protected `GET`, `POST`, `PUT`, and `DELETE` routes under `/api/invoices`, with records isolated by account owner.

Do not serve the app with `python -m http.server`; that bypasses the authentication routes. The app currently uses local SQLite accounts only. Social sign-in and password reset require external identity/email services and are not enabled.

For a public HTTPS deployment, set `PAPERTRAIL_COOKIE_SECURE=1` and terminate TLS at the web server or reverse proxy. Use HTTPS for all account traffic.
