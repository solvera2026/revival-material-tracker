# Revival Material Loadout

Field app for Revival Concrete Coatings crews: load the trailer, record who is on the job, return materials, and sign off.
Copy of the PFC material tracker, set up for Revival's systems (polyurea base, MVB 3-coat, 1150FC, full polyaspartic,
High-Wear Urethane, grind & clear) and Revival's flake colors.

- `src/App.jsx` — the app (Netlify, Vite + React). Coverage rates come from the Revival pricing model (Job Cost tab, columns Y–AA).
- `netlify/functions/material-api.js` — passes requests to the Apps Script web app (env vars `APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN`).
- `apps-script/Code.gs` — backend in the "Revival Material Tracker" Google Sheet: Crew Entries, **Crew Days** (one row per person per job per day, used for job labor), Crew Roster (names as in Gusto), Waste Report. No inventory here: counts and ordering live in the 2026 Flake & Chemical Sheet DSM.
- Jobs come from the Revival Crew Schedule (Schedule Log); the Job ID is the DripJobs project ID.
