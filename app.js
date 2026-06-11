/* ⚽ Road to the Cup 2026 — scenario game engine */
"use strict";

const STORE_KEY = "wc26-state-v1";

const App = {
  teams: null,        // { groups: {A:[codes]}, teams: {CODE:{...}} }
  schedule: null,     // { groupMatches:[], knockout:{R32,R16,QF,SF,THIRD,FINAL} }
  squads: {},         // CODE -> [players]
  state: null,
  liveTimer: null,
  lastChampion: null,
};

/* ───────────────────────── state ───────────────────────── */
function defaultState() {
  return {
    scenario: {},   // "m12" -> {h,a} or {winner} for KO
    real: {},       // "m12" -> {h,a,live,winner,pens}
    overrides: {},  // "m12" -> true  (what-if on a locked real result)
    settings: { mode: "sync", apiKey: "", sound: true },
    lastSync: null,
    predLog: {},       // "m1" -> {pred:{h,a}|{winner}, real:{h,a,winner}, pts, rivalPred, rivalPts}
    rival: null,       // {name, preds:{"m1":{h,a}}}
    slots: {},         // name -> {scenario, overrides, savedAt}
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* corrupted -> fresh */ }
  return defaultState();
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(App.state)); }

/* result getters: "effective" mixes real + scenario, "real" is sync-only */
function effResult(num) {
  const k = "m" + num;
  const real = App.state.real[k], scen = App.state.scenario[k];
  if (real && !App.state.overrides[k]) return { ...real, source: real.live ? "live" : "real" };
  if (scen) return { ...scen, source: real ? "whatif" : "pick" };
  return null;
}
function realResult(num) {
  const r = App.state.real["m" + num];
  return r ? { ...r, source: r.live ? "live" : "real" } : null;
}

/* ───────────────────────── standings ───────────────────────── */
function groupMatchesOf(g) {
  return App.schedule.groupMatches.filter(m => m.group === g);
}
function groupTable(g, getR) {
  const codes = App.teams.groups[g];
  const rows = {};
  codes.forEach((c, i) => rows[c] = { code: c, drawPos: i, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 });
  const played = [];
  for (const m of groupMatchesOf(g)) {
    const r = getR(m.match);
    if (!r || r.h == null || r.a == null) continue;
    played.push({ ...m, r });
    const H = rows[m.home], A = rows[m.away];
    H.P++; A.P++; H.GF += r.h; H.GA += r.a; A.GF += r.a; A.GA += r.h;
    if (r.h > r.a) { H.W++; A.L++; H.Pts += 3; }
    else if (r.h < r.a) { A.W++; H.L++; A.Pts += 3; }
    else { H.D++; A.D++; H.Pts++; A.Pts++; }
  }
  Object.values(rows).forEach(t => t.GD = t.GF - t.GA);

  // FIFA tiebreakers: Pts, GD, GF, then head-to-head among tied, then draw position
  let arr = Object.values(rows).sort((a, b) =>
    b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.drawPos - b.drawPos);
  // refine fully-tied clusters with head-to-head
  for (let i = 0; i < arr.length;) {
    let j = i + 1;
    while (j < arr.length && arr[j].Pts === arr[i].Pts && arr[j].GD === arr[i].GD && arr[j].GF === arr[i].GF) j++;
    if (j - i > 1) {
      const sub = new Set(arr.slice(i, j).map(t => t.code));
      const mini = {};
      sub.forEach(c => mini[c] = { Pts: 0, GD: 0, GF: 0 });
      for (const pm of played) {
        if (!sub.has(pm.home) || !sub.has(pm.away)) continue;
        mini[pm.home].GD += pm.r.h - pm.r.a; mini[pm.away].GD += pm.r.a - pm.r.h;
        mini[pm.home].GF += pm.r.h; mini[pm.away].GF += pm.r.a;
        if (pm.r.h > pm.r.a) mini[pm.home].Pts += 3;
        else if (pm.r.h < pm.r.a) mini[pm.away].Pts += 3;
        else { mini[pm.home].Pts++; mini[pm.away].Pts++; }
      }
      const slice = arr.slice(i, j).sort((a, b) =>
        mini[b.code].Pts - mini[a.code].Pts || mini[b.code].GD - mini[a.code].GD ||
        mini[b.code].GF - mini[a.code].GF || a.drawPos - b.drawPos);
      arr.splice(i, j - i, ...slice);
    }
    i = j;
  }
  const complete = played.length === 6;
  return { rows: arr, complete };
}

/* best third-placed teams across all groups */
function thirdsRanking(getR) {
  const list = [];
  for (const g of Object.keys(App.teams.groups)) {
    const t = groupTable(g, getR);
    if (t.complete) list.push({ ...t.rows[2], group: g });
  }
  list.sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.group.localeCompare(b.group));
  return { list, allComplete: list.length === 12 };
}

/* assign 8 qualified thirds to the R32 third-slots honoring allowed-group constraints */
function allocateThirds(qualified, slots) {
  const assign = {};
  const used = new Set();
  function bt(i) {
    if (i === slots.length) return true;
    const slot = slots[i];
    for (const t of qualified) {
      if (used.has(t.group) || !slot.away.groups.includes(t.group)) continue;
      used.add(t.group); assign[slot.match] = t.code;
      if (bt(i + 1)) return true;
      used.delete(t.group); delete assign[slot.match];
    }
    return false;
  }
  if (bt(0)) return assign;
  // fallback: ignore constraints (data mismatch safety net)
  const a2 = {}; qualified.slice(0, slots.length).forEach((t, i) => a2[slots[i].match] = t.code);
  return a2;
}

/* ───────────────────────── bracket resolution ───────────────────────── */
function allKnockoutMatches() {
  const k = App.schedule.knockout;
  return [...k.R32, ...k.R16, ...k.QF, ...k.SF, k.THIRD, k.FINAL];
}
function resolveBracket(getR) {
  const out = {}; // matchNum -> {home:{code?|label}, away:{...}, winner, loser}
  const thirds = thirdsRanking(getR);
  const slots = App.schedule.knockout.R32.filter(m =>
    (m.home && m.home.type === "third") || (m.away && m.away.type === "third"));
  let thirdAssign = {};
  if (thirds.allComplete) thirdAssign = allocateThirds(thirds.list.slice(0, 8), slots.map(s => ({
    match: s.match, away: s.home.type === "third" ? s.home : s.away
  })));

  const groupCache = {};
  const gt = g => groupCache[g] || (groupCache[g] = groupTable(g, getR));

  function resolveSide(spec, matchNum) {
    if (spec.type === "winner" || spec.type === "runnerup") {
      const t = gt(spec.group);
      if (t.complete) return { code: t.rows[spec.type === "winner" ? 0 : 1].code };
      return { label: (spec.type === "winner" ? "1st" : "2nd") + " Group " + spec.group };
    }
    if (spec.type === "third") {
      if (thirds.allComplete && thirdAssign[matchNum]) return { code: thirdAssign[matchNum] };
      return { label: "3rd " + spec.groups.join("/") };
    }
    if (spec.type === "matchWinner" || spec.type === "matchLoser") {
      const src = out[spec.match];
      const code = src && (spec.type === "matchWinner" ? src.winner : src.loser);
      if (code) return { code };
      return { label: (spec.type === "matchWinner" ? "Winner" : "Loser") + " M" + spec.match };
    }
    return { label: "?" };
  }

  for (const m of allKnockoutMatches()) {
    const home = resolveSide(m.home, m.match);
    const away = resolveSide(m.away, m.match);
    let winner = null, r = null;
    if (home.code && away.code) {
      r = getR(m.match);
      if (r) {
        if (r.winner && (r.winner === home.code || r.winner === away.code) && !r.live) winner = r.winner;
        else if (r.h != null && r.a != null && !r.live) {
          if (r.h > r.a) winner = home.code;
          else if (r.h < r.a) winner = away.code;
          else if (r.winner === home.code || r.winner === away.code) winner = r.winner; // pens
        }
      }
    }
    out[m.match] = { home, away, winner, loser: winner ? (winner === home.code ? away.code : home.code) : null, r };
  }
  return { out, thirds, thirdAssign };
}

/* ───────────────────────── helpers ───────────────────────── */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function team(code) { return App.teams.teams[code]; }
function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] + " " + day;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.add("hidden"), 3200);
}
function chipFor(source) {
  if (source === "real") return '<span class="chip real">FT ✓</span>';
  if (source === "live") return '<span class="chip live">● LIVE</span>';
  if (source === "whatif") return '<span class="chip whatif">what-if ✏️</span>';
  if (source === "pick") return '<span class="chip pick">your pick</span>';
  return "";
}

/* ───────────────────────── groups view ───────────────────────── */
function renderGroups() {
  const el = $("#view-groups");
  if (!App.teams) return;
  const thirds = thirdsRanking(effResult);
  let html = `<div class="sim-bar">
    <button class="sim-btn" data-act="sim-all-groups">🎲 SIM ALL GROUPS</button>
    <button class="sim-btn gold" data-act="sim-tournament">🎲🏆 SIM WHOLE TOURNAMENT</button>
  </div><div class="groups-grid">`;

  // third-place race card
  html += '<div class="group-card thirds-card"><h2>🥉 BEST 3rd PLACE RACE <span class="gname">(top 8 go through!)</span></h2><div class="thirds-strip">';
  if (thirds.list.length === 0) html += '<span style="padding:6px;color:#88a18a">Finish some groups to see the race…</span>';
  thirds.list.forEach((t, i) => {
    const tm = team(t.code);
    html += `<span class="third-chip ${i < 8 ? "in" : ""}" data-team="${t.code}">
      <span class="rankno">${i + 1}</span> ${tm.flag} ${esc(tm.name)} <small>${t.Pts}pts</small></span>`;
  });
  html += "</div></div>";

  for (const g of Object.keys(App.teams.groups)) {
    const t = groupTable(g, effResult);
    html += `<div class="group-card"><h2>GROUP <span class="gname">${g}</span>
      <button class="mini-btn h2-sim" data-act="sim-group" data-group="${g}" title="Simulate the rest of this group!">🎲</button></h2>`;
    html += '<table class="standings"><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>';
    t.rows.forEach((row, i) => {
      const tm = team(row.code);
      const cls = i < 2 ? "q1" : (i === 2 ? "q3" : "");
      html += `<tr class="${cls}"><td class="teamcell" data-team="${row.code}">${tm.flag} ${esc(tm.name)}</td>
        <td>${row.P}</td><td>${row.W}</td><td>${row.D}</td><td>${row.L}</td><td>${row.GD}</td><td class="pts">${row.Pts}</td></tr>`;
    });
    html += "</table>";

    html += '<div class="match-list">';
    for (const m of groupMatchesOf(g).sort((a, b) => a.match - b.match)) {
      const r = effResult(m.match);
      const k = "m" + m.match;
      const locked = App.state.real[k] && !App.state.overrides[k];
      const H = team(m.home), A = team(m.away);
      const hVal = r && r.h != null ? r.h : "–";
      const aVal = r && r.a != null ? r.a : "–";
      html += `<div class="match-row" data-match="${m.match}">
        <span class="side"><span class="flag" data-team="${m.home}">${H.flag}</span><span class="tname" data-team="${m.home}">${esc(H.name)}</span></span>
        <span class="scorebox">`;
      if (locked) {
        html += `<span class="score-num">${hVal}</span><span class="score-num">${aVal}</span>`;
      } else {
        html += `<button class="stepper minus" data-act="dec" data-side="h">−</button>
          <span class="score-num ${r && r.h != null ? "" : "empty"}">${hVal}</span>
          <button class="stepper" data-act="inc" data-side="h">+</button>
          <button class="stepper minus" data-act="dec" data-side="a">−</button>
          <span class="score-num ${r && r.a != null ? "" : "empty"}">${aVal}</span>
          <button class="stepper" data-act="inc" data-side="a">+</button>`;
      }
      html += `</span>
        <span class="side away"><span class="tname" data-team="${m.away}">${esc(A.name)}</span><span class="flag" data-team="${m.away}">${A.flag}</span></span>
        <span class="match-extra">${r ? chipFor(r.source) : ""}`;
      if (locked) html += `<button class="mini-btn" data-act="whatif" title="Play what-if with this real result">✏️</button>`;
      else if (App.state.real[k]) html += `<button class="mini-btn" data-act="restore" title="Back to the real score">↩️</button>`;
      if (!locked && r && r.source !== "real") html += `<button class="mini-btn" data-act="clear" title="Clear">✖️</button>`;
      html += `</span><span class="match-date">${fmtDate(m.date)} · ${esc(m.venue || "")}</span></div>`;
    }
    html += "</div></div>";
  }
  html += "</div>";
  el.innerHTML = html;
}

/* group score editing */
function bumpScore(matchNum, side, delta) {
  const k = "m" + matchNum;
  if (App.state.real[k] && !App.state.overrides[k]) return; // locked
  let s = App.state.scenario[k];
  if (!s) {
    const seed = App.state.real[k];
    s = App.state.scenario[k] = { h: seed ? seed.h : null, a: seed ? seed.a : null };
  }
  if (delta > 0) s[side] = s[side] == null ? 1 : Math.min(15, s[side] + 1);
  else s[side] = s[side] == null ? 0 : Math.max(0, s[side] - 1);
  const other = side === "h" ? "a" : "h";
  if (s[other] == null) s[other] = 0;
  save(); renderAll();
}

/* ───────────────────────── bracket view ───────────────────────── */
function koMatchHtml(m, res, label) {
  const d = res.out[m.match];
  const r = d.r;
  const score = side => {
    if (!r || r.h == null || r.a == null) return "";
    return `<span class="koscore">${side === "h" ? r.h : r.a}${r.pens ? (side === "h" ? " (" + r.pens[0] + ")" : " (" + r.pens[1] + ")") : ""}</span>`;
  };
  const k = "m" + m.match;
  const locked = App.state.real[k] && !App.state.overrides[k];
  const canPens = d.home.code && d.away.code && !d.winner && !locked;
  const sideHtml = (s, sc) => {
    if (!s.code) return `<div class="ko-team tbd">⏳ ${esc(s.label)}</div>`;
    const tm = team(s.code);
    const isW = d.winner === s.code;
    const isL = d.winner && d.winner !== s.code;
    return `<div class="ko-team ${isW ? "winner" : ""} ${isL ? "eliminated" : ""}" data-pick="${s.code}" data-match="${m.match}">
      <span class="flag" data-team="${s.code}">${tm.flag}</span>
      <span class="kname">${esc(tm.name)}</span>${sc}</div>`;
  };
  const src = r ? r.source : null;
  return `<div class="ko-match">
    <div class="ko-meta"><span>M${m.match} · ${fmtDate(m.date)}</span>
      <span class="ko-badges">${r ? chipFor(src) : esc((m.venue || "").split(",")[1] || m.venue || "")}${canPens ? `<button class="mini-btn" data-act="pens" data-match="${m.match}" title="Settle it on penalties!">🥅</button>` : ""}${locked ? `<button class="mini-btn" data-act="whatif" data-match="${m.match}">✏️</button>` :
      (App.state.real[k] ? `<button class="mini-btn" data-act="restore" data-match="${m.match}">↩️</button>` : "")}</span></div>
    ${sideHtml(d.home, score("h"))}
    ${sideHtml(d.away, score("a"))}
  </div>`;
}
function renderBracket() {
  const el = $("#view-bracket");
  if (!App.teams) return;
  const res = resolveBracket(effResult);
  const k = App.schedule.knockout;
  const col = (title, matches, cls) => `<div class="round-col ${cls || ""}"><h3>${title}</h3>
    <div class="round-matches">${matches.map(m => koMatchHtml(m, res)).join("")}</div></div>`;
  el.innerHTML = `<div class="sim-bar">
    <button class="sim-btn" data-act="sim-bracket">🎲 SIM REST OF BRACKET</button>
  </div><div class="bracket-scroll"><div class="bracket">
    ${col("ROUND OF 32", k.R32)}
    ${col("ROUND OF 16", k.R16)}
    ${col("QUARTERS", k.QF)}
    ${col("SEMIS", k.SF)}
    ${col("🏆 FINAL", [k.FINAL], "final-col")}
    ${col("🥉 3rd PLACE", [k.THIRD])}
  </div></div>
  <p style="color:#fff;text-align:center;margin-top:8px">👆 Tap a team to send them through! Tap the winner again to un-pick.</p>`;
}
function pickWinner(matchNum, code) {
  const k = "m" + matchNum;
  if (App.state.real[k] && !App.state.overrides[k]) { toast("That one really happened! Tap ✏️ to play what-if."); return; }
  const cur = App.state.scenario[k];
  if (cur && cur.winner === code) delete App.state.scenario[k];
  else App.state.scenario[k] = { winner: code };
  save(); renderAll();
}

/* ───────────────────────── teams view ───────────────────────── */
function teamPower(code) {
  const sq = App.squads[code];
  if (!sq || !sq.length) return null;
  const best = sq.map(p => p.rating).sort((a, b) => b - a).slice(0, 11);
  return Math.round(best.reduce((s, r) => s + r, 0) / best.length);
}
function renderTeams() {
  const el = $("#view-teams");
  if (!App.teams) return;
  let html = '<div class="group-card battle-card"><h2>⚔️ TEAM BATTLE</h2><div id="battle-zone"></div></div>';
  html += '<div class="teams-grid">';
  for (const g of Object.keys(App.teams.groups)) {
    html += `<div class="teams-group"><h3>Group ${g}</h3>`;
    for (const c of App.teams.groups[g]) {
      const tm = team(c), pw = teamPower(c);
      html += `<button class="team-pill" data-team="${c}"><span class="flag">${tm.flag}</span> ${esc(tm.name)}
        ${pw ? `<span class="power">${pw}</span>` : ""}<span class="rank">FIFA #${tm.fifaRank ?? "?"}</span></button>`;
    }
    html += "</div>";
  }
  el.innerHTML = html + "</div>";
  renderBattle();
}

/* ───────────────────────── player cards ───────────────────────── */
function seededRand(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const STAT_PROFILES = {
  GK: { labels: ["DIV", "HAN", "KIC", "REF", "SPD", "POS"], off: [2, 1, -2, 3, -8, 1] },
  DF: { labels: ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"], off: [0, -18, -4, -6, 4, 3] },
  MF: { labels: ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"], off: [0, -3, 4, 2, -8, -2] },
  FW: { labels: ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"], off: [3, 4, -3, 2, -24, 0] },
};
function playerCard(p, teamCode) {
  const prof = STAT_PROFILES[p.pos] || STAT_PROFILES.MF;
  const rnd = seededRand(p.name + p.pos);
  const tier = p.rating >= 83 ? "" : p.rating >= 75 ? "silver" : "bronze";
  const stats = prof.labels.map((lb, i) => {
    const v = Math.max(30, Math.min(99, Math.round(p.rating + prof.off[i] + (rnd() * 10 - 5))));
    return `<span class="stat"><b>${lb}</b><span class="bar"><i style="width:${v}%"></i></span>${v}</span>`;
  }).join("");
  return `<div class="pcard ${tier}" data-player="${esc(p.name)}" data-pteam="${teamCode}" title="Tap for ${esc(p.name)}'s full profile!">
    <div class="top"><span class="ovr">${p.rating}</span><span class="pos">${p.pos}</span><span class="num">#${p.num ?? ""}</span></div>
    <div class="photo-wrap"><img class="pphoto" data-photo="${esc(p.name)}" alt="" loading="lazy"
      src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Ccircle cx='40' cy='30' r='14' fill='%23ffffff66'/%3E%3Cellipse cx='40' cy='66' rx='24' ry='16' fill='%23ffffff66'/%3E%3C/svg%3E"></div>
    <div class="pname">${esc(p.name)}</div>
    <div class="pclub">${esc(p.club || "")}</div>
    <div class="stats">${stats}</div>
    <div class="meta"><span>Age ${p.age ?? "?"}</span><span>${p.caps ?? 0} cap${p.caps === 1 ? "" : "s"} · ${p.goals ?? 0} goal${p.goals === 1 ? "" : "s"}</span></div>
  </div>`;
}
function openTeamModal(code) {
  const tm = team(code);
  if (!tm) return;
  const sq = App.squads[code] || [];
  const grp = Object.keys(App.teams.groups).find(g => App.teams.groups[g].includes(code));
  const pw = teamPower(code);
  let body = "";
  if (!sq.length) body = '<p style="padding:24px">⏳ Squad data is still warming up on the team bus…</p>';
  else {
    for (const pos of ["GK", "DF", "MF", "FW"]) {
      const ps = sq.filter(p => p.pos === pos).sort((a, b) => b.rating - a.rating);
      if (!ps.length) continue;
      const title = { GK: "🧤 Goalkeepers", DF: "🛡️ Defenders", MF: "🎯 Midfielders", FW: "🚀 Forwards" }[pos];
      body += `<div class="tm-section-title">${title}</div><div class="cards-grid">${ps.map(p => playerCard(p, code)).join("")}</div>`;
    }
  }
  $("#team-modal").innerHTML = `
    <div class="tm-head"><span class="flag">${tm.flag}</span>
      <div><h2>${esc(tm.name)}</h2><div class="tm-sub">Group ${grp} · FIFA Rank #${tm.fifaRank ?? "?"} · ${sq.length} players</div></div>
      ${pw ? `<div class="tm-power"><div class="pw">${pw}</div><div class="pwl">Team Power</div></div>` : ""}
      <button class="tm-close" data-act="close-modal">✕</button></div>
    ${body}`;
  $("#modal-backdrop").classList.remove("hidden");
  if (sq.length) loadTeamPhotos(sq.map(p => p.name));
}

/* ───────────────────────── champion view ───────────────────────── */
function renderChampion() {
  const el = $("#view-champion");
  if (!App.teams) return;
  const res = resolveBracket(effResult);
  const fin = res.out[App.schedule.knockout.FINAL.match];
  const thr = res.out[App.schedule.knockout.THIRD.match];
  if (fin && fin.winner) {
    const W = team(fin.winner), RU = team(fin.loser);
    const TH = thr && thr.winner ? team(thr.winner) : null;
    el.innerHTML = `<div class="champ-wrap">
      <span class="big-trophy">🏆</span>
      <div class="champ-name">${W.flag} ${esc(W.name).toUpperCase()}</div>
      <div class="champ-sub">are your 2026 WORLD CHAMPIONS! 🎉⚽🎉</div>
      <div class="podium">
        <div class="step s2"><span class="medal">🥈</span><span class="flag">${RU ? RU.flag : "❔"}</span>${RU ? esc(RU.name) : "TBD"}</div>
        <div class="step s1"><span class="medal">🥇</span><span class="flag">${W.flag}</span>${esc(W.name)}</div>
        <div class="step s3"><span class="medal">🥉</span><span class="flag">${TH ? TH.flag : "❔"}</span>${TH ? esc(TH.name) : "TBD"}</div>
      </div></div>`;
    if (App.lastChampion !== fin.winner) { App.lastChampion = fin.winner; confetti(); sfx("roar"); sfx("goal"); }
  } else {
    let decided = 0;
    for (let i = 1; i <= 104; i++) { const r = effResult(i); if (r && (r.winner || (r.h != null && r.a != null)) && !r.live) decided++; }
    el.innerHTML = `<div class="champ-wrap"><span class="big-trophy" style="filter:grayscale(.8)">🏆</span>
      <div class="champ-empty"><b>No champion yet!</b><br>
      ${decided} of 104 matches decided so far. Fill in group scores and tap bracket winners
      until one team lifts the trophy — then come back here for the party! 🎊</div></div>`;
    App.lastChampion = null;
  }
}
function confetti() {
  const layer = $("#confetti-layer");
  const colors = ["#ffc83d", "#ff5252", "#1877d2", "#46c258", "#ff8fd0", "#fff"];
  for (let i = 0; i < 140; i++) {
    const c = document.createElement("div");
    c.className = "confetto";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.2 + Math.random() * 2.5 + "s";
    c.style.animationDelay = Math.random() * 0.8 + "s";
    layer.appendChild(c);
    setTimeout(() => c.remove(), 6000);
  }
}

/* ───────────────────────── settings ───────────────────────── */
function renderSettings() {
  document.querySelectorAll('input[name="updateMode"]').forEach(r => r.checked = r.value === App.state.settings.mode);
  $("#api-key").value = App.state.settings.apiKey || "";
  const st = $("#sound-toggle");
  if (st) st.checked = App.state.settings.sound !== false;
  renderSlots();
  applyModeUI();
}
function applyModeUI() {
  const mode = App.state.settings.mode;
  $("#sync-btn").classList.toggle("hidden", mode === "off");
  $("#live-badge").classList.toggle("hidden", mode !== "live");
  $("#last-sync").textContent = App.state.lastSync ? "last sync " + new Date(App.state.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

/* ───────────────────────── sync ───────────────────────── */
function normName(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
function buildNameIndex() {
  const idx = {};
  for (const c of Object.keys(App.teams.teams)) {
    const t = App.teams.teams[c];
    [t.name, c, ...(t.altNames || [])].forEach(n => idx[normName(n)] = c);
  }
  return idx;
}
function dateClose(a, b) {
  if (!a || !b) return false;
  return Math.abs(new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) <= 36 * 3600 * 1000;
}
/* ESPN public scoreboard, fetched straight from the browser (CORS-open).
   Used on static hosting (GitHub Pages) and as the default everywhere. */
const ESPN_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=400&dates=20260610-20260720";
async function fetchScoresESPN() {
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
    const m = {
      date: new Date(ev.date).toISOString().slice(0, 10),
      t: ev.date,
      detail: (ev.status && ev.status.type && (ev.status.displayClock && state === "in" ? ev.status.displayClock : ev.status.type.shortDetail)) || "",
      home: home.team.displayName, away: away.team.displayName,
      hs: home.score != null ? parseInt(home.score, 10) : null,
      as: away.score != null ? parseInt(away.score, 10) : null,
      status: state === "post" ? "FT" : state === "in" ? "LIVE" : "SCHED",
      penH: null, penA: null,
    };
    if (home.shootoutScore != null && away.shootoutScore != null) {
      m.penH = parseInt(home.shootoutScore, 10); m.penA = parseInt(away.shootoutScore, 10);
    }
    out.push(m);
  }
  return out;
}
async function fetchScores() {
  const key = (App.state.settings.apiKey || "").trim();
  if (key) {
    // football-data.org blocks browser CORS, so the key path needs the local server proxy
    try {
      const r = await fetch("/api/scores?source=fdo&key=" + encodeURIComponent(key));
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      return d.matches;
    } catch (e) {
      toast("🔑 API-key source needs the local server — using the free feed instead.");
    }
  }
  return fetchScoresESPN();
}
function applyFeed(matches, manual) {
  const idx = buildNameIndex();
  const realRes = resolveBracket(realResult);
  let applied = 0, newlyFinal = 0;
  for (const fm of matches || []) {
    if (fm.status !== "FT" && fm.status !== "LIVE") continue;
    if (fm.hs == null || fm.as == null) continue;
    const hc = idx[normName(fm.home)], ac = idx[normName(fm.away)];
    if (!hc || !ac) continue;
    // group-stage match?
    let m = App.schedule.groupMatches.find(m2 =>
      ((m2.home === hc && m2.away === ac) || (m2.home === ac && m2.away === hc)) && dateClose(m2.date, fm.date));
    if (m) {
      const k = "m" + m.match;
      const flip = m.home !== hc;
      const rec = { h: flip ? fm.as : fm.hs, a: flip ? fm.hs : fm.as, live: fm.status === "LIVE" };
      const wasFinal = App.state.real[k] && !App.state.real[k].live;
      if (!wasFinal && !rec.live) { recordPrediction(m.match, rec, true); newlyFinal++; }
      App.state.real[k] = rec;
      applied++; continue;
    }
    // knockout match? match by resolved real participants
    const ko = allKnockoutMatches().find(km => {
      const d = realRes.out[km.match];
      return d && d.home.code && d.away.code && dateClose(km.date, fm.date) &&
        ((d.home.code === hc && d.away.code === ac) || (d.home.code === ac && d.away.code === hc));
    });
    if (ko) {
      const k = "m" + ko.match;
      const d = realRes.out[ko.match];
      const flip = d.home.code !== hc;
      const rec = { h: flip ? fm.as : fm.hs, a: flip ? fm.hs : fm.as, live: fm.status === "LIVE" };
      if (fm.penH != null && fm.penA != null) {
        rec.pens = flip ? [fm.penA, fm.penH] : [fm.penH, fm.penA];
        rec.winner = (flip ? fm.penA > fm.penH : fm.penH > fm.penA) ? d.home.code : d.away.code;
      } else if (rec.h !== rec.a) rec.winner = rec.h > rec.a ? d.home.code : d.away.code;
      const wasFinal = App.state.real[k] && !App.state.real[k].live;
      if (!wasFinal && !rec.live) { recordPrediction(ko.match, rec, false); newlyFinal++; }
      App.state.real[k] = rec;
      applied++;
    }
  }
  App.state.lastSync = Date.now();
  save(); renderAll();
  if (newlyFinal) sfx("whistle");
  if (manual) toast(applied ? `🔄 Synced! ${applied} real result${applied > 1 ? "s" : ""} in the game.` : "🔄 Synced — no finished games yet. Kickoff coming soon!");
  return applied;
}
async function doSync(manual = true) {
  const btn = $("#sync-btn");
  if (manual) btn.classList.add("spinning");
  try {
    const matches = await fetchScores();
    App.feed = { matches, at: Date.now() };
    renderTodayStrip();
    if (!$("#view-live").classList.contains("hidden")) renderLive();
    applyFeed(matches, manual);
  } catch (e) {
    if (manual) toast("😬 Couldn't reach the scores feed: " + e.message);
  } finally {
    btn.classList.remove("spinning");
    $("#last-sync").textContent = App.state.lastSync ? "last sync " + new Date(App.state.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  }
}

/* ───────────────────────── stadium sounds ───────────────────────── */
let AC = null;
function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === "suspended") AC.resume();
  return AC;
}
function sfx(kind) {
  if (!App.state.settings.sound) return;
  try {
    const a = ac(), t = a.currentTime;
    const g = a.createGain(); g.connect(a.destination);
    if (kind === "tick") {
      const o = a.createOscillator(); o.type = "square"; o.frequency.value = 660;
      o.connect(g); g.gain.setValueAtTime(.08, t); g.gain.exponentialRampToValueAtTime(.001, t + .07);
      o.start(t); o.stop(t + .08);
    } else if (kind === "goal") {
      [220, 277, 330].forEach(f => {
        const o = a.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
        o.connect(g); o.start(t); o.stop(t + .7);
      });
      g.gain.setValueAtTime(.12, t); g.gain.linearRampToValueAtTime(.18, t + .15);
      g.gain.exponentialRampToValueAtTime(.001, t + .7);
    } else if (kind === "whistle") {
      const o = a.createOscillator(); o.type = "sine"; o.frequency.value = 2800;
      const v = a.createOscillator(); v.frequency.value = 30;
      const vg = a.createGain(); vg.gain.value = 300; v.connect(vg); vg.connect(o.frequency);
      o.connect(g); g.gain.setValueAtTime(.1, t); g.gain.setValueAtTime(.1, t + .18);
      g.gain.exponentialRampToValueAtTime(.001, t + .35);
      o.start(t); o.stop(t + .35); v.start(t); v.stop(t + .35);
    } else if (kind === "save") {
      const o = a.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(60, t + .2);
      o.connect(g); g.gain.setValueAtTime(.2, t); g.gain.exponentialRampToValueAtTime(.001, t + .25);
      o.start(t); o.stop(t + .25);
    } else if (kind === "roar") {
      const len = 2.5 * a.sampleRate, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(Math.sin(Math.PI * i / len), .6);
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 800; f.Q.value = .6;
      src.connect(f); f.connect(g); g.gain.value = .25; src.start(t);
    }
  } catch (e) { /* audio blocked — no big deal */ }
}

/* ───────────────────────── player photos (Wikipedia) ───────────────────────── */
const photoCache = (() => { try { return JSON.parse(localStorage.getItem("wc26-photos") || "{}"); } catch { return {}; } })();
function savePhotos() { try { localStorage.setItem("wc26-photos", JSON.stringify(photoCache)); } catch {} }
const WIKI = "https://en.wikipedia.org/w/api.php";

function applyPhotos(names) {
  document.querySelectorAll("img[data-photo]").forEach(img => {
    const u = photoCache[img.dataset.photo];
    if (u) { img.src = u; img.classList.add("loaded"); }
  });
}
async function wikiJSON(params) {
  const r = await fetch(WIKI + "?origin=*&format=json&" + params);
  if (!r.ok) throw new Error("wiki " + r.status);
  return r.json();
}
async function loadTeamPhotos(names) {
  const missing = names.filter(n => photoCache[n] === undefined);
  applyPhotos(names);
  if (!missing.length) return;
  // pass 1: batch lookup by exact name (follows redirects)
  for (let i = 0; i < missing.length; i += 25) {
    const chunk = missing.slice(i, i + 25);
    try {
      const j = await wikiJSON("action=query&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=240&titles=" +
        encodeURIComponent(chunk.join("|")));
      const back = {}; // resolved title -> original name
      chunk.forEach(n => back[n] = n);
      (j.query?.normalized || []).concat(j.query?.redirects || []).forEach(m => {
        const orig = Object.keys(back).find(k => back[k] === m.from || k === m.from);
        if (orig) back[m.to] = orig === m.from ? orig : back[m.from] || orig;
      });
      for (const pg of Object.values(j.query?.pages || {})) {
        const name = back[pg.title];
        if (name && pg.thumbnail) photoCache[name] = pg.thumbnail.source;
      }
    } catch (e) { /* offline — placeholders stay */ }
  }
  // pass 2: search fallback for the stragglers (common for "John Smith"-type names)
  const strag = missing.filter(n => photoCache[n] === undefined);
  for (let i = 0; i < strag.length; i += 5) {
    await Promise.all(strag.slice(i, i + 5).map(async n => {
      try {
        const s = await wikiJSON("action=query&list=search&srlimit=1&srsearch=" + encodeURIComponent(n + " footballer"));
        const title = s.query?.search?.[0]?.title;
        if (!title) { photoCache[n] = ""; return; }
        const j = await wikiJSON("action=query&prop=pageimages&piprop=thumbnail&pithumbsize=240&titles=" + encodeURIComponent(title));
        const pg = Object.values(j.query?.pages || {})[0];
        photoCache[n] = pg?.thumbnail?.source || "";
      } catch { photoCache[n] = undefined; }
    }));
  }
  savePhotos(); applyPhotos(names);
}

/* ───────────────────────── player profile modal ───────────────────────── */
const profileCache = (() => { try { return JSON.parse(localStorage.getItem("wc26-profiles") || "{}"); } catch { return {}; } })();
function saveProfiles() { try { localStorage.setItem("wc26-profiles", JSON.stringify(profileCache)); } catch {} }
function dewiki(s) {
  return String(s)
    .replace(/\{\{height\|m=([\d.]+)[^}]*\}\}/gi, "$1 m")
    .replace(/\{\{nowrap\|([^{}]*)\}\}/gi, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1")
    .replace(/&nbsp;|&thinsp;/g, " ").replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ").trim();
}
function parseInfobox(wt) {
  const out = { clubs: [], nat: [] };
  const h = wt.match(/\|\s*height\s*=([^\n]*)/i); if (h) out.height = dewiki(h[1]);
  const b = wt.match(/\{\{birth date(?: and age)?\s*(?:\|df=y(?:es)?)?\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i);
  if (b) out.born = `${b[1]}-${String(b[2]).padStart(2, "0")}-${String(b[3]).padStart(2, "0")}`;
  const fn = wt.match(/\|\s*full_?name\s*=([^\n]*)/i); if (fn) out.fullName = dewiki(fn[1]);
  const pos = wt.match(/\|\s*position\s*=([^\n]*)/i); if (pos) out.position = dewiki(pos[1]);
  const rows = { years: {}, clubs: {}, caps: {}, goals: {}, nationalyears: {}, nationalteam: {}, nationalcaps: {}, nationalgoals: {} };
  const rx = /\|\s*(years|clubs|caps|goals|nationalyears|nationalteam|nationalcaps|nationalgoals)(\d+)\s*=([^\n]*)/g;
  let m;
  while ((m = rx.exec(wt))) rows[m[1]][m[2]] = dewiki(m[3]);
  for (const i of Object.keys(rows.clubs)) {
    out.clubs.push({ years: rows.years[i] || "", team: rows.clubs[i], apps: rows.caps[i] ?? "", goals: rows.goals[i] ?? "" });
  }
  for (const i of Object.keys(rows.nationalteam)) {
    out.nat.push({ years: rows.nationalyears[i] || "", team: rows.nationalteam[i], apps: rows.nationalcaps[i] ?? "", goals: rows.nationalgoals[i] ?? "" });
  }
  return out;
}
async function fetchProfile(name) {
  if (profileCache[name]) return profileCache[name];
  let title = name;
  let j = await wikiJSON("action=query&redirects=1&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=480&titles=" + encodeURIComponent(title));
  let pg = Object.values(j.query?.pages || {})[0];
  const isFooty = p => p && !p.missing && /foot|soccer|goalkeeper|defender|midfielder|forward|winger|striker/i.test(p.extract || "");
  if (!isFooty(pg)) {
    const s = await wikiJSON("action=query&list=search&srlimit=1&srsearch=" + encodeURIComponent(name + " footballer"));
    title = s.query?.search?.[0]?.title;
    if (!title) throw new Error("no wiki page");
    j = await wikiJSON("action=query&redirects=1&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=480&titles=" + encodeURIComponent(title));
    pg = Object.values(j.query?.pages || {})[0];
    if (!pg || pg.missing) throw new Error("no wiki page");
  }
  title = pg.title;
  let info = {};
  try {
    const w = await wikiJSON("action=parse&prop=wikitext&section=0&page=" + encodeURIComponent(title));
    info = parseInfobox(w.parse?.wikitext?.["*"] || "");
  } catch {}
  const prof = {
    title,
    extract: (pg.extract || "").trim(),
    thumb: pg.thumbnail?.source || photoCache[name] || "",
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")),
    info,
  };
  profileCache[name] = prof; saveProfiles();
  return prof;
}
function careerTable(rows, label) {
  if (!rows || !rows.length) return "";
  return `<div class="tm-section-title">${label}</div>
    <table class="career"><tr><th>Years</th><th>Team</th><th>Apps</th><th>Goals</th></tr>
    ${rows.map(r => `<tr><td>${esc(r.years)}</td><td>${esc(r.team)}</td><td>${esc(r.apps)}</td><td>${esc(r.goals)}</td></tr>`).join("")}
    </table>`;
}
async function openPlayerProfile(name, teamCode) {
  const tm = team(teamCode);
  const p = (App.squads[teamCode] || []).find(x => x.name === name);
  if (!p) return;
  const yt = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(name + " " + q);
  const shell = body => `
    <div class="tm-head"><button class="btn-plain back" data-act="back-to-team" data-team="${teamCode}">← ${tm.flag}</button>
      <div><h2>${esc(name)}</h2><div class="tm-sub">${esc(tm.name)} · #${p.num ?? "?"} · ${p.pos}</div></div>
      <div class="tm-power"><div class="pw">${p.rating}</div><div class="pwl">Rating</div></div>
      <button class="tm-close" data-act="close-modal">✕</button></div>
    <div class="profile-body">${body}</div>`;
  $("#team-modal").innerHTML = shell('<p class="loading-line">⏳ Calling the press office…</p>');
  $("#modal-backdrop").classList.remove("hidden");
  let prof = null;
  try { prof = await fetchProfile(name); } catch {}
  const i = prof?.info || {};
  const vitals = [
    ["🎂 Born", i.born ? `${fmtDate(i.born)} ${i.born.slice(0, 4)} (age ${p.age ?? "?"})` : `Age ${p.age ?? "?"}`],
    ["📏 Height", i.height || "—"],
    ["🧭 Position", i.position || { GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" }[p.pos]],
    ["👕 Club", p.club || "—"],
    ["🌍 Caps · Goals", `${p.caps ?? 0} · ${p.goals ?? 0}`],
  ];
  const bio = prof?.extract
    ? `<div class="tm-section-title">📖 Story</div><p class="bio">${esc(prof.extract.split("\n").slice(0, 3).join(" "))}</p>`
    : `<p class="bio">Couldn't reach the biography right now — try again when you're online!</p>`;
  const body = `
    <div class="profile-top">
      <div class="profile-photo">${prof?.thumb ? `<img src="${prof.thumb}" alt="${esc(name)}">` : `<div class="no-photo">${tm.flag}</div>`}</div>
      <div class="vitals">${vitals.map(([k, v]) => `<div class="vit"><b>${k}</b><span>${esc(v)}</span></div>`).join("")}
        ${i.fullName && i.fullName !== name ? `<div class="vit"><b>✍️ Full name</b><span>${esc(i.fullName)}</span></div>` : ""}
      </div>
    </div>
    ${bio}
    ${careerTable(i.clubs, "🏟️ Clubs")}
    ${careerTable(i.nat, "🌍 National teams")}
    <div class="tm-section-title">🎬 Watch him play</div>
    <div class="yt-row">
      <a class="yt-btn" target="_blank" rel="noopener" href="${yt("highlights")}">▶️ Highlights</a>
      <a class="yt-btn" target="_blank" rel="noopener" href="${yt("goals skills")}">⚽ Goals & Skills</a>
      <a class="yt-btn" target="_blank" rel="noopener" href="${yt("world cup 2026")}">🏆 World Cup 2026</a>
      ${prof ? `<a class="yt-btn wiki" target="_blank" rel="noopener" href="${prof.url}">📚 Wikipedia</a>` : ""}
    </div>`;
  $("#team-modal").innerHTML = shell(body);
}

/* ───────────────────────── simulation ───────────────────────── */
function powerOf(code) { return teamPower(code) || 70; }
function poisson(lam) {
  let L = Math.exp(-lam), k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return Math.min(9, k - 1);
}
function simScore(hc, ock) {
  const hp = powerOf(hc), ap = powerOf(ock);
  return {
    h: poisson(Math.max(.15, 1.4 + (hp - ap) * .055)),
    a: poisson(Math.max(.15, 1.25 + (ap - hp) * .055)),
  };
}
function simPens(hc, ock) {
  const edge = .5 + (powerOf(hc) - powerOf(ock)) * .008;
  let h = 0, a = 0;
  for (let r = 0; r < 5 || h === a; r++) { if (Math.random() < .76) h++; if (Math.random() < (Math.random() < edge ? .72 : .8)) a++; if (r > 20) { h++; break; } }
  return h > a ? { pens: [Math.max(h, a + 1) > 5 ? h : h, a], winner: "h" } : { pens: [h, Math.max(a, h + 1)], winner: "a" };
}
function simGroupMatches(g, quiet) {
  let n = 0;
  for (const m of groupMatchesOf(g)) {
    if (effResult(m.match)) continue;
    App.state.scenario["m" + m.match] = simScore(m.home, m.away);
    n++;
  }
  if (!quiet) { save(); renderAll(); if (n) sfx("goal"); toast(n ? `🎲 Group ${g} simmed!` : `Group ${g} is already decided!`); }
  return n;
}
function simAllGroups(quiet) {
  let n = 0;
  for (const g of Object.keys(App.teams.groups)) n += simGroupMatches(g, true);
  if (!quiet) { save(); renderAll(); if (n) sfx("goal"); toast(n ? `🎲 ${n} group games simmed!` : "Groups are all done already!"); }
  return n;
}
function simKnockoutRest(quiet) {
  let n = 0, guard = 0;
  while (guard++ < 40) {
    const res = resolveBracket(effResult);
    const next = allKnockoutMatches().find(m => {
      const d = res.out[m.match], k = "m" + m.match;
      return d.home.code && d.away.code && !d.winner && !(App.state.real[k] && !App.state.overrides[k]);
    });
    if (!next) break;
    const d = resolveBracket(effResult).out[next.match];
    const s = simScore(d.home.code, d.away.code);
    const rec = { h: s.h, a: s.a };
    if (s.h === s.a) {
      const ps = simPens(d.home.code, d.away.code);
      rec.pens = ps.pens; rec.winner = ps.winner === "h" ? d.home.code : d.away.code;
    } else rec.winner = s.h > s.a ? d.home.code : d.away.code;
    App.state.scenario["m" + next.match] = rec;
    n++;
  }
  if (!quiet) { save(); renderAll(); if (n) sfx("goal"); toast(n ? `🎲 ${n} knockout games simmed!` : "Bracket needs group results first — or it's already done!"); }
  return n;
}
function simTournament() {
  const a = simAllGroups(true), b = simKnockoutRest(true);
  save(); renderAll(); sfx("goal");
  toast(a + b ? `🎲🏆 Simmed ${a + b} games — go meet your champion!` : "Everything is already decided!");
}

/* ───────────────────────── penalty shootout ───────────────────────── */
function openShootout(matchNum) {
  const d = resolveBracket(effResult).out[matchNum];
  if (!d.home.code || !d.away.code) return;
  const k = "m" + matchNum;
  if (App.state.real[k] && !App.state.overrides[k]) { toast("That one really happened! Tap ✏️ first."); return; }
  const cur = effResult(matchNum);
  App.shoot = {
    match: matchNum, codes: [d.home.code, d.away.code],
    base: cur && cur.h != null && cur.h === cur.a ? { h: cur.h, a: cur.a } : { h: 0, a: 0 },
    kicks: [[], []], turn: 0, done: false,
  };
  renderShootout();
  $("#modal-backdrop").classList.remove("hidden");
}
function shootoutWinner(s) {
  const sc = i => s.kicks[i].filter(Boolean).length;
  const left = i => Math.max(0, 5 - s.kicks[i].length);
  if (s.kicks[0].length <= 5 || s.kicks[1].length <= 5) {
    if (sc(0) > sc(1) + left(1)) return 0;
    if (sc(1) > sc(0) + left(0)) return 1;
    if (s.kicks[0].length >= 5 && s.kicks[1].length >= 5 && s.kicks[0].length === s.kicks[1].length && sc(0) !== sc(1)) return sc(0) > sc(1) ? 0 : 1;
  }
  if (s.kicks[0].length === s.kicks[1].length && s.kicks[0].length > 5 && sc(0) !== sc(1)) return sc(0) > sc(1) ? 0 : 1;
  return null;
}
function shootKick() {
  const s = App.shoot;
  if (!s || s.done) return;
  const me = s.codes[s.turn], other = s.codes[1 - s.turn];
  const pGoal = .74 + (powerOf(me) - powerOf(other)) * .004;
  const scored = Math.random() < pGoal;
  s.kicks[s.turn].push(scored);
  sfx(scored ? "goal" : "save");
  const w = shootoutWinner(s);
  if (w != null) {
    s.done = true; s.winnerIdx = w;
    const k = "m" + s.match;
    App.state.scenario[k] = {
      h: s.base.h, a: s.base.a,
      pens: [s.kicks[0].filter(Boolean).length, s.kicks[1].filter(Boolean).length],
      winner: s.codes[w],
    };
    save(); renderAll();
  } else s.turn = 1 - s.turn;
  renderShootout();
}
function renderShootout() {
  const s = App.shoot;
  if (!s) return;
  const row = i => {
    const tm = team(s.codes[i]);
    const balls = s.kicks[i].map(k => k ? "⚽" : "🧤").join(" ") || "—";
    const score = s.kicks[i].filter(Boolean).length;
    return `<div class="pk-row ${!s.done && s.turn === i ? "up" : ""}">
      <span class="flag">${tm.flag}</span><span class="kname">${esc(tm.name)}</span>
      <span class="pk-balls">${balls}</span><span class="pk-score">${score}</span></div>`;
  };
  const W = s.done ? team(s.codes[s.winnerIdx]) : null;
  $("#team-modal").innerHTML = `<div class="confirm-box pk-box">
    <h2>🥅 PENALTY SHOOTOUT!</h2>
    <p class="pk-sub">${s.base.h}-${s.base.a} after extra time — first to miss out is going home…</p>
    ${row(0)}${row(1)}
    ${s.done
      ? `<p class="pk-winner">${W.flag} <b>${esc(W.name)}</b> win the shootout! 🎉</p>
         <div class="row"><button class="btn-plain" data-act="close-modal">Back to the bracket</button></div>`
      : `<div class="row"><button class="wipe-btn pk-shoot" data-act="shoot">⚽ ${team(s.codes[s.turn]).flag} TAP TO SHOOT!</button></div>`}
  </div>`;
}

/* ───────────────────────── live feed & today ───────────────────────── */
App.feed = { matches: [], at: 0 };
function feedTeam(n) { const idx = buildNameIndex(); return idx[normName(n)]; }
async function pollFeed(applyToo) {
  try {
    App.feed = { matches: await fetchScoresESPN(), at: Date.now() };
  } catch { /* offline — keep old feed */ }
  renderTodayStrip();
  if (!$("#view-live").classList.contains("hidden")) renderLive();
  if (applyToo !== false && App.state.settings.mode === "live" && App.feed.matches.length) {
    applyFeed(App.feed.matches, false);
  }
}
function localDay(iso) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function kickTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function feedBuckets() {
  const today = localDay(new Date().toISOString());
  const live = [], upcoming = [], finished = [], future = [];
  for (const m of App.feed.matches) {
    const day = m.t ? localDay(m.t) : m.date;
    if (m.status === "LIVE") live.push(m);
    else if (day === today && m.status === "FT") finished.push(m);
    else if (day === today) upcoming.push(m);
    else if (m.status === "SCHED" && day > today) future.push(m);
  }
  upcoming.sort((a, b) => (a.t || "").localeCompare(b.t || ""));
  future.sort((a, b) => (a.t || "").localeCompare(b.t || ""));
  return { live, upcoming, finished, future };
}
function feedMatchHtml(m, big) {
  const hc = feedTeam(m.home), ock = feedTeam(m.away);
  const hf = hc ? team(hc).flag : "⚽", af = ock ? team(ock).flag : "⚽";
  const mid = m.status === "SCHED" ? `<span class="lv-time">${m.t ? kickTime(m.t) : ""}</span>`
    : `<span class="lv-score">${m.hs}–${m.as}${m.penH != null ? ` <small>(${m.penH}-${m.penA} pens)</small>` : ""}</span>`;
  const chip = m.status === "LIVE" ? `<span class="chip live">● ${esc(m.detail || "LIVE")}</span>`
    : m.status === "FT" ? '<span class="chip real">FT</span>' : "";
  return `<div class="lv-match ${big ? "big" : ""}">
    <span class="lv-side">${hf} ${esc(m.home)}</span>${mid}<span class="lv-side">${esc(m.away)} ${af}</span>${chip}</div>`;
}
function renderTodayStrip() {
  const el = $("#today-strip");
  const { live, upcoming, finished } = feedBuckets();
  const todays = [...live, ...upcoming, ...finished];
  if (!todays.length) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.innerHTML = `<span class="strip-label">${live.length ? "🔴 LIVE" : "📅 TODAY"}</span>` +
    todays.slice(0, 12).map(m => {
      const hc = feedTeam(m.home), ock = feedTeam(m.away);
      const mid = m.status === "SCHED" ? (m.t ? kickTime(m.t) : "") :
        `${m.hs}–${m.as}` + (m.status === "LIVE" ? ` <i>${esc(m.detail || "")}</i>` : "");
      return `<span class="strip-game ${m.status.toLowerCase()}">${hc ? team(hc).flag : ""} ${mid} ${ock ? team(ock).flag : ""}</span>`;
    }).join("");
}
function renderLive() {
  const el = $("#view-live");
  const { live, upcoming, finished, future } = feedBuckets();
  const section = (title, arr, big) => arr.length
    ? `<div class="lv-section"><h3>${title}</h3>${arr.map(m => feedMatchHtml(m, big)).join("")}</div>` : "";
  const nextDay = future.length ? localDay(future[0].t || future[0].date) : null;
  const tomorrow = nextDay ? future.filter(m => localDay(m.t || m.date) === nextDay) : [];
  el.innerHTML = `<div class="live-wrap">
    ${section("🔴 LIVE RIGHT NOW", live, true)}
    ${section("⏰ COMING UP TODAY", upcoming)}
    ${section("✅ FINISHED TODAY", finished)}
    ${!live.length && !upcoming.length && !finished.length
      ? `<div class="lv-section"><h3>😴 No games today</h3>${section("📅 NEXT UP — " + (nextDay ? fmtDate(nextDay) : ""), tomorrow) || "<p>Check back during the tournament!</p>"}</div>` : ""}
    <p class="lv-foot">Updates every minute · last checked ${App.feed.at ? new Date(App.feed.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</p>
  </div>`;
}

/* ───────────────────────── prediction scorecard ───────────────────────── */
function scorePrediction(pred, real, isGroup) {
  if (!pred) return null;
  if (isGroup && pred.h != null && pred.a != null) {
    if (pred.h === real.h && pred.a === real.a) return 3;
    const po = Math.sign(pred.h - pred.a), ro = Math.sign(real.h - real.a);
    return po === ro ? 1 : 0;
  }
  if (!isGroup && pred.winner) return pred.winner === real.winner ? 1 : 0;
  return null;
}
function recordPrediction(matchNum, rec, isGroup) {
  const k = "m" + matchNum;
  if (App.state.predLog[k]) return;
  const pred = App.state.scenario[k] || null;
  const pts = scorePrediction(pred, rec, isGroup);
  const rp = App.state.rival?.preds?.[k] || null;
  const rpts = rp ? scorePrediction(rp, rec, true) : null;
  if (pts == null && rpts == null) return;
  App.state.predLog[k] = { pred, pts: pts ?? 0, rivalPred: rp, rivalPts: rpts ?? (App.state.rival ? 0 : null), real: { h: rec.h, a: rec.a, winner: rec.winner || null }, at: Date.now() };
}
function renderScorecard() {
  const el = $("#view-scorecard");
  if (!App.teams) return;
  const log = Object.entries(App.state.predLog);
  const mine = log.reduce((s, [, e]) => s + (e.pts || 0), 0);
  const rivals = log.reduce((s, [, e]) => s + (e.rivalPts || 0), 0);
  const rival = App.state.rival;
  const matchByNum = {};
  App.schedule.groupMatches.forEach(m => matchByNum[m.match] = m);
  const upcoming = App.schedule.groupMatches
    .filter(m => !App.state.real["m" + m.match])
    .sort((a, b) => a.date.localeCompare(b.date) || a.match - b.match).slice(0, 12);

  let html = `<div class="sc-wrap"><div class="group-card sc-card"><h2>🏅 PREDICTION SCORECARD</h2>
    <div class="sc-board">
      <div class="sc-player me"><div class="sc-pts">${mine}</div><div class="sc-name">⭐ My points</div></div>
      ${rival ? `<div class="sc-vs">VS</div><div class="sc-player"><div class="sc-pts">${rivals}</div><div class="sc-name">🆚 ${esc(rival.name)}</div></div>` : ""}
    </div>
    <p class="sc-help">Your <b>group-stage scores</b> and <b>bracket picks</b> count as predictions. When the real result
    syncs in: <b>3 pts</b> exact score · <b>1 pt</b> right winner/draw · bracket pick right = <b>1 pt</b>.</p>
    ${rival ? "" : `<div style="padding:0 14px 14px"><button class="btn-plain" data-act="add-rival">🆚 Add a rival (Dad? Grandma?)</button></div>`}
  </div>`;

  if (rival) {
    html += `<div class="group-card sc-card"><h2>🆚 ${esc(rival.name).toUpperCase()}'S PICKS <span class="gname">(next games)</span></h2><div class="sc-rival-list">`;
    for (const m of upcoming) {
      const H = team(m.home), A = team(m.away);
      const rp = rival.preds["m" + m.match] || {};
      html += `<div class="sc-pred-row"><span>${H.flag} ${esc(H.name)} – ${esc(A.name)} ${A.flag}</span>
        <span class="sc-inputs"><input type="number" min="0" max="15" data-rp="h" data-match="${m.match}" value="${rp.h ?? ""}">
        : <input type="number" min="0" max="15" data-rp="a" data-match="${m.match}" value="${rp.a ?? ""}"></span>
        <span class="match-date">${fmtDate(m.date)}</span></div>`;
    }
    html += `</div></div>`;
  }

  html += `<div class="group-card sc-card"><h2>📜 HISTORY</h2>`;
  if (!log.length) html += `<p class="sc-help" style="padding:14px">No scored predictions yet — make your picks, then sync real results as games finish!</p>`;
  else {
    html += `<table class="standings"><tr><th>Match</th><th>My pick</th><th>Real</th><th>Pts</th>${rival ? "<th>" + esc(rival.name) + "</th>" : ""}</tr>`;
    for (const [k, e] of log.sort((a, b) => (b[1].at || 0) - (a[1].at || 0))) {
      const num = Number(k.slice(1));
      const gm = matchByNum[num];
      const label = gm ? `${team(gm.home).flag} v ${team(gm.away).flag}` : `KO M${num}`;
      const predTxt = e.pred ? (e.pred.h != null ? `${e.pred.h}–${e.pred.a}` : (e.pred.winner ? team(e.pred.winner).flag + " wins" : "—")) : "—";
      const realTxt = e.real.h != null ? `${e.real.h}–${e.real.a}` : (e.real.winner ? team(e.real.winner).flag + " won" : "—");
      const medal = e.pts === 3 ? "🎯 3" : e.pts === 1 ? "✅ 1" : "❌ 0";
      html += `<tr><td class="teamcell">${label}</td><td>${predTxt}</td><td>${realTxt}</td><td>${medal}</td>${rival ? `<td>${e.rivalPts ?? 0}</td>` : ""}</tr>`;
    }
    html += "</table>";
  }
  html += "</div></div>";
  el.innerHTML = html;
}

/* ───────────────────────── scenario slots ───────────────────────── */
function renderSlots() {
  const el = $("#slots-ui");
  if (!el) return;
  const names = Object.keys(App.state.slots);
  el.innerHTML = `
    <div class="slot-new"><input type="text" id="slot-name" placeholder="Scenario name, e.g. MEXICO WINS IT ALL" maxlength="30">
      <button class="btn-plain" data-act="slot-save">💾 Save current</button></div>
    ${names.map(n => `<div class="slot-row"><b>${esc(n)}</b>
      <small>${new Date(App.state.slots[n].savedAt).toLocaleDateString()}</small>
      <button class="btn-plain" data-act="slot-load" data-name="${esc(n)}">▶️ Load</button>
      <button class="mini-btn" data-act="slot-del" data-name="${esc(n)}" title="Delete">🗑️</button></div>`).join("") ||
    '<p class="setting-help">No saved scenarios yet.</p>'}`;
}
function slotSave() {
  const name = ($("#slot-name").value || "").trim() || "Scenario " + (Object.keys(App.state.slots).length + 1);
  App.state.slots[name] = {
    scenario: JSON.parse(JSON.stringify(App.state.scenario)),
    overrides: JSON.parse(JSON.stringify(App.state.overrides)),
    savedAt: Date.now(),
  };
  save(); renderSlots(); toast(`💾 Saved "${name}"!`);
}
function slotLoad(name) {
  const s = App.state.slots[name];
  if (!s) return;
  App.state.scenario = JSON.parse(JSON.stringify(s.scenario));
  App.state.overrides = JSON.parse(JSON.stringify(s.overrides));
  save(); renderAll(); toast(`▶️ Loaded "${name}" — welcome to that universe!`);
}
function slotDelete(name) { delete App.state.slots[name]; save(); renderSlots(); }

/* ───────────────────────── team battle ───────────────────────── */
App.battle = { a: null, b: null };
function battleSelectHtml(side) {
  const opts = Object.keys(App.teams.groups).map(g =>
    `<optgroup label="Group ${g}">` + App.teams.groups[g].map(c =>
      `<option value="${c}" ${App.battle[side] === c ? "selected" : ""}>${team(c).flag} ${esc(team(c).name)}</option>`).join("") + "</optgroup>").join("");
  return `<select class="battle-sel" data-side="${side}"><option value="">Pick a team…</option>${opts}</select>`;
}
function lineAvg(code, pos) {
  const ps = (App.squads[code] || []).filter(p => p.pos === pos);
  return ps.length ? Math.round(ps.reduce((s, p) => s + p.rating, 0) / ps.length) : 0;
}
function renderBattle() {
  const el = $("#battle-zone");
  if (!el) return;
  const { a, b } = App.battle;
  let body = "";
  if (a && b) {
    const lines = [["🧤 Goalkeeping", "GK"], ["🛡️ Defense", "DF"], ["🎯 Midfield", "MF"], ["🚀 Attack", "FW"]];
    const pa = teamPower(a) || 0, pb = teamPower(b) || 0;
    body = `<div class="battle-grid">
      <div class="battle-team">${team(a).flag}<b>${esc(team(a).name)}</b><span class="power">${pa}</span></div>
      <div class="battle-mid">TEAM POWER</div>
      <div class="battle-team">${team(b).flag}<b>${esc(team(b).name)}</b><span class="power">${pb}</span></div>
      ${lines.map(([lb, pos]) => {
        const va = lineAvg(a, pos), vb = lineAvg(b, pos);
        return `<div class="bv ${va >= vb ? "win" : ""}">${va}</div><div class="battle-mid">${lb}</div><div class="bv ${vb >= va ? "win" : ""}">${vb}</div>`;
      }).join("")}
    </div>
    <div class="battle-stars">
      <div>${(App.squads[a] || []).slice().sort((x, y) => y.rating - x.rating).slice(0, 5).map(p => `<div class="star-row"><b>${p.rating}</b> ${esc(p.name)}</div>`).join("")}</div>
      <div>${(App.squads[b] || []).slice().sort((x, y) => y.rating - x.rating).slice(0, 5).map(p => `<div class="star-row"><b>${p.rating}</b> ${esc(p.name)}</div>`).join("")}</div>
    </div>
    <p class="battle-verdict">${pa === pb ? "⚖️ Dead even — flip a coin!" : `🔮 On paper: <b>${esc(team(pa > pb ? a : b).name)}</b> by a nose!`}</p>`;
  } else body = `<p class="setting-help" style="text-align:center">Pick two teams and settle the argument! ⚔️</p>`;
  el.innerHTML = `<div class="battle-bar">${battleSelectHtml("a")}<span class="battle-vs">⚔️</span>${battleSelectHtml("b")}</div>${body}`;
}

/* ───────────────────────── wipe ───────────────────────── */
function confirmWipe() {
  const back = $("#modal-backdrop");
  $("#team-modal").innerHTML = `<div class="confirm-box">
    <h2>🧹 WIPE ALL SCORES?</h2>
    <p>This clears <b>every score</b> — your picks <i>and</i> the real results.<br>
    Real results come back next time you Sync (or automatically with Live updates on).</p>
    <div class="row"><button class="wipe-btn" data-act="do-wipe">YES, WIPE IT!</button>
    <button class="btn-plain" data-act="close-modal">No, keep playing</button></div></div>`;
  back.classList.remove("hidden");
}
function doWipe() {
  App.state.scenario = {}; App.state.real = {}; App.state.overrides = {};
  save(); closeModal(); renderAll();
  toast("🧹 All clean! Fresh tournament, fresh dreams.");
}
function closeModal() { $("#modal-backdrop").classList.add("hidden"); }

/* ───────────────────────── render & events ───────────────────────── */
function renderAll() {
  renderGroups(); renderBracket(); renderTeams(); renderChampion();
  renderScorecard(); renderSlots(); renderTodayStrip(); applyModeUI();
  if (!$("#view-live").classList.contains("hidden")) renderLive();
}
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  if (name === "live") { renderLive(); pollFeed(false); }
  if (name === "scorecard") renderScorecard();
}
function wireEvents() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  $("#sync-btn").addEventListener("click", () => doSync(true));
  $("#wipe-btn").addEventListener("click", confirmWipe);
  document.querySelectorAll('input[name="updateMode"]').forEach(r =>
    r.addEventListener("change", () => {
      App.state.settings.mode = r.value; save(); applyModeUI();
      if (r.value === "live") doSync(false);
    }));
  const st = $("#sound-toggle");
  if (st) st.addEventListener("change", () => { App.state.settings.sound = st.checked; save(); if (st.checked) sfx("tick"); });
  $("#api-key").addEventListener("change", e => { App.state.settings.apiKey = e.target.value.trim(); save(); });
  $("#modal-backdrop").addEventListener("click", e => { if (e.target.id === "modal-backdrop") closeModal(); });

  document.body.addEventListener("click", e => {
    const actEl = e.target.closest("[data-act]");
    if (actEl) {
      const act = actEl.dataset.act;
      if (act === "close-modal") return closeModal();
      if (act === "do-wipe") return doWipe();
      const row = actEl.closest("[data-match]") || actEl;
      const num = Number(actEl.dataset.match || (row && row.dataset.match));
      if (act === "inc" || act === "dec") { e.stopPropagation(); sfx("tick"); return bumpScore(num, actEl.dataset.side, act === "inc" ? 1 : -1); }
      if (act === "sim-group") return simGroupMatches(actEl.dataset.group);
      if (act === "sim-all-groups") return simAllGroups();
      if (act === "sim-bracket") return simKnockoutRest();
      if (act === "sim-tournament") return simTournament();
      if (act === "pens") { e.stopPropagation(); return openShootout(num); }
      if (act === "shoot") return shootKick();
      if (act === "back-to-team") return openTeamModal(actEl.dataset.team);
      if (act === "slot-save") return slotSave();
      if (act === "slot-load") return slotLoad(actEl.dataset.name);
      if (act === "slot-del") return slotDelete(actEl.dataset.name);
      if (act === "add-rival") {
        const name = prompt("Who's the rival? (their name)", "Dad");
        if (name) { App.state.rival = { name: name.trim().slice(0, 20) || "Rival", preds: {} }; save(); renderScorecard(); }
        return;
      }
      if (act === "clear") { delete App.state.scenario["m" + num]; save(); return renderAll(); }
      if (act === "whatif") {
        App.state.overrides["m" + num] = true;
        const real = App.state.real["m" + num];
        if (real && !App.state.scenario["m" + num]) App.state.scenario["m" + num] = real.winner != null ? { winner: real.winner } : { h: real.h, a: real.a };
        save(); toast("✏️ What-if mode — change history!"); return renderAll();
      }
      if (act === "restore") {
        delete App.state.overrides["m" + num]; delete App.state.scenario["m" + num];
        save(); toast("↩️ Back to what really happened."); return renderAll();
      }
    }
    const card = e.target.closest(".pcard[data-player]");
    if (card) return openPlayerProfile(card.dataset.player, card.dataset.pteam);
    const flag = e.target.closest(".flag[data-team], .tname[data-team], .teamcell[data-team], .team-pill[data-team], .third-chip[data-team]");
    if (flag) { e.stopPropagation(); return openTeamModal(flag.dataset.team); }
    const pick = e.target.closest(".ko-team[data-pick]");
    if (pick) return pickWinner(Number(pick.dataset.match), pick.dataset.pick);
  });

  document.body.addEventListener("change", e => {
    const sel = e.target.closest(".battle-sel");
    if (sel) { App.battle[sel.dataset.side] = sel.value || null; return renderBattle(); }
    const rp = e.target.closest("input[data-rp]");
    if (rp && App.state.rival) {
      const k = "m" + rp.dataset.match;
      const entry = App.state.rival.preds[k] || (App.state.rival.preds[k] = {});
      const v = rp.value === "" ? null : Math.max(0, Math.min(15, parseInt(rp.value, 10) || 0));
      entry[rp.dataset.rp] = v;
      if (entry.h == null && entry.a == null) delete App.state.rival.preds[k];
      save();
    }
  });
}

/* ───────────────────────── boot ───────────────────────── */
async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}
async function boot() {
  App.state = loadState();
  wireEvents();
  try {
    const [teams, schedule] = await Promise.all([loadJSON("data/teams.json"), loadJSON("data/schedule.json")]);
    App.teams = teams; App.schedule = schedule;
  } catch (e) {
    $("#view-groups").innerHTML = `<div class="champ-empty" style="margin-top:40px">⏳ <b>Tournament data not loaded yet.</b><br>
      The team & schedule files are still being prepared — refresh in a minute! <br><small>(${esc(e.message)})</small></div>`;
    return;
  }
  const parts = await Promise.all(["ab", "cd", "ef", "gh", "ij", "kl"].map(s =>
    loadJSON("data/squads-" + s + ".json").catch(() => ({}))));
  parts.forEach(p => Object.assign(App.squads, p));
  renderSettings();
  renderAll();
  pollFeed();
  setInterval(pollFeed, 60000);
}
boot();
