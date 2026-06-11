/* ⚽ Road to the Cup 2026 — tiny local server + live-score proxy */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8336;
const ROOT = __dirname;
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

/* World Cup window with margin */
const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=400&dates=20260610-20260720";
const FDO_URL = "https://api.football-data.org/v4/competitions/WC/matches";

function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }

async function fetchESPN() {
  const r = await fetch(ESPN_URL);
  if (!r.ok) throw new Error("ESPN feed returned " + r.status);
  const j = await r.json();
  const out = [];
  for (const ev of j.events || []) {
    const comp = (ev.competitions || [])[0];
    if (!comp) continue;
    const home = (comp.competitors || []).find(c => c.homeAway === "home");
    const away = (comp.competitors || []).find(c => c.homeAway === "away");
    if (!home || !away) continue;
    const state = ev.status && ev.status.type ? ev.status.type.state : "pre";
    const status = state === "post" ? "FT" : state === "in" ? "LIVE" : "SCHED";
    const m = {
      date: isoDay(ev.date),
      home: home.team.displayName,
      away: away.team.displayName,
      hs: home.score != null ? parseInt(home.score, 10) : null,
      as: away.score != null ? parseInt(away.score, 10) : null,
      status,
      penH: null, penA: null,
    };
    if (home.shootoutScore != null && away.shootoutScore != null) {
      m.penH = parseInt(home.shootoutScore, 10);
      m.penA = parseInt(away.shootoutScore, 10);
    }
    out.push(m);
  }
  return out;
}

async function fetchFDO(key) {
  const r = await fetch(FDO_URL, { headers: { "X-Auth-Token": key } });
  if (r.status === 403 || r.status === 401) throw new Error("API key rejected by football-data.org");
  if (!r.ok) throw new Error("football-data.org returned " + r.status);
  const j = await r.json();
  return (j.matches || []).map(m => ({
    date: isoDay(m.utcDate),
    home: m.homeTeam && (m.homeTeam.name || m.homeTeam.shortName),
    away: m.awayTeam && (m.awayTeam.name || m.awayTeam.shortName),
    hs: m.score && m.score.fullTime ? m.score.fullTime.home : null,
    as: m.score && m.score.fullTime ? m.score.fullTime.away : null,
    status: m.status === "FINISHED" ? "FT"
      : (m.status === "IN_PLAY" || m.status === "PAUSED") ? "LIVE" : "SCHED",
    penH: m.score && m.score.penalties ? m.score.penalties.home : null,
    penA: m.score && m.score.penalties ? m.score.penalties.away : null,
  }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/scores") {
    res.setHeader("Content-Type", "application/json");
    try {
      const source = url.searchParams.get("source") || "espn";
      const matches = source === "fdo"
        ? await fetchFDO(url.searchParams.get("key") || "")
        : await fetchESPN();
      res.end(JSON.stringify({ matches }));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // static files
  let fp = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!fp.startsWith(ROOT)) { res.statusCode = 403; return res.end("Nope"); }
  if (url.pathname === "/") fp = path.join(ROOT, "index.html");
  fs.readFile(fp, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", MIME[path.extname(fp)] || "application/octet-stream");
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ⚽🏆  ROAD TO THE CUP 2026 is ON!");
  console.log("  👉  Open  http://localhost:" + PORT + "  in your browser");
  console.log("  (works on iPads/phones on your home Wi-Fi too — use this Mac's IP)");
  console.log("");
});
