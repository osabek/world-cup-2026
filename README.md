# ⚽ Road to the Cup 2026

A kid-friendly FIFA World Cup 2026 scenario game. Fill in scores, watch the group
tables and best-third race update live, tap teams through the knockout bracket, and
crown a champion. Click any flag to see that team's real 26-man squad as FIFA-style
player cards.

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
