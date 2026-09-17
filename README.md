# CyberHealth

A private medication and family-health app. Everyone's medicines, doctors,
dose schedule and emergency card live in one Google Sheet that only your
family controls — no company, no subscription, no account to sign up for.
Your phone talks straight to your own Sheet.

This guide is written for whoever is setting the app up for the family (the
"family admin"). It assumes no programming experience. You need a Google
account and about 30–45 minutes the first time.

There are three things you'll end up with:

1. **A Google Sheet** — your family's private database.
2. **A deployed address** (a link ending in `/exec`) — how the app talks to
   that Sheet.
3. **A private app link** — what you send to each phone, once.

---

## Part 1 — Build your Google Sheet

1. Download `CyberHealth_Sheet_v2.xlsx` from this project and upload it to
   your own Google Drive.
2. Open it (double-click it in Drive). It opens in Sheets' preview mode.
3. **File → Save as Google Sheets.** This creates a real, editable Google
   Sheet — a separate file from the one you uploaded. Everything from here
   on happens in that new file.
4. Rename the file to something like "CyberHealth" (File → Rename), and make
   sure it's **not shared with anyone** — only the Apps Script you'll add in
   Part 2 needs to read it.
5. Look through the tabs along the bottom. The **README** tab explains the
   colour coding (purple = key column, red = required, blue = optional, grey
   = filled in automatically by the app) and lists every column. The
   **Lists** tab holds the dropdown choices — don't edit it.
6. Every other tab has one or two **grey, italic example rows** at the top —
   sample data so you can see the shape of a real row. Delete every grey
   example row once you understand it (right-click the row number → Delete
   row). Two exceptions: the **Settings** tab's `photo_folder_id` row is
   real, not an example — leave it as is (photo storage isn't used until
   release 2, but the value is already correct); and **DoseLog** has no
   example rows at all — it starts empty and fills in automatically as
   doses are ticked in the app, so there's nothing to delete there.
7. Fill in your family's real data, tab by tab. A few things matter more
   than others:
   - **Users** — one row per person who will use the app. `user_id` is a
     short code you make up (`U01`, `U02`, …) and must never change once
     you've used it elsewhere. `role` must be exactly `Primary` for the one
     person the app opens on by default (e.g. the family member whose
     medicines matter most), and `Family` for everyone else — **exactly one
     active person must be `Primary`**. Leave `password_hash` blank; the
     app fills that in the first time someone sets their password. Put a
     **6-digit `reset_code`** (any 6 digits, e.g. `482913`) in each person's
     row — that's what lets them set their first password. `active` must be
     `TRUE` for anyone who should be able to log in.
   - **Sharing** — controls who besides the owner can see or edit someone's
     records. By default nobody but the owner can see their own Medicines
     or Care team rows, so you'll usually want at least one `Sharing` row
     per person granting the rest of the family `View` or `Edit` access
     (leave `shared_with_user_id` blank to share with everyone). `section`
     must be exactly `Medicines` or `Care team`; `access` must be exactly
     `View` or `Edit`.
   - **Medicines**, **Hospitals**, **Doctors** — the shared family
     libraries. Add the ones you actually use.
   - **Prescriptions** and **PrescriptionDoses** — what each person takes
     now, and how much at each time of day. `status` should be `Active` for
     anything currently being taken.
   - **EmergencyCards** — one row per person. This is what shows on the
     public emergency screen (see Part 5), so keep it accurate but leave
     out anything you don't want visible to someone without a login.
8. When you think it's complete, leave the Sheet open — you'll run a
   checker against it in Part 2 before trusting it.

### Changing a medicine later

Once the app is live, a medicine change is always an edit to an existing
row, never a delete-and-retype — the app (and the medicine's history)
assumes an id, once used, always means the same prescription:

- **Dose amount changed?** Edit the `amount` on that dose's row in
  **PrescriptionDoses** in place — same `dose_id`, same `prescription_id`.
- **Medicine stopped?** Set that row's `status` in **Prescriptions** to
  `Stopped`. Never delete the row, and never add a second `Prescriptions`
  row for the same person and medicine — the app can't tell that apart
  from a mistake, and will show the pill twice and warn about it.
- Either way, add a line to **PrescriptionChanges** describing what
  changed and why — it's what shows in the app's medicine history — then
  run `checkSheet` again to make sure nothing broke.

## Part 2 — Add the Apps Script

Apps Script is Google's way of running code against your Sheet. You're
going to paste in the code from this project's `apps-script/` folder.

1. In your Sheet, go to **Extensions → Apps Script**. It opens a new tab
   with a code editor and one file already in it, `Code.gs`. Rename the
   project now (click "Untitled project" at the top and type
   "CyberHealth") — do this **before** you first click Run in step 4, so
   the permission screen Google shows you asks to run "CyberHealth", not
   "Untitled project".
2. **Paste in the manifest first.** Click the gear icon (**Project
   Settings**) in the left sidebar, and tick **"Show `appsscript.json`
   manifest file in editor"**. Go back to the editor (`<>` icon), click on
   the new `appsscript.json` file, select all its contents and delete them,
   then paste in exactly this:

   ```json
   {
     "timeZone": "Asia/Bangkok",
     "dependencies": {},
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "webapp": {
       "executeAs": "USER_DEPLOYING",
       "access": "ANYONE_ANONYMOUS"
     }
   }
   ```

3. **Paste in the eight code files.** In this project's `apps-script/`
   folder there are eight `.gs` files: `Access.gs`, `Actions.gs`,
   `Adapters.gs`, `AuthCore.gs`, `CheckSheet.gs`, `Code.gs`, `Data.gs`,
   `Schedule.gs`. For each one:
   - `Code.gs` already exists — click it, select all, delete, and paste in
     the matching file's contents.
   - For every other name, click the **+** next to "Files" in the sidebar,
     choose **Script**, type the name *without* `.gs` (e.g. type `Access`
     and Apps Script adds the extension itself), then paste in that file's
     contents.

   The order you create them in doesn't matter. When you're done, the file
   list on the left should show exactly those eight names (plus
   `appsscript.json`), each holding the same code as the matching file in
   `apps-script/`.

4. **Check the Sheet before trusting it.** Click on the `CheckSheet.gs` file
   so it's the open file — the function dropdown at the top of the editor
   (next to "Debug") only lists functions from whichever file is currently
   open. Choose **`checkSheet`** from that dropdown, then click **Run**
   (▶).
   - The first time, Google will ask you to authorize the script. Click
     **Review permissions**, choose your Google account, and if you see a
     screen saying "Google hasn't verified this app," click **Advanced**,
     then **Go to CyberHealth (unsafe)** — this is normal for a script only
     you and your family run — and **Allow**.
   - Once it runs, open **Execution log** at the bottom (it usually opens
     automatically). `checkSheet` never changes your Sheet — it only reads
     it and reports problems.
   - If it prints `The Sheet looks good.`, you're ready for Part 3.
   - If it lists problems (missing columns, a missing `Primary` user, an
     `_id` that points at nothing, two people with the same name, a
     duplicate active prescription, an empty `photo_folder_id`, and so on),
     fix each one in the Sheet and run `checkSheet` again. It's safe to run
     as many times as you like.

## Part 3 — Deploy the web app

1. Back in the Apps Script editor, click **Deploy** (top right) → **New
   deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Execute as:** `Me (your email)`
   - **Who has access:** `Anyone`
4. Click **Deploy**. You may be asked to authorize access again — same
   steps as in Part 2.
5. A box appears with a **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfycb.../exec`. **Copy it** — this
   is your family's private address. Anyone who has it can reach your
   Sheet through the app, so treat it like a password (more on that in Part
   4).

**When you edit the code later** (a new release of this project, or a fix
you made yourself): don't create a new deployment — that would change the
address and break every phone. Instead go **Deploy → Manage deployments**,
click the pencil (**Edit**) on the existing deployment, change **Version**
to **New version**, and click **Deploy**. The `/exec` address stays exactly
the same.

## Part 4 — Build the private link

Take the `/exec` address you copied and put it after this, with no space:

```
https://bewilddata-creator.github.io/Cyberhealth_Mobile/#api=<your address>
```

For example:

```
https://bewilddata-creator.github.io/Cyberhealth_Mobile/#api=https://script.google.com/macros/s/AKfycb.../exec
```

**Send this link privately** to each family member — a direct message or
text, not a group chat or anything public. Anyone holding this link can
open the app and see the public emergency card (Part 5's last section)
without logging in, and can attempt to log in as anyone in your Users tab.
Share it the way you'd share a password, not the way you'd share a photo.

## Part 5 — Put the app on each iPhone

Do this once per phone, in **Safari** (not Chrome — only Safari's "Add to
Home Screen" gives the full-screen, offline-capable app used here), and
**in this exact order**. iOS gives a home-screen icon its own separate
storage from Safari — logging in inside Safari first does **not** carry
over to the icon, so if you log in before adding the icon, you'll just
have to log in again from the icon anyway:

1. Open the private link from Part 4 in Safari. Don't log in yet.
2. Tap the **Share** icon (the square with an arrow pointing up), scroll
   down, and tap **Add to Home Screen**. Confirm the name ("CyberHealth")
   and tap **Add**.
3. Open the app **from its new icon** on the home screen — not from
   Safari.
4. Now, from the icon, log in: this shows **"Who's using the app?"** with
   everyone's name as a button. Tap your name.
   - **First time ever:** tap **"Set or forgot password"**, enter the
     6-digit `reset_code` the family admin put in your `Users` row, choose
     a password (at least 6 characters), and tap **"Save password and log
     in."**
   - **Already have a password:** just type it and tap **Log in**.

You only need to do steps 1–4 once. The connection is remembered on that
phone, and the login stays signed in for about 6 months. From now on,
always open the app from its home-screen icon, not from Safari — it opens
full-screen, without the address bar. The app opens even with no signal,
but it needs a connection to load your pills.

### If the link doesn't carry the address across

If opening the link ever lands you on a screen titled **"Connect this
phone"** instead of the name picker, it means this phone doesn't have the
address saved yet. Paste the same `/exec` address (the part after `#api=`
in your private link) into the box there and tap **Connect** — this is a
one-time fallback and has the same effect as opening the full link.

### Forgotten password

1. The family admin opens the Sheet's **Users** tab, finds that person's
   row, and types a new 6-digit code into `reset_code` (any 6 digits — the
   old code stops working the moment someone uses it, so a fresh code is
   always needed for a second reset).
2. Tell that person the new code (call or text them separately from the
   app link — don't put a password-equivalent and the app link in the same
   message if you can help it).
3. They open the app, tap their name, tap **"Set or forgot password,"** and
   enter the new code with a new password, same as first-time setup.

Five wrong password or code attempts in a row lock that name out for 15
minutes (to stop guessing), but a correct password always still gets
through even during that lockout.

### The public emergency card

On the "Who's using the app?" screen (or the emergency button reachable
from it), anyone with the private link can tap **"Emergency card · no
login"** — no name or password needed. It shows blood type, allergies,
conditions, family contacts and current medicines for whichever person's
card is selected — everything a paramedic might need — but it never shows
hospital numbers or anything else in the app. This is exactly why Part 4
says to treat the link like a password: it's what makes the emergency card
reachable without anyone signing in.

---

## Develop

For whoever maintains the code (not the family admin):

- `npm test` — runs all tests (`tests/*.test.js`). Everything should stay
  green before you commit.
- `npm run sync-gs` — after editing any of `js/schedule.js`, `js/access.js`,
  `js/authcore.js` or `server/actions.js`, run this to regenerate the
  matching files in `apps-script/` (`Schedule.gs`, `Access.gs`,
  `AuthCore.gs`, `Actions.gs`). Those four `.gs` files are generated —
  don't hand-edit them, edit the source `.js` file and re-run the script.
  The other four Apps Script files (`Adapters.gs`, `CheckSheet.gs`,
  `Code.gs`, `Data.gs`) are Apps Script-only and are edited directly.
- `npm run serve` — serves the app locally at `http://localhost:8080` with
  Python's built-in server. To try it against sample data instead of a
  real Sheet, temporarily change `js/config.js` to
  `export const API_URL = "mock";`, then revert it back to
  `export const API_URL = "";` before committing — `"mock"` must never be
  committed, and it only works when the page is loaded over `http://` (a
  real `https://` deploy always refuses `"mock"`, so a stray value there
  can't silently swap in fake data for a live user).

Before committing, run `npm run sync-gs && npm test && git status --short`
and make sure the tests are green and there's no uncommitted drift in
`apps-script/`.

## What's in release 1 / coming in release 2

**Release 1 (this build):**

- Login per person, with password reset via a 6-digit code the family
  admin sets in the Sheet.
- Today screen: this week's schedule, ticking doses as taken.
- Viewing the medicine library, each person's prescriptions and dose
  history.
- Viewing doctors, hospitals and each person's care team.
- Viewing and editing your own emergency card; viewing everyone else's.
- A public, no-login emergency card, reachable from the login screen.
- Sharing rules (the `Sharing` tab) are already enforced for viewing and
  editing, even though there's no in-app screen to manage them yet.
- A Sheet health check (`checkSheet`) an admin runs from Apps Script.
- Installs to the home screen as a full-screen app with offline caching of
  already-loaded screens.

**Coming in release 2** (the app's own "More" screen already lists these
under "Coming soon"):

- Adding and editing medicines, prescriptions and dose schedules from the
  app itself (for now, this is done directly in the Sheet).
- Adding to the medicine library, hospital numbers and care team from the
  app.
- Managing `Sharing` rules from the app.
- Changing your own password from inside the app (without needing a reset
  code).
- Photos for medicines and doctors (the Sheet's `photo_folder_id` setting
  is already in place for this).
