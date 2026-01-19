MPGB Premier League – Firebase Live Scoring (Static Web App)
===========================================================

A) Run locally (Windows) – Full steps
------------------------------------
1) Unzip this project to a folder, e.g.:
   C:\Users\<YOU>\Documents\mpgb-premier-league

2) Open that folder in File Explorer.
   You MUST run a local server (because ES modules + fetch won't work reliably on file://).

Option-1 (Python – easiest)
- Install Python 3.x (if already installed, skip)
- Open CMD/PowerShell inside the project folder
- Run:
    python -m http.server 8000
- Now open:
    http://localhost:8000/index.html

Option-2 (VS Code Live Server)
- Install VS Code
- Install extension: "Live Server"
- Right click index.html → "Open with Live Server"

3) First test WITHOUT Firebase
- Open Home, Schedule, Teams etc. UI should load.
- Live status will say "Firebase not configured" (expected).

B) Enable Firebase (for REAL Cricbuzz-like live feel)
-----------------------------------------------------
1) Create Firebase project
   - Go to Firebase Console → Add project

2) Enable Authentication
   - Build → Authentication → Get started
   - Sign-in method → Email/Password → Enable

3) Create scorer accounts
   - Authentication → Users → Add user
   - Create 1-2 scorer accounts (email+password)

4) Create Firestore database
   - Build → Firestore Database → Create database (Production or Test)

5) Set Firestore security rules
   - Firestore → Rules
   - Copy-paste rules from: firestore.rules (this project)
   - Publish

6) Create a Web App + get config
   - Project settings → General → Your apps → Add app (Web)
   - Copy the firebaseConfig object

7) Paste config into this file:
   - js/firebase-config.js
   Example:
     export const FIREBASE_CONFIG = {
       apiKey: "...",
       authDomain: "...",
       projectId: "...",
       storageBucket: "...",
       messagingSenderId: "...",
       appId: "..."
     };

8) Reload your local server page (Ctrl+R)
   - Home will show "Firebase: connected"

9) Initialize tournament schedule into Firestore (one-time)
   - Open: Admin page → Login with scorer account
   - Click: "Initialize tournament in Firestore"
   - This creates documents for all matches with UPCOMING status.

C) How live will work (exact requirement you asked)
---------------------------------------------------
1) Scorer:
   - Admin → login
   - Open scorer.html?match=A1 (from Admin links or schedule)
   - Click "Start Match (LIVE)"
   - As scorer logs balls, match becomes LIVE & updates in real time.

2) Public:
   - Home page shows "Live Now" card as soon as any match is LIVE.
   - Schedule page shows LIVE badge on that match.
   - Clicking "Watch Live" opens live scorecard instantly.

D) Deploy to GitHub Pages (after local test is OK)
--------------------------------------------------
1) Put ALL files from this project into your repo root
2) Settings → Pages → Deploy from branch → main / root
3) Your site will work because:
   - Pure static HTML/CSS/JS
   - Firebase SDK loaded via CDN

NOTES / LIMITS (transparent)
----------------------------
- This is a "Cricbuzz-like feel" but simplified scoring (RUN / W / WD / NB / BYE).
- You can add full scoreboard features later (strike rotation, partnerships, fall-of-wickets UI, wagon-wheel etc.)
- Firebase web config is public; security is done via Firestore Rules + Authentication.
