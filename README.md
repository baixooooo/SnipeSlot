# SnipeSlot

Local autonomous slot-booking tool for the Saveetha Learner portal (`https://learner.saveetha.in/academicevents/event-booking/`).

## Requirements

- **Node.js 22+** (uses built-in `node:sqlite`)
- **npm**
- **Chromium** (installed via Playwright)

## Quick Start

```bash
git clone https://github.com/baixooooo/SnipeSlot
cd SnipeSlot
npm install
npx playwright install chromium
npm run dev
```

Open `http://127.0.0.1:3000` in your browser.

`npm run dev` starts both:
- **Web UI** on `http://127.0.0.1:3000`
- **Background worker + WebSocket server** on `ws://127.0.0.1:3001`

For production:

```bash
npm run build
npm start
```

## Usage

1. **Connect your portal account**
   - Click **Connect Portal** in the header (or inside **Settings**).
   - A Chromium window opens to the Saveetha login page. Sign in manually.
   - Once the booking page loads, the window closes and your session is saved locally in `browser-session/`. Your username and password are never stored.

2. **Browse & schedule a slot**
   - The **Events** page lists upcoming sessions and syncs automatically in the background.
   - Filter by type (**All**, **Module**, **CIA**, **Viva**, **Other**), search by title/venue, date range, or session time.
   - Click **Book** on a slot, enter your purpose (required, max 255 characters), and confirm.

3. **Monitor the queue**
   - Switch to **Queue** to view countdowns, execution status, attempt counts, confirmation timestamps, or failure reasons.
   - You can pause, resume, or remove queued jobs and inspect the collapsible **Execution Log**.

4. **Settings**
   - Click the gear icon in the header to reconnect or check your portal session, pause/start the scheduler, adjust the background monitor interval (`10–300s`), or configure retry limits.
   - Use the sun/moon icon in the header to toggle between dark and light mode.

## How It Works

- **Single browser owner**: Only the background worker (`worker/index.ts`) accesses `browser-session/` to avoid Chromium profile lock conflicts.
- **Persistent queue**: Jobs and logs are stored in `data/snipeslot.db` (SQLite WAL mode) and survive restarts.
- **Verification**: After submitting the portal booking form, SnipeSlot re-fetches the target date from the portal and checks the exact event's status (`Booked`, `Waitlisted`, `Full`, or `Verification required`) rather than assuming a form submit succeeded.
- **Retries**: Transient errors (`429`, `5xx`, network/navigation timeouts) use bounded exponential backoff with jitter and respect `Retry-After` headers.

## Scripts

- `npm run dev` — Run Next.js dev server and background worker
- `npm run build` — Build production Next.js app
- `npm start` — Run production server and background worker
- `npm run typecheck` — Run `tsc --noEmit`
- `npm run lint` — Run ESLint
- `npm test` — Run tests (`tsx --test`)

## Limitations

- Single-user local app bound to `127.0.0.1`; not intended for multi-user or public hosting.
- Does not bypass CAPTCHAs, eligibility checks, or institutional booking limits, and does not automatically join waitlists or substitute alternative slots.
- The background worker (`npm run dev` or `npm start`) must remain running for scheduled bookings to execute.
