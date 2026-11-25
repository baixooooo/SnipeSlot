# SnipeSlot — Autonomous Academic Slot Booking Agent

SnipeSlot is a lightweight, single-user autonomous slot booking application for the Saveetha Learner portal (`https://learner.saveetha.in/academicevents/event-booking/`).

## Tech Stack

- **Next.js (App Router)** + **TypeScript** + **Tailwind CSS**
- **Playwright** (persistent Chromium profile owned exclusively by the background worker)
- **Cheerio** for server-rendered portal HTML parsing
- **SQLite (`node:sqlite`)** with WAL mode for shared persistence between the dashboard and worker
- **Native Node.js timers** for scheduling and bounded retries
- **Concurrently** to run both the Next.js server and background worker together

## Setup

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://127.0.0.1:3000` in your browser.

### Available Commands

- `npm run dev`: Starts Next.js (bound to `127.0.0.1:3000`) and the background worker (`worker/index.ts`).
- `npm run build`: Builds the Next.js production bundle.
- `npm start`: Starts the production Next.js server and background worker.
- `npm run typecheck`: Runs `tsc --noEmit`.
- `npm run lint`: Runs ESLint.
- `npm test`: Runs automated tests using `tsx --test`.

## How Persistent Portal Authentication Works

1. Click **Connect Portal** on the Overview or Settings page.
2. The background worker closes any headless browser context, opens a visible Chromium window backed by `browser-session/`, and navigates to the Saveetha booking page.
3. Log in manually through the college SSO flow. SnipeSlot never stores your username or password.
4. Once `/academicevents/event-booking/` loads in an authenticated state, the worker closes the interactive window and reuses the saved cookies/session in headless mode.
5. Before scheduled bookings, the worker checks session validity and distinguishes between `authenticated`, `expired` (redirects to login/SSO or returns 401/403), and `unavailable` (5xx, 429, or network timeouts). Temporary outages do not invalidate your session.

## Adding & Scheduling a Booking

1. Go to **Events** and click **Refresh Portal** (use the term, title, date, or time filters if needed).
2. Click **Add to queue** on the exact slot you want.
3. Enter a genuine **Purpose for attending** (required, up to 255 characters) and check the explicit authorization box.
4. The job is persisted in `data/snipeslot.db` and scheduled using the event's actual `Booking Window` opening time (parsed in `Asia/Kolkata` and stored internally in UTC).
5. You can pause, resume, or remove jobs at any time from **Queue**.

## How Retries & Verification Work

- **Preflight**: Before submitting, the worker verifies session authentication, exact title/date/time/venue match, valid purpose, explicit authorization, and that the slot is `Open` (not full, closed, or waitlist-only).
- **Dry-Run Mode**: Enabled by default in **Settings**. Verifies the booking form, CSRF token, and purpose field without sending the live POST submission. Disable Dry-Run Mode in **Settings** only when you are ready for live autonomous submissions.
- **Retries**: Transient failures (`429`, `500`, `502`, `503`, `504`, network/navigation timeouts) are retried using exponential backoff with jitter, bounded by `maxRetries` and `maxRetryDurationSeconds`, while respecting `Retry-After` headers.
- **Uncertain Outcomes**: If a submission times out, the worker re-fetches and verifies the target event's actual status on the portal before retrying. If verification is inconclusive, the job is marked `Verification required` to prevent duplicate submissions.

## Limitations

- Single-user local application bound to `127.0.0.1` (not designed for multi-tenant hosting).
- Does not bypass CAPTCHAs, institutional limits, or eligibility rules, and does not automatically join waitlists or substitute alternative rooms/times.
- Requires the background worker process (`npm run dev` or `npm start`) to remain running for scheduled execution.
