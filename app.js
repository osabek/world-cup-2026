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
    settings: { mode: "sync", apiKey: "" },
    lastSync: null,
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
  let html = '<div class="groups-grid">';

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
    html += `<div class="group-card"><h2>GROUP <span class="gname">${g}</span></h2>`;
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
      <span class="ko-badges">${r ? chipFor(src) : esc((m.venue || "").split(",")[1] || m.venue || "")}${locked ? `<button class="mini-btn" data-act="whatif" data-match="${m.match}">✏️</button>` :
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
  el.innerHTML = `<div class="bracket-scroll"><div class="bracket">
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
  let html = '<div class="teams-grid">';
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
function playerCard(p) {
  const prof = STAT_PROFILES[p.pos] || STAT_PROFILES.MF;
  const rnd = seededRand(p.name + p.pos);
  const tier = p.rating >= 83 ? "" : p.rating >= 75 ? "silver" : "bronze";
  const stats = prof.labels.map((lb, i) => {
    const v = Math.max(30, Math.min(99, Math.round(p.rating + prof.off[i] + (rnd() * 10 - 5))));
    return `<span class="stat"><b>${lb}</b><span class="bar"><i style="width:${v}%"></i></span>${v}</span>`;
  }).join("");
  return `<div class="pcard ${tier}">
    <div class="top"><span class="ovr">${p.rating}</span><span class="pos">${p.pos}</span><span class="num">#${p.num ?? ""}</span></div>
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
      body += `<div class="tm-section-title">${title}</div><div class="cards-grid">${ps.map(playerCard).join("")}</div>`;
    }
  }
  $("#team-modal").innerHTML = `
    <div class="tm-head"><span class="flag">${tm.flag}</span>
      <div><h2>${esc(tm.name)}</h2><div class="tm-sub">Group ${grp} · FIFA Rank #${tm.fifaRank ?? "?"} · ${sq.length} players</div></div>
      ${pw ? `<div class="tm-power"><div class="pw">${pw}</div><div class="pwl">Team Power</div></div>` : ""}
      <button class="tm-close" data-act="close-modal">✕</button></div>
    ${body}`;
  $("#modal-backdrop").classList.remove("hidden");
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
    if (App.lastChampion !== fin.winner) { App.lastChampion = fin.winner; confetti(); }
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
  applyModeUI();
}
function applyModeUI() {
  const mode = App.state.settings.mode;
  $("#sync-btn").classList.toggle("hidden", mode === "off");
  $("#live-badge").classList.toggle("hidden", mode !== "live");
  $("#last-sync").textContent = App.state.lastSync ? "last sync " + new Date(App.state.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  clearInterval(App.liveTimer); App.liveTimer = null;
  if (mode === "live") {
    App.liveTimer = setInterval(() => doSync(false), 60000);
    doSync(false);
  }
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
async function doSync(manual = true) {
  const btn = $("#sync-btn");
  if (manual) btn.classList.add("spinning");
  try {
    const data = { matches: await fetchScores() };
    const idx = buildNameIndex();
    const realRes = resolveBracket(realResult);
    let applied = 0;
    for (const fm of data.matches || []) {
      if (fm.status !== "FT" && fm.status !== "LIVE") continue;
      if (fm.hs == null || fm.as == null) continue;
      const hc = idx[normName(fm.home)], ac = idx[normName(fm.away)];
      if (!hc || !ac) continue;
      // group-stage match?
      let m = App.schedule.groupMatches.find(m2 =>
        ((m2.home === hc && m2.away === ac) || (m2.home === ac && m2.away === hc)) && dateClose(m2.date, fm.date));
      if (m) {
        const flip = m.home !== hc;
        App.state.real["m" + m.match] = { h: flip ? fm.as : fm.hs, a: flip ? fm.hs : fm.as, live: fm.status === "LIVE" };
        applied++; continue;
      }
      // knockout match? match by resolved real participants
      const ko = allKnockoutMatches().find(km => {
        const d = realRes.out[km.match];
        return d && d.home.code && d.away.code && dateClose(km.date, fm.date) &&
          ((d.home.code === hc && d.away.code === ac) || (d.home.code === ac && d.away.code === hc));
      });
      if (ko) {
        const d = realRes.out[ko.match];
        const flip = d.home.code !== hc;
        const rec = { h: flip ? fm.as : fm.hs, a: flip ? fm.hs : fm.as, live: fm.status === "LIVE" };
        if (fm.penH != null && fm.penA != null) {
          rec.pens = flip ? [fm.penA, fm.penH] : [fm.penH, fm.penA];
          rec.winner = (flip ? fm.penA > fm.penH : fm.penH > fm.penA) ? d.home.code : d.away.code;
        } else if (rec.h !== rec.a) rec.winner = rec.h > rec.a ? d.home.code : d.away.code;
        App.state.real["m" + ko.match] = rec;
        applied++;
      }
    }
    App.state.lastSync = Date.now();
    save(); renderAll();
    if (manual) toast(applied ? `🔄 Synced! ${applied} real result${applied > 1 ? "s" : ""} in the game.` : "🔄 Synced — no finished games yet. Kickoff coming soon!");
  } catch (e) {
    if (manual) toast("😬 Couldn't reach the scores feed: " + e.message);
  } finally {
    btn.classList.remove("spinning");
    $("#last-sync").textContent = App.state.lastSync ? "last sync " + new Date(App.state.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  }
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
  renderGroups(); renderBracket(); renderTeams(); renderChampion(); applyModeUI();
}
function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
}
function wireEvents() {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  $("#sync-btn").addEventListener("click", () => doSync(true));
  $("#wipe-btn").addEventListener("click", confirmWipe);
  document.querySelectorAll('input[name="updateMode"]').forEach(r =>
    r.addEventListener("change", () => { App.state.settings.mode = r.value; save(); applyModeUI(); }));
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
      if (act === "inc" || act === "dec") { e.stopPropagation(); return bumpScore(num, actEl.dataset.side, act === "inc" ? 1 : -1); }
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
    const flag = e.target.closest(".flag[data-team], .tname[data-team], .teamcell[data-team], .team-pill[data-team], .third-chip[data-team]");
    if (flag) { e.stopPropagation(); return openTeamModal(flag.dataset.team); }
    const pick = e.target.closest(".ko-team[data-pick]");
    if (pick) return pickWinner(Number(pick.dataset.match), pick.dataset.pick);
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
}
boot();
