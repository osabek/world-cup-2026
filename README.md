# ⚽ Road to the Cup 2026

A kid-friendly FIFA World Cup 2026 scenario game. Fill in scores, watch the group
tables and best-third race update live, tap teams through the knockout bracket, and
crown a champion. Click any flag to see that team's real 26-man squad as FIFA-style
player cards — with real photos, and tap any card for the player's full profile
(bio, vitals, club & national-team career, YouTube highlights), all live from Wikipedia.

## Features
- **🎲 Simulate** — sim one group, all groups, the rest of the bracket, or the whole
  tournament. Results are weighted by Team Power ratings, upsets included.
- **🥅 Penalty shootouts** — drawn knockout games can be settled with a tap-to-shoot
  shootout mini-game.
- **📺 Live tab + today strip** — live games with match clocks, today's kickoff times
  (local), finished scores; refreshes every minute from ESPN's feed.
- **🏅 Prediction scorecard** — scenario picks double as predictions: 3 pts for the
  exact score, 1 pt for the right outcome, 1 pt for a correct bracket pick — scored
  automatically as real results sync in. Add a rival for a head-to-head league.
- **💾 Scenario slots** — save/load named what-if universes (Settings).
- **⚔️ Team battle** — compare any two teams line by line (Teams tab).
- **🔊 Stadium sounds** — goal horns, whistles, crowd roar (toggle in Settings).
- **👥 League play (multiplayer)** — create an account (made-up username + 6-digit
  PIN, no email/personal info), start a league, share the 6-letter invite code, and
  compete on a live leaderboard. Your scenario picks double as predictions. Friends'
  upcoming picks stay hidden until kickoff; tap a name to see their scored picks after.
- **⏱️ Pick lock** — predictions close 5 minutes before kickoff (enforced on the
  server too). Matches show a countdown and an "about to begin" warning.
- **🔮 Auto-predictor** — one tap fills a sensible predicted score for any game (or all
  open games), based on team strength — handy when you don't know the teams.

## League play setup (Firebase)
The game uses a free Firebase project (`wc26-road-to-the-cup`) for accounts and the
shared leaderboard. It's already provisioned: Firestore + security rules
(`firestore.rules`), email/password auth, and `osabek.github.io` authorized.

- **Admin:** whoever registers the username **`omar`** is the league admin (set in
  Firestore `config/setup.adminUsername`). The admin can remove/ban duplicate or
  troublemaker accounts and push kickoff deadlines to the server. **Register `omar`
  first** so nobody else claims it.
- **Deadlines:** the server enforces the 5-minute lock using `config/deadlines`.
  Group-stage kickoffs are seeded; once knockout kickoff times are published, the admin
  taps "Sync kickoff deadlines to server" in the League → Admin panel to extend it.
- Config values in `firebase-config.js` are public by design — security lives in the
  rules, not in hiding them.

## How to play it
**Hosted (any device, anywhere):** <https://osabek.github.io/world-cup-2026/>

**Locally:** double-click **`Start World Cup Game.command`** (or run `node server.js`
here), then open <http://localhost:8336>. Works on iPads/phones on the same Wi-Fi via
this Mac's IP address, e.g. `http://192.168.x.x:8336`.

Scenario progress saves in the browser per device/site, so the hosted game and the
local game each keep their own picks.

## How real scores get in
Settings tab → **Real score updates**:
- **Off** — pure scenario mode.
- **Sync button** (default) — a 🔄 SYNC SCORES button appears in the header; pressing
  it pulls real results from ESPN's public scoreboard feed (no key needed).
- **Live-score API** — auto-refreshes every 60 seconds while the page is open.

Optionally paste a free [football-data.org](https://www.football-data.org/) API key in
Settings to use that source instead of ESPN.

Real results show a **FT ✓** badge and lock their score. Tap **✏️** on any locked match
to play "what-if" with history; **↩️** restores the real result.

**🧹 Wipe all scores** (Settings) clears everything — picks *and* real results. Real
results are restored the next time Sync runs or Live updates are on.

## Data
- `data/teams.json` — the 48 qualified teams and the official December 2025 draw.
- `data/schedule.json` — all 104 matches: official match numbers, dates, venues, and
  the Round-of-32 bracket topology incl. third-place candidate-group rules.
  (All 72 group fixtures and all 16 R32 pairings verified against ESPN's feed.)
- `data/squads-*.json` — real announced 26-man squads (from Wikipedia, June 2026)
  with FIFA-style ratings assigned for the game.

Scenario state lives in the browser's localStorage (`wc26-state-v1`).
