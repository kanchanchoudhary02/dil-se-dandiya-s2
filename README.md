# Dil Se Dandiya — MERN Website

React + Vite frontend, Node.js + Express API, and MongoDB. The original page design, offer form, scratch-card interaction, event details, pricing, venue, and contact numbers are retained.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `server/.env.example` to `server/.env` and enter your own credentials.
3. Optionally copy `client/.env.example` to `client/.env` for local development.
4. In a terminal at the project root run:

   ```bash
   npm install
   npm run install:all
   npm run dev
   ```

5. Open `http://localhost:5173`. Admin panel: `http://localhost:5173/admin`.

## Deploy frontend to Vercel

- Import this repository into Vercel.
- Set **Root Directory** to `client`.
- Framework preset: **Vite**.
- Build command: `npm run build`.
- Output directory: `dist`.
- Add environment variable `VITE_API_URL` with value `https://dil-se-dandiya.onrender.com/api` (or your actual API URL).
- Redeploy after adding/changing the variable. `client/vercel.json` rewrites app routes such as `/admin` to `/index.html`.

## Deploy on Render

The `render.yaml` Blueprint defines an API web service and a static frontend. When creating/updating the Blueprint:

- Set all secret API environment variables for the backend (`MONGODB_URI`, `ADMIN_PASSWORD`, `JWT_SECRET`, `CLIENT_ORIGIN`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_NOTIFICATION_EMAIL`).
- `CLIENT_ORIGIN` must be the exact deployed frontend origin (for example `https://your-frontend.onrender.com`), with no trailing slash. If you have both Vercel and Render frontends, separate them with a comma.
- Set `VITE_API_URL` to the backend URL ending in `/api` before the frontend build.
- Ensure MongoDB Atlas network access permits the deployed backend.

The existing API is expected at `https://dil-se-dandiya.onrender.com`; change the frontend fallback and `VITE_API_URL` if the API service has a different URL.

## Environment variables

Backend secrets must only be set on the backend host or in a local, untracked `server/.env`. Never put `MONGODB_URI`, `ADMIN_PASSWORD`, `JWT_SECRET`, or `RESEND_API_KEY` in frontend variables or commit them to GitHub. Example files contain placeholders only.

## API routes

- `GET /api/health` — health check.
- `POST /api/offers` — validate and save visitor details.
- `POST /api/offers/:code/scratch` — save scratch-card result.
- `POST /api/admin/login` — admin login, returns an 8-hour JWT.
- `GET /api/admin/entries?q=` — authenticated entry list/search.
- `GET /api/admin/export?q=` — authenticated CSV export.
