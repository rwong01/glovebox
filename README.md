# Glovebox

A car maintenance tracker. Log service history, scan a backlog of paper receipts
with your phone's camera, and see what actually needs attention — calibrated to
how much you really drive, not a generic dealer schedule.

The payoff is one screen: a multi-point-inspection style list where every row is
an item, a colour, and one plain-English sentence saying why.

> Brake Fluid — Last flushed Sep 2022, 3.3 years ago, past the 3-year limit.
> _Only 27,977 miles since, but the clock got there first._

That second line is the point. A car driven 700 miles a month and a car driven
2,000 cross the same limits at completely different times, and a low-mileage car
still ends up with six-year-old tires.

---

## Setup

Three values in one file, then one SQL paste. Nothing else needs configuring.

```bash
npm install
cp .env.local.example .env.local   # paste in your keys
npm run dev
```

Running with placeholder keys shows a setup screen listing exactly these steps,
so there is no white page to debug.

**1. Supabase** — create the project directly at supabase.com. Do not use the
Vercel or GitHub integrations; see [Deploying](#deploying) for why. Then copy
two values from Project Settings → API:

| Value                    | Which key                                                  |
| ------------------------ | ---------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | Project URL, `https://<ref>.supabase.co`                    |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key — see the table below               |

Supabase renamed its keys, so the dashboard may show either generation:

| Dashboard label                       | Use it? | Why                                          |
| ------------------------------------- | ------- | -------------------------------------------- |
| Publishable key (`sb_publishable_…`)   | ✅ this  | The public browser key. RLS applies.         |
| Legacy anon key (`eyJ…`)               | ✅ same  | Older name for the identical role.           |
| Secret key (`sb_secret_…`)             | ❌       | **Bypasses RLS.**                            |
| Legacy service_role key (`eyJ…`)       | ❌       | **Bypasses RLS.**                            |
| JWT keys / JWT secret                  | ❌       | Signs user access tokens; not an API key.    |

The variable name is the long-standing convention, not a constraint — the value
goes straight to `createClient()`, which accepts either format.

The publishable key is safe in the browser: it grants nothing on its own, and
row-level security is what scopes data to the signed-in user. Pasting a secret
key instead would *appear* to work while silently disabling that scoping, which
is the one dangerous mix-up here. There is no `service_role` key anywhere in
this project, by design.

**1b. Authentication → URL Configuration.** Easy to miss and it breaks email
links: the app requests a redirect back to `window.location.origin`, and
Supabase rejects any redirect that is not on the allow-list.

- Site URL: your deployed URL (or `http://localhost:5173` before you deploy)
- Redirect URLs: `http://localhost:5173/**` and `https://<your-app>.vercel.app/**`

Two more auth settings worth a decision:

- **Confirm email** (Authentication → Providers → Email). Off means signup logs
  you straight in; on means you click a link first. The login screen handles
  both.
- **Allow new users to sign up** — turn this **off** once your account exists.
  The app sits on a public URL, and while RLS keeps anyone else's data separate,
  the API routes authenticate rather than authorise: any registered user could
  spend your Gemini quota. Closing signups is what actually locks it to you.

If magic links stop arriving, it is Supabase's built-in email sender, which is
rate-limited to a handful per hour. Fine for one person; custom SMTP otherwise.

**2. Gemini** — a key from [Google AI Studio](https://aistudio.google.com/apikey)
as `GEMINI_API_KEY`. Deliberately without a `VITE_` prefix, so Vite will not
bundle it into client code; only the serverless functions read it.

**3. Database** — paste `supabase/schema.sql` into the Supabase SQL Editor and
run it once. It creates the tables, turns on RLS, and seeds the service rules.
It is idempotent, so re-running it after a schema change is safe.

### Commands

| Command           | What it does                                          |
| ----------------- | ----------------------------------------------------- |
| `npm run dev`     | Full app including OCR — see the note below           |
| `npm test`        | Vitest suite (the flagging engine, OCR normalisation, blur detection) |
| `npm run lint`    | ESLint                                                |
| `npm run build`   | Production build to `dist/`                           |

`npm run dev` runs the `api/` serverless handlers inside the Vite dev server via
a small plugin in `tooling/`, so scanning works locally without installing the
Vercel CLI.

### Deploying

Import the repo on Vercel and add the same three variables in project settings,
for Production, Preview and Development. `vercel.json` already sets the SPA
rewrite and gives the extraction function a 60-second ceiling. Everything else
is Vercel's Vite preset.

`VITE_*` values are baked into the bundle at build time, so redeploy after
changing any of them.

**Skip the Vercel↔Supabase integration.** It injects `NEXT_PUBLIC_SUPABASE_URL`
and `SUPABASE_URL`, following Next.js naming. Vite only exposes `VITE_`-prefixed
variables to browser code, so `src/lib/supabaseClient.js` would still see
nothing and you would be adding the `VITE_` ones by hand anyway. It also injects
a `service_role` key this project deliberately never uses. The Supabase GitHub
integration is for migration and preview-branch workflows; this project ships
one `schema.sql` you paste once.

You do **not** need a Storage bucket, Edge Functions, a connection string, or
the database password. Receipt images go to the vision model and are dropped —
only the transcription is stored, so nothing but text reaches the database.

---

## How the flagging works

`src/lib/flagging.js` is the heart of the app and is pure — `now` is injected,
so all of the below is covered by tests rather than by waiting a year.

**Driving pace.** Every dated odometer reading becomes an observation. Pace is
measured across the widest span in the last two years, falling back to full
history, then to a flat 1,000 mi/month assumption that the UI labels as assumed.

Two deliberate choices here:

- **No minimum-mileage guard.** A car that covered 200 miles in eighteen months
  has a real pace of ~11 mi/month. Rejecting that as "not enough data" and
  substituting a generic assumption would produce exactly the wrong answer for
  exactly the user this app is for.
- **A pace of zero is a valid answer.** A stored car gets time-based flags
  (fluid, tire age, battery) and no mileage-based ones, which is correct.

**Interval items** (oil, filters, fluids, tire age) carry four thresholds:
yellow/red × mileage/months. Whichever limit arrives first governs. That is how
a garaged car gets flagged on age while a commuter gets flagged on miles, and
the row says which one it was.

**Measurable items** (tire tread, brake pads) fit a wear rate across readings
and extrapolate to today's projected odometer. A jump upward in a reading means
the part was replaced, so the wear calculation restarts there rather than
averaging through it.

**Qualitative items** (brake rotors) have no universal spec — every rotor
carries its own stamped minimum — so what gets stored is the shop's written
verdict. A clean verdict expires after two years or 20,000 miles and drops to
yellow, because "fine in 2022" is not evidence about today.

**Items with no history read as `unknown`, not red.** A new account has no
records for anything, and twelve red rows on day one would be both wrong and
useless.

### Tuning the numbers

The seeded thresholds are defaults, not gospel. They follow one rule: yellow
marks "worth knowing", red marks "actually do this now", with red at the widely
cited real minimum rather than the conservative figure shops quote.

To change them for one car — conventional oil instead of synthetic, a manual
transmission, an item the car does not have — insert a row into
`vehicle_service_rules`. Every column is nullable and overrides only what it
sets, and `enabled = false` removes an item from that vehicle's list. No app
code changes.

```sql
insert into vehicle_service_rules (vehicle_id, item_key, yellow_mileage, red_mileage)
values ('<uuid>', 'oil_change', 4000, 5000);
```

---

## Scanning

Capture happens in the app, one tap per receipt, because scanning a shoebox is a
repetitive loop.

Each frame runs a **Laplacian-variance sharpness check** the moment it is taken
(`src/lib/imageQuality.js`), plus exposure and contrast checks. A bad shot is
caught while you are still standing in front of the receipt, when a retake costs
nothing — and only that shot is held back; everything already queued keeps
processing. Exposure is checked before blur, because an underexposed photo also
measures as blurry and "too dark" is the more useful thing to be told.

Accepted images extract and save in the background while you keep shooting, one
at a time so a stack of twenty does not trip the vision API's rate limit.

There is no review-before-save step: records land immediately and are editable
from the service log. The **one** exception is an odometer reading *lower* than
what is on file. That is either an older receipt scanned out of order or a
misread digit, and it silently distorts the driving pace every projection is
built on — so nothing is overwritten and the app shows both numbers.

A **"Upload photos instead"** path takes a batch through the identical pipeline,
for receipts already photographed elsewhere.

---

## Layout

```
src/
  pages/         Garage · VehicleDetail · Upload · Login · SetupNeeded
  components/    FlagList/FlagItem (the signature element), ServiceLogTable,
                 ReceiptUploader, dialogs, and ui/ primitives
  lib/
    flagging.js      the engine — pure, tested
    vision.js        the ONLY module that talks to a vision provider
    imageQuality.js  blur/exposure detection — pure, tested
    dates.js         date maths (a Postgres date parses as *local* midnight)
    db.js            every Supabase query the browser makes
api/
  extract-receipt.js   image → structured JSON
  save-record.js       one receipt → several service_records
supabase/schema.sql    tables, RLS, seeded rules — paste once
```

Swapping vision providers means rewriting `src/lib/vision.js` and nothing else.

### Design

Warm off-white and warm near-black rather than `#FFF`/`#000`, with a brick-red
accent — "garage/tool", not a design-tool default. All colour lives in
`src/index.css` as theme-flipping CSS variables.

Status colours are declared twice: a base value for the left-border bar and dot,
and a contrast-corrected `-text` variant for anywhere the colour carries words.
Light-mode amber only reaches ~3.1:1 on the page background, which is fine for a
3px bar and not fine for a label.

Colour is never the only signal on a flag row. The sentence itself says why, red
rows sort to the top, and the status is announced to screen readers.

Type is **Space Grotesk** for display and **Inter** for body, both from Google
Fonts. The original direction called for Söhne or General Sans; those are
commercial and not on Google Fonts, so the stack in `src/index.css` lists them
first and falls through — drop in the real files and the fallback stops applying.

---

## Schema notes

Two deliberate extensions to the original sketch, both additive:

- **Four threshold columns for interval items** rather than one yellow/red pair.
  A single pair cannot express "8,000 miles or 10 months, whichever comes
  first", which is the whole mechanism.
- **`verdict` and `service_type_raw` on `service_records`.** The first stores a
  rotor inspection's written call; the second preserves the shop's exact wording
  so an unrecognised line item lands on the `other` key and stays searchable
  rather than being dropped.

Odometer sync is a database trigger that only ever ratchets *upward*. The
downward case is the one the app stops to ask about, so it lives in one place
rather than depending on writes going through the API.

Everything is scoped by `vehicles.owner_id` with RLS on from day one, even
though there is one user. That is what makes family sharing later an invite flow
and nothing else — no migration, no query changes.

## Not built yet

Per the original scope: an educational layer per rule (the `notes` column is
already seeded and surfaces on tap), a per-vehicle quirks log, periodic
oil-colour check-ins, and live in-viewfinder auto-capture. Manual capture with a
quality check is the shipped path.
