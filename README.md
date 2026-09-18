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
   real, not an example — leave the row there, but **clear whatever is in
   its `value` box** so it's empty. That's where the app writes down which
   Drive folder it keeps medicine photos in, and the app fills it in itself
   in Part 2 step 5. You don't make a folder and you don't paste an ID
   anywhere. And **DoseLog** has no example rows at all — it starts empty and fills
   in automatically as doses are ticked in the app, so there's nothing to
   delete there.
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
     `View` or `Edit`. For example, so a daughter can add and edit her
     father's medicines from the app (not just see them): a `Sharing` row
     with `owner_user_id` = his `user_id`, `shared_with_user_id` = her
     `user_id` (or blank, to give the whole family the same right),
     `section` = `Medicines`, `access` = `Edit`. This only affects adding,
     stopping and editing medicines — ticking a dose as taken is always
     the owner's alone, on every phone, `Edit` share or not (see "Changing
     a medicine from the app" below).
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

Once the app is live, add, change, stop, restart or delete a medicine from
the app itself — see "Changing a medicine from the app" further down this
guide — not by editing the `Prescriptions`, `PrescriptionDoses` or
`PrescriptionChanges` tabs by hand. The app writes to all three together
and keeps the medicine's history in step with what was actually taken; a
hand edit in the Sheet can't do that, and will leave that history wrong or
missing.

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
     "oauthScopes": [
       "https://www.googleapis.com/auth/spreadsheets.currentonly",
       "https://www.googleapis.com/auth/drive.file"
     ],
     "webapp": {
       "executeAs": "USER_DEPLOYING",
       "access": "ANYONE_ANONYMOUS"
     }
   }
   ```

   The `oauthScopes` list is what Google will ask your permission for in
   step 4, and it is spelled out on purpose rather than left for Google to
   guess from the code. Two things, and nothing else:

   - **`spreadsheets.currentonly`** — "See, edit, create, and delete only
     the specific Google Sheets file you use this app with." **This one
     Sheet only.** Not your other spreadsheets.
   - **`drive.file`** — "See, edit, create, and delete only the specific
     Google Drive files you use with this app." This is for the medicine
     and pill photos. **The only things in your Drive this app can ever
     see or change are the ones it made itself**: the photo folder it
     creates in step 5, the per-medicine subfolders inside it, and the
     photo files. Every other file and folder in your Drive is invisible
     to it — not hidden by good manners, but genuinely out of reach,
     because Google will refuse. That is why the app makes its own folder
     instead of being handed the ID of one you made: a folder you made by
     hand is one of the things it cannot open. If you would rather not
     grant even this, you can skip photos: everything else in the app
     works without it, and only the photo buttons will fail.

   Because these are written down here, the script asks for exactly this
   and nothing more — a later release that needs something new has to say
   so in this list, where you can see it.

3. **Paste in the eleven code files.** In this project's `apps-script/`
   folder there are eleven `.gs` files: `Access.gs`, `Actions.gs`,
   `Adapters.gs`, `AuthCore.gs`, `CheckSheet.gs`, `Code.gs`, `Data.gs`,
   `Drive.gs`, `Photos.gs`, `Prescriptions.gs`, `Schedule.gs`. For each one:
   - `Code.gs` already exists — click it, select all, delete, and paste in
     the matching file's contents.
   - For every other name, click the **+** next to "Files" in the sidebar,
     choose **Script**, type the name *without* `.gs` (e.g. type `Access`
     and Apps Script adds the extension itself), then paste in that file's
     contents.

   The order you create them in doesn't matter. When you're done, the file
   list on the left should show exactly those eleven names (plus
   `appsscript.json`), each holding the same code as the matching file in
   `apps-script/`.

4. **Check the Sheet before trusting it — and say yes to the Drive
   question.** Click on the `CheckSheet.gs` file so it's the open file —
   the function dropdown at the top of the editor (next to "Debug") only
   lists functions from whichever file is currently open. Choose
   **`checkSheet`** from that dropdown, then click **Run** (▶).
   - The first time, Google will ask you to authorize the script. Click
     **Review permissions**, choose your Google account, and if you see a
     screen saying "Google hasn't verified this app," click **Advanced**,
     then **Go to CyberHealth (unsafe)** — this is normal for a script only
     you and your family run — and **Allow**. The screen will list the two
     permissions from step 2: the one Sheets file, and the Drive files this
     app creates. Say yes here, in the editor, even if you don't plan to add
     a photo right away. If you skip this and only authorize it later, from
     a deployment, the very first photo anyone tries to add will fail.
   - Once it runs, open **Execution log** at the bottom (it usually opens
     automatically). `checkSheet` never changes your Sheet — it only reads
     it and reports problems.
   - If it prints `The Sheet looks good.`, you're ready for step 5.
   - If it lists problems (missing columns, a missing `Primary` user, an
     `_id` that points at nothing, two people with the same name, a
     duplicate active prescription, a `photo_folder_id` the app can't open,
     and so on), fix each one in the Sheet and run `checkSheet` again. It's
     safe to run as many times as you like.

5. **Make the folder for photos.** Click on the `Drive.gs` file so it's the
   open file, choose **`setUpPhotoFolder`** from the function dropdown, and
   click **Run** (▶). Open **Execution log** at the bottom to read what it
   says.
   - It creates a folder called **CyberHealth Photos** at the top level of
     your Google Drive, and writes down where it is in the `Settings` tab
     for you. There is nothing to copy and nothing to paste.
   - The log prints a link to the folder. **You can drag that folder
     anywhere you like in Drive afterwards** — tuck it inside another
     folder, rename it, whatever suits you. The app finds it by its ID, not
     by where it sits, so moving it won't break anything. Just don't delete
     it, and don't empty the `photo_folder_id` box.
   - Running it a second time is harmless: it checks the folder is still
     there and says there was nothing to do.
   - If it tells you the `photo_folder_id` box already holds an ID it can't
     open, that's a folder made by hand — see **Moving an older setup to
     the narrower Drive permission** at the end of Part 3.

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

### Upgrading to a new release

**When you edit the code later** (a new release of this project, or a fix
you made yourself): don't create a new deployment — that would change the
address and break every phone.

**Pick a quiet time of day.** Somebody is relying on this app to tell him
which pills he has taken. Upgrade when no dose is due and nobody is
mid-tick — mid-morning, or after the bedtime doses are done — not at 7am
with the morning tablets waiting.

**Two halves deploy separately, and the order matters.** The frontend is
the GitHub Pages site; the backend is this Apps Script deployment.
**Always do the backend first.** A new backend keeps the old frontend
working, because the data `bootstrap` sends it is unchanged — the new
actions are simply there unused. The other way round, every new button on
the phones calls an action Apps Script hasn't learned yet and comes back
with "Unknown action." until you catch up. So: Apps Script first, then the
website.

**Write down the version number you are on now**, before you change
anything. You'll find it under **Deploy → Manage deployments**, next to
the active deployment ("Version 7", say). That number is your way back.

Then, in this order:

1. **Note the current version number** (above). Thirty seconds now, and a
   one-minute rollback later instead of a scramble.
2. Paste in every file under `apps-script/` again (all eleven `.gs` files
   plus `appsscript.json`), overwriting what's there, so the editor matches
   the new release exactly. Three of the eleven are **new in release 2a**
   and won't exist in your project yet — create them with the **+** next to
   "Files" the way Part 2 step 3 describes:
   - `Drive.gs` — makes the app's photo folder and puts the photos in it
   - `Photos.gs` — checks a photo before it is uploaded
   - `Prescriptions.gs` — checks a dose or schedule before it is saved

   The other eight (`Access.gs`, `Actions.gs`, `Adapters.gs`, `AuthCore.gs`,
   `CheckSheet.gs`, `Code.gs`, `Data.gs`, `Schedule.gs`) already exist:
   open each, select all, delete, paste.
3. Open `CheckSheet.gs`, choose **`checkSheet`** from the function dropdown,
   and click **Run** — and if Google asks you to authorize the script
   again, accept it, same as Part 2 step 4. **It will ask this time:**
   release 2a adds the Google Drive permission for photos (Part 2 step 2
   explains exactly what it covers), and Google asks again whenever the
   permissions change. Do this **before** the next step: a deployment made
   before this authorization is accepted will fail the first time anyone
   tries to add a photo. If you're coming from a release before this one,
   read **Moving an older setup to the narrower Drive permission** below
   first — there's a box in the Sheet to empty before you run anything.
4. Only then go **Deploy → Manage deployments**, click the pencil (**Edit**)
   on the existing deployment, change **Version** to **New version**, and
   click **Deploy**. The `/exec` address stays exactly the same.
5. Now update the website half, and open the app on your own phone to check
   it before telling anyone else it's ready.

Pasting code into the editor is safe on its own: a deployment is frozen at
the version it was made from, so the family keeps using the old code until
step 4. Step 4 is the moment the change actually reaches the phones.

### Moving an older setup to the narrower Drive permission

**Do this once, if you set your Sheet up before this release.** Earlier
versions asked you to make a photo folder yourself and paste its ID into
the `Settings` tab, and they asked Google for permission to reach *all* of
your Drive, because that was the only permission that could open a folder
made by hand. This release asks for a much smaller permission — only the
files the app itself creates — so the app now makes its own folder, and the
ID you pasted in is one it can no longer open.

Nothing breaks while you do this: the app keeps working, and photo uploads
refuse with a message saying exactly this, rather than quietly making a
second folder. Do it at a quiet time of day all the same.

1. **Empty the old ID.** Open the Sheet, go to the **Settings** tab, find
   the `photo_folder_id` row, and delete whatever is in its `value` box.
   Leave the row itself in place. (Nobody but you can do this step — the
   app deliberately won't clear it for you, so there's no chance of ending
   up with two folders and no idea which one your photos are in.)
2. **Paste in the changed files**, the way step 2 above describes:
   `appsscript.json`, `Drive.gs`, `CheckSheet.gs`, `Code.gs` and
   `Actions.gs`. No new files this time.
3. **Run `setUpPhotoFolder`** — Part 2 step 5. **Google will ask your
   permission again**, because the permissions changed. Read the screen: it
   should now say Google Drive files *you use with this app*, not all of
   them. Accept it. The log will tell you where your new **CyberHealth
   Photos** folder is.
4. **Move any old photos yourself.** If your old hand-made folder has
   photos in it, drag them into the new folder. The app can't reach the old
   folder any more, so it can't do this for you. (Photos already showing in
   the app keep showing: the links in the Sheet still work — the app simply
   can't change or delete those files from now on.)
5. **Deploy a new version** — steps 4 and 5 above. Until you do, the family
   is still on the old code and the old permission.
6. **Optional, once everything works: take the old permission away.** Go to
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
   find **CyberHealth**, and remove its access. The next time you run
   anything in the editor, Google will ask again — and will ask only for
   the two narrow permissions. Do this *after* step 5 and after you've
   added one photo successfully, not before.

### If a release goes wrong — rolling back

You can be back on the version that worked in under a minute, and you don't
need any code to do it:

1. **Deploy → Manage deployments**.
2. Click the pencil (**Edit**) on the active deployment.
3. Open the **Version** dropdown and choose the **previous** version — the
   number you wrote down in step 1 above.
4. Click **Deploy**.

The `/exec` address doesn't change, so every phone is back on the old code
as soon as it next loads. Nothing is lost: old versions are kept, so you
can go forward again the same way once the problem is fixed.

Two things a rollback does **not** undo, so check them if the problem
looks like one of these:

- **Your Sheet.** Anything already written to it stays written. Doses
  already ticked are still ticked, which is what you want.
- **The website half.** If you had already updated GitHub Pages, roll that
  back too, or the new phones will be calling actions the old backend
  doesn't have.

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

## Changing a medicine from the app

If someone has shared editing rights with you (the `Sharing` row described
in Part 1), you can add, change and stop medicines right from the app — no
need to open the Sheet.

Open the **Medicines** tab. If you look after more than one person's
medicines, switch between them at the top of that tab. Tap a medicine in
the list to open its own page. From there:

- **Add a medicine to this list** (button at the top of the Medicines tab)
  — starts a new prescription for whoever's list you're looking at.
- **Change how much to take** and **Change when to take it** (on a
  medicine's own page) — change the dose amount or the schedule.
- **Stop taking this** — asks you to confirm first. It moves the medicine
  to the "Stopped" list further down the Medicines tab; everything already
  ticked off for it is kept exactly as it was. A stopped medicine can be
  brought back later with **Start taking this again**.
- **Edit details** — changes the medicine itself: its name, strength,
  purpose and notes. The medicine library is shared by the whole family,
  so this changes it for everyone who takes it, not only for the person
  whose page you're on.
- **Delete — this was added by mistake** — only shows up while no dose has
  ever been recorded against this prescription (ticked as taken, or
  skipped). The moment even one dose exists, this button disappears and
  **Stop taking this** becomes the only way to remove it from the current
  list — so the record of what was actually taken never loses a row.

Two things are deliberate and worth knowing, so they don't look like bugs:

- **A dose already ticked never changes**, even if the amount or schedule
  is changed later the same day. A change like this only takes effect from
  the next dose that hasn't been ticked yet.
- **Ticking a dose as taken is always the owner's alone.** Someone you've
  shared `Edit` access with can change what a medicine is, how much of it
  to take, or when — but only the person themselves, on their own phone,
  can tick a dose off as taken.

---

## Develop

For whoever maintains the code (not the family admin):

- `npm test` — runs all tests (`tests/*.test.js`). Everything should stay
  green before you commit.
- `npm run sync-gs` — after editing any of `js/schedule.js`, `js/access.js`,
  `js/authcore.js`, `server/prescriptions.js`, `server/actions.js` or
  `server/photos.js`, run this to regenerate the matching files in
  `apps-script/` (`Schedule.gs`, `Access.gs`, `AuthCore.gs`,
  `Prescriptions.gs`, `Actions.gs`, `Photos.gs`, in that order). Those six
  `.gs` files are generated — don't hand-edit them, edit the source `.js`
  file and re-run the script. The other five Apps Script files
  (`Adapters.gs`, `Code.gs`, `Data.gs`, `CheckSheet.gs`, `Drive.gs`) are
  Apps Script-only and are edited directly.
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

## What's in this build / still coming

**This build:**

- Login per person, with password reset via a 6-digit code the family
  admin sets in the Sheet.
- Today screen: this week's schedule, ticking doses as taken.
- Adding, editing, stopping, restarting and deleting your own medicines and
  prescriptions from the app itself, and adding or editing a medicine in
  the shared library, with photos for each — see "Changing a medicine from
  the app" above.
- Viewing doctors, hospitals and each person's care team.
- Viewing and editing your own emergency card; viewing everyone else's.
- A public, no-login emergency card, reachable from the login screen.
- Sharing rules (the `Sharing` tab) are already enforced for viewing and
  editing, even though there's no in-app screen to manage them yet.
- A Sheet health check (`checkSheet`) an admin runs from Apps Script.
- Installs to the home screen as a full-screen app with offline caching of
  already-loaded screens.

**Still coming** (the app's own "More" screen lists these under "Coming
soon"), done directly in the Sheet for now:

- Adding and editing hospitals, doctors, and which hospitals a doctor
  works at.
- Adding hospital numbers and care team entries.
- Managing `Sharing` rules, and adding family members.
- Changing your own password from inside the app (without needing a reset
  code).
