# Kilometro Zero — Admin Dashboard

A secure, RBAC-protected admin dashboard for the Kilometro Zero donation website, plus
the existing public site served from the same server.

## What this is

- **Backend:** Node.js + Express + SQLite (file database, no separate DB server needed)
- **Auth:** bcrypt-hashed password, JWT stored in an `httpOnly`/`sameSite=strict` cookie,
  sliding session with automatic idle logout
- **RBAC:** every admin API route and the `/admin` page itself are gated server-side by
  a single `role === 'admin'` check — not just hidden in the UI
- **Single admin account:** enforced two ways — (1) there is no register/signup route
  anywhere in the code, only a CLI seed script, and (2) the database has a `UNIQUE`
  partial index that makes it physically impossible to insert a second `role = 'admin'` row
- **Public site:** your existing `index.html` is untouched, served from `public/site/`,
  completely separate from the admin system

## 1. Install

```bash
cd kilometro-admin
npm install
```

## 2. Configure your admin credentials

```bash
cp .env.example .env
```

Edit `.env` and set:
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your real login (password 10+ characters)
- `JWT_SECRET` — a long random string. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- `COOKIE_SECURE=true` once you deploy behind HTTPS (keep `false` for local `http://localhost` testing)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — required for donor verification codes and donation receipt emails

**Never commit `.env` to git** — it's already in `.gitignore`.

## 3. Create your admin account (one-time)

```bash
npm run seed:admin
```

This is the **only** way an admin account can ever be created. Re-running it updates
the existing admin instead of creating a second one — the database won't allow a second
admin row even if you tried.

## 4. (Optional) Load demo data

To see the dashboard populated with realistic mock campaigns/donations/users before you
have real ones:

```bash
npm run seed:demo
```

Safe to re-run; it never touches the admin account.

## 5. Run the server

```bash
npm start
```

- Public site: `http://localhost:3000/`
- Admin login: `http://localhost:3000/admin/login`

## How the security actually works

| Requirement | Implementation |
|---|---|
| Only you can log in | Single admin row, no registration endpoint exists |
| Passwords stored securely | bcrypt, cost factor 12, never stored/logged in plaintext |
| Protected routes | Every `/api/admin/*` route runs `verifyAdminToken` + `requireAdminRole` middleware before any handler executes |
| Can't bypass by typing the URL | `/admin` itself is server-rendered behind `guardAdminPage` — the HTML is never sent unless the cookie is valid |
| Sessions | JWT in an `httpOnly` cookie (invisible to JS/XSS), `sameSite=strict` (CSRF mitigation), reissued on every request (sliding expiry) |
| Auto logout on inactivity | Token expiry = `SESSION_IDLE_TIMEOUT_MINUTES` (default 20). No activity → token expires → next request is rejected and the browser is redirected to login |
| Brute-force protection | Login endpoint rate-limited to 8 attempts / 15 minutes per IP, all attempts logged to `login_attempts` |

## Project structure

```
kilometro-admin/
├── server/
│   ├── index.js                 # App entry point, route wiring, security headers
│   ├── db/
│   │   ├── database.js          # SQLite connection + schema
│   │   ├── seedAdmin.js         # ONLY way to create/update the admin account
│   │   └── seedDemoData.js      # Mock campaigns/donations/users for demoing
│   ├── middleware/
│   │   └── auth.js              # JWT issue/verify, RBAC, idle-session logic
│   └── routes/
│       ├── auth.routes.js       # login / logout / me
│       ├── dashboard.routes.js  # overview stats
│       ├── campaigns.routes.js  # campaign CRUD + approve/reject/archive
│       ├── donations.routes.js  # donation list/filter/CSV export
│       ├── users.routes.js      # user list/suspend/reactivate/delete
│       └── notifications.routes.js
├── public/
│   ├── site/index.html          # your existing public donation site, unchanged
│   └── admin/
│       ├── login.html
│       ├── dashboard.html
│       ├── access-denied.html
│       ├── css/admin.css
│       └── js/{api,dashboard}.js
├── .env.example
└── package.json
```

## Payment gateway

The `Payment Gateway` tab and the payment figures on the overview page are clearly
marked as mock data (`payments.isMockData: true` in the API response). Once your real
gateway is ready, replace the donation-insertion logic in a webhook handler and the
dashboard will display real figures automatically — no frontend changes needed.

## Deploying

This is a standard Node.js app — it will run on Render, Railway, Fly.io, a VPS, etc.
Key things to set on your host:
1. Environment variables from `.env` (especially `JWT_SECRET`, `ADMIN_EMAIL/PASSWORD`, `COOKIE_SECURE=true`, and the SMTP values above)
2. Run `npm run seed:admin` once after first deploy
3. Serve behind HTTPS (required for `COOKIE_SECURE=true` and for the cookie to actually be sent)
4. The SQLite file (`server/db/kilometro.db`) needs to live on persistent storage — if your
   host wipes the filesystem on redeploy, either use a host with a persistent disk/volume,
   or swap SQLite for a hosted Postgres/MySQL database (the query layer in `server/db` is
   isolated so this swap only touches that one file).

If verification emails are not arriving on Render, the first thing to check is that the SMTP
environment variables are actually present in the Render service settings. Without them, the
server cannot send verification codes.

## Extending it later

Every admin route lives in its own file under `server/routes/`, and every route already
goes through the same `verifyAdminToken` + `requireAdminRole` middleware in `server/index.js`.
To add a new admin feature, add a new route file and one line wiring it up — no changes
to the auth system needed.
