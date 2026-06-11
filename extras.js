/* ⚽ Road to the Cup 2026 — Clubhouse extras
   Sticker album + packs + gifting, badges + streaks + match-day MVP,
   "what needs to happen" scenario explainer + path to glory + upset meter,
   avatars + emoji reactions + daily trivia + extra juice.
   Self-contained: hooks into app.js globals (team, powerOf, effResult, sfx,
   resolveBracket, renderAll, switchTab, openTeamModal) and optional window.Cloud. */
"use strict";
(function () {
  const E = window.Extras = { ready: false, col: {}, data: null, inited: false };
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const rnd = n => Math.floor(Math.random() * n);

  /* ───── persistent clubhouse data ───── */
  function load() {
    try { E.col = JSON.parse(localStorage.getItem("wc26-collection") || "{}"); } catch { E.col = {}; }
    try { E.data = JSON.parse(localStorage.getItem("wc26-clubhouse") || "null"); } catch { E.data = null; }
    if (!E.data) E.data = {};
    E.data.packs = E.data.packs || 0;
    E.data.stats = Object.assign({ sims: 0, packsOpened: 0, trivia: 0, shootouts: 0, viewed: {}, claimedPred: 0, badgesSeen: [] }, E.data.stats || {});
    E.data.streak = E.data.streak || 0;
    E.data.bestStreak = E.data.bestStreak || 0;
    E.data.lastDay = E.data.lastDay || null;
    E.data.avatar = E.data.avatar || { kit: "#1877d2", flag: "⚽", mascot: "🦁", fav: null };
    E.data.trivia = E.data.trivia || { day: null, idx: 0, answered: false };
  }
  function save() {
    try { localStorage.setItem("wc26-collection", JSON.stringify(E.col)); } catch {}
    try { localStorage.setItem("wc26-clubhouse", JSON.stringify(E.data)); } catch {}
    if (window.Cloud && Cloud.user) mirrorCloud();
  }
  let mirrorT;
  function mirrorCloud() {
    clearTimeout(mirrorT);
    mirrorT = setTimeout(() => { try { Cloud.saveCollection && Cloud.saveCollection(E.col, E.data.avatar); } catch {} }, 1500);
  }

  /* ───── sticker model ───── */
  function allPlayers() {
    if (E._players) return E._players;
    const list = [];
    for (const code of Object.keys(App.squads || {})) {
      for (const p of App.squads[code]) list.push({ key: code + "#" + (p.num ?? p.name), code, p });
    }
    E._players = list; return list;
  }
  const rarity = r => r >= 85 ? "gold" : r >= 75 ? "silver" : "bronze";
  function byTeam(code) { return allPlayers().filter(x => x.code === code); }

  function grantSticker(key) { E.col[key] = (E.col[key] || 0) + 1; return E.col[key] === 1; }

  function openPack() {
    if (E.data.packs <= 0) return null;
    E.data.packs--;
    E.data.stats.packsOpened++;
    const pool = allPlayers();
    const pick = tier => {
      const cands = pool.filter(x => rarity(x.p.rating) === tier);
      return cands[rnd(cands.length)];
    };
    const out = [];
    for (let i = 0; i < 5; i++) {
      const roll = Math.random();
      const tier = roll < 0.62 ? "bronze" : roll < 0.92 ? "silver" : "gold";
      let s = pick(tier) || pool[rnd(pool.length)];
      const isNew = grantSticker(s.key);
      out.push({ ...s, isNew });
    }
    save();
    return out;
  }

  /* daily login + streak + prediction rewards */
  function dailyCheck() {
    const t = todayKey();
    if (E.data.lastDay !== t) {
      const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      E.data.streak = (E.data.lastDay === y) ? E.data.streak + 1 : 1;
      E.data.bestStreak = Math.max(E.data.bestStreak, E.data.streak);
      E.data.lastDay = t;
      const bonus = E.data.streak % 7 === 0 ? 3 : 1;
      E.data.packs += bonus;
      setTimeout(() => toast(`🔥 Day streak: ${E.data.streak}! +${bonus} pack${bonus > 1 ? "s" : ""} — open them in the Clubhouse!`), 800);
      save();
    }
    grantPredictionRewards();
  }
  function grantPredictionRewards() {
    const picks = Object.keys(App.state.scenario || {}).length;
    const earned = Math.floor(picks / 10);
    if (earned > E.data.stats.claimedPred) {
      const add = earned - E.data.stats.claimedPred;
      E.data.stats.claimedPred = earned;
      E.data.packs += add;
      save();
    }
  }

  /* ───── metrics for badges ───── */
  function metrics() {
    const groupNums = new Set(App.schedule.groupMatches.map(m => m.match));
    let exact = 0, picks = 0;
    for (const [k, p] of Object.entries(App.state.scenario || {})) {
      picks++;
      const num = Number(k.slice(1)), real = App.state.real[k];
      if (real && !real.live && groupNums.has(num) && p.h != null && real.h != null && p.h === real.h && p.a === real.a) exact++;
    }
    let groupsComplete = 0;
    for (const g of Object.keys(App.teams.groups)) if (groupTable(g, effResult).complete) groupsComplete++;
    const res = resolveBracket(effResult).out;
    const fin = res[App.schedule.knockout.FINAL.match];
    const bracketComplete = !!(fin && fin.winner);
    const totalStickers = Object.values(E.col).reduce((a, b) => a + (b > 0 ? 1 : 0), 0);
    let teamsDone = 0;
    for (const code of Object.keys(App.teams.teams)) {
      const need = byTeam(code).length;
      if (need && byTeam(code).every(x => E.col[x.key])) teamsDone++;
    }
    return {
      picks, exact, groupsComplete, bracketComplete,
      championChosen: bracketComplete, teamsViewed: Object.keys(E.data.stats.viewed).length,
      totalStickers, teamsDone, dupes: Object.values(E.col).reduce((a, b) => a + Math.max(0, b - 1), 0),
      streak: E.data.streak, bestStreak: E.data.bestStreak, sims: E.data.stats.sims,
      packsOpened: E.data.stats.packsOpened, trivia: E.data.stats.trivia, shootouts: E.data.stats.shootouts,
    };
  }
  const BADGES = [
    { id: "first", e: "👟", n: "First Kick", d: "Make your first prediction", t: m => m.picks >= 1 },
    { id: "ten", e: "📋", n: "Form Guide", d: "Make 10 predictions", t: m => m.picks >= 10 },
    { id: "fifty", e: "🧠", n: "Super Scout", d: "Make 50 predictions", t: m => m.picks >= 50 },
    { id: "crystal", e: "🔮", n: "Crystal Ball", d: "Nail 1 exact score", t: m => m.exact >= 1 },
    { id: "sharp", e: "🎯", n: "Sharpshooter", d: "Nail 5 exact scores", t: m => m.exact >= 5 },
    { id: "grpmaster", e: "🥅", n: "Group Master", d: "Finish all 12 groups", t: m => m.groupsComplete >= 12 },
    { id: "bracket", e: "🏆", n: "Bracket Genius", d: "Complete the whole bracket", t: m => m.bracketComplete },
    { id: "globe", e: "🌍", n: "Globetrotter", d: "Peek at all 48 teams", t: m => m.teamsViewed >= 48 },
    { id: "collector", e: "🃏", n: "Collector", d: "Complete a team's stickers", t: m => m.teamsDone >= 1 },
    { id: "supercol", e: "📚", n: "Sticker Champ", d: "Complete 12 teams", t: m => m.teamsDone >= 12 },
    { id: "hoard", e: "💎", n: "Big Shiny Pile", d: "Collect 100 stickers", t: m => m.totalStickers >= 100 },
    { id: "streak3", e: "🔥", n: "On Fire", d: "3-day streak", t: m => m.bestStreak >= 3 },
    { id: "streak7", e: "🌋", n: "Unstoppable", d: "7-day streak", t: m => m.bestStreak >= 7 },
    { id: "sim", e: "🎲", n: "What If Wizard", d: "Run a simulation", t: m => m.sims >= 1 },
    { id: "pens", e: "🧤", n: "Penalty Hero", d: "Decide a shootout", t: m => m.shootouts >= 1 },
    { id: "trivia", e: "⭐", n: "Quiz Whiz", d: "Get 5 trivia stars", t: m => m.trivia >= 5 },
  ];
  function earnedBadges() { const m = metrics(); return BADGES.map(b => ({ ...b, got: b.t(m) })); }
  function checkNewBadges() {
    const got = earnedBadges().filter(b => b.got);
    const seen = new Set(E.data.stats.badgesSeen);
    const fresh = got.filter(b => !seen.has(b.id));
    if (fresh.length) {
      E.data.stats.badgesSeen = got.map(b => b.id);
      save();
      fresh.forEach((b, i) => setTimeout(() => { toast(`${b.e} Badge unlocked: ${b.n}!`); if (window.sfx) sfx("goal"); }, 400 + i * 1400));
    }
  }

  /* ───── scenario explainer: "what needs to happen" ───── */
  function repScore(out) { return out === "W" ? { h: 1, a: 0 } : out === "L" ? { h: 0, a: 1 } : { h: 0, a: 0 }; }
  function qualScenario(group, code) {
    const gm = App.schedule.groupMatches.filter(m => m.group === group).sort((a, b) => a.match - b.match);
    const remaining = gm.filter(m => { const r = effResult(m.match); return !r || r.h == null; });
    const base = groupTable(group, effResult);
    const rank = base.rows.findIndex(r => r.code === code);
    if (remaining.length === 0) {
      if (rank === 0) return { tag: "in", head: "Through as group winner! 🥇", line: "Top of the group — into the Round of 32." };
      if (rank === 1) return { tag: "in", head: "Through in 2nd! ✅", line: "Runner-up spot secured." };
      if (rank === 2) return { tag: "maybe", head: "3rd place — might still sneak in!", line: "One of the 8 best 3rd-placed teams goes through. Check the 3rd-place race on the Groups tab." };
      return { tag: "out", head: "Out this time 😞", line: "Finished bottom of the group." };
    }
    // brute force remaining outcomes (cap to keep it instant)
    const combos = Math.pow(3, remaining.length);
    if (combos > 2000) return { tag: "maybe", head: "Still all to play for!", line: "Lots of games left in this group — keep setting scores to see it take shape." };
    const getWith = over => n => over[n] || effResult(n);
    let top2Any = false, top2All = true, winAny = false, drawAny = false;
    const myNext = remaining.find(m => m.home === code || m.away === code);
    for (let c = 0; c < combos; c++) {
      const over = {}; let cc = c;
      for (const m of remaining) { const o = ["W", "D", "L"][cc % 3]; cc = Math.floor(cc / 3); over[m.match] = repScore(o); }
      const t = groupTable(group, getWith(over));
      const r = t.rows.findIndex(x => x.code === code);
      const isTop2 = r === 0 || r === 1;
      top2Any = top2Any || isTop2; top2All = top2All && isTop2;
      if (isTop2 && myNext) {
        const mo = over[myNext.match]; const meHome = myNext.home === code;
        const got = (mo.h > mo.a) === meHome ? "W" : (mo.h === mo.a ? "D" : "L");
        if (got === "W") winAny = true; if (got === "D") drawAny = true;
      }
    }
    const oppNext = myNext ? team(myNext.home === code ? myNext.away : myNext.home) : null;
    if (top2All) return { tag: "in", head: "Already through! 🎉", line: "Maths says " + team(code).name + " can't be caught for a top-2 spot." };
    if (!top2Any) return { tag: "maybe", head: "Top 2 looks tough now…", line: team(code).name + " probably can't finish top 2 — but a best 3rd place could still rescue them! 🤞" };
    let line = "";
    if (myNext) {
      if (winAny && !drawAny) line = `Beat ${oppNext.name} ${oppNext.flag} next and they're flying. A slip-up could be costly.`;
      else if (winAny && drawAny) line = `Even a draw with ${oppNext.name} ${oppNext.flag} keeps them alive — a win makes it much safer.`;
      else line = `It's tight — results in the other game matter too. Get a good result vs ${oppNext.name} ${oppNext.flag}.`;
    } else line = "Their games are done — now it depends on the other results in the group.";
    return { tag: "maybe", head: "In the hunt! 👀", line };
  }

  function pathToGlory(code) {
    const res = resolveBracket(effResult).out;
    const ko = [...App.schedule.knockout.R32, ...App.schedule.knockout.R16, ...App.schedule.knockout.QF, ...App.schedule.knockout.SF, App.schedule.knockout.FINAL];
    const names = { 73: "Round of 32", 89: "Round of 16", 97: "Quarter-final", 101: "Semi-final", 104: "FINAL" };
    const rounds = [["Round of 32", App.schedule.knockout.R32], ["Round of 16", App.schedule.knockout.R16],
      ["Quarter-final", App.schedule.knockout.QF], ["Semi-final", App.schedule.knockout.SF], ["FINAL", [App.schedule.knockout.FINAL]]];
    const steps = [];
    for (const [rn, ms] of rounds) {
      const m = ms.find(x => { const d = res[x.match]; return d && (d.home.code === code || d.away.code === code); });
      if (!m) continue;
      const d = res[m.match];
      const opp = d.home.code === code ? d.away : d.home;
      const oppLabel = opp.code ? `${team(opp.code).flag} ${team(opp.code).name}` : (opp.label || "TBD");
      const won = d.winner === code; const lost = d.winner && !won;
      steps.push({ rn, oppLabel, won, lost });
    }
    return steps;
  }

  /* ───── daily trivia ───── */
  const TRIVIA = [
    { q: "How many teams play in the 2026 World Cup?", a: ["48", "32", "64", "24"] },
    { q: "Which 3 countries are hosting in 2026?", a: ["USA, Canada & Mexico", "USA only", "Brazil & Argentina", "Canada & Mexico"] },
    { q: "How many players are on a World Cup squad?", a: ["26", "11", "23", "30"] },
    { q: "What do you call the round of the last 16 teams?", a: ["Round of 16", "Quarter-finals", "Group stage", "Play-offs"] },
    { q: "How many points for a win in the group stage?", a: ["3", "1", "2", "5"] },
    { q: "Which country has won the most World Cups?", a: ["Brazil", "Germany", "Italy", "Argentina"] },
    { q: "Who won the 2022 World Cup?", a: ["Argentina", "France", "Brazil", "Croatia"] },
    { q: "How many players from each team are on the pitch?", a: ["11", "10", "9", "12"] },
    { q: "What shape is the classic soccer ball pattern made of?", a: ["Pentagons & hexagons", "Squares", "Triangles", "Circles"] },
    { q: "How long is a normal soccer match?", a: ["90 minutes", "60 minutes", "120 minutes", "45 minutes"] },
    { q: "What happens if a knockout game is tied after 90 mins?", a: ["Extra time, then penalties", "It's a draw", "Replay next day", "Coin flip"] },
    { q: "How many groups are there in 2026?", a: ["12", "8", "10", "16"] },
    { q: "What card means a player is sent off?", a: ["Red card", "Yellow card", "Green card", "Blue card"] },
    { q: "Which trophy do World Cup winners lift?", a: ["The FIFA World Cup Trophy", "The Champions League", "The Golden Boot", "The Ballon d'Or"] },
    { q: "The award for the top goal-scorer is the…", a: ["Golden Boot", "Golden Glove", "Golden Ball", "Silver Boot"] },
  ];
  function todaysTrivia() {
    const day = todayKey();
    if (E.data.trivia.day !== day) {
      const idx = Math.abs([...day].reduce((a, c) => a + c.charCodeAt(0), 0)) % TRIVIA.length;
      E.data.trivia = { day, idx, answered: false };
      save();
    }
    return TRIVIA[E.data.trivia.idx];
  }
  function answerTrivia(choice) {
    if (E.data.trivia.answered) return;
    const correct = choice === 0;
    E.data.trivia.answered = true;
    E.data.trivia.correct = correct;
    if (correct) { E.data.stats.trivia++; E.data.packs += 1; toast("⭐ Correct! +1 trivia star & a pack!"); if (window.sfx) sfx("goal"); }
    else { toast("❌ Not this time — come back tomorrow for a new one!"); if (window.sfx) sfx("save"); }
    save(); checkNewBadges(); renderClubhouse();
  }

  /* ───── Clubhouse UI ───── */
  let sub = "album", albumTeam = null;
  function renderClubhouse() {
    const el = $("#view-clubhouse");
    if (!el || !App.teams) return;
    if (!E.inited) return;
    const tabs = [["album", "🃏 Album"], ["packs", "🎁 Packs"], ["badges", "🏅 Badges"], ["trivia", "❓ Trivia"], ["me", "🎽 My Kit"]];
    let html = `<div class="cb-sub">${tabs.map(([k, l]) =>
      `<button class="cb-tab ${sub === k ? "on" : ""}" data-act="cb-sub" data-sub="${k}">${l}</button>`).join("")}
      <span class="cb-packcount" data-act="cb-sub" data-sub="packs">🎁 ${E.data.packs}</span>
      <span class="cb-streak">🔥 ${E.data.streak}</span></div>
      <div class="cb-body">`;
    if (sub === "album") html += albumHtml();
    else if (sub === "packs") html += packsHtml();
    else if (sub === "badges") html += badgesHtml();
    else if (sub === "trivia") html += triviaHtml();
    else if (sub === "me") html += kitHtml();
    el.innerHTML = html + "</div>";
    applyPhotosSafe();
  }
  function applyPhotosSafe() {
    try {
      const names = [...document.querySelectorAll("#view-clubhouse img[data-photo]")].map(i => i.dataset.photo);
      if (window.applyPhotos) applyPhotos(names);
      if (window.loadTeamPhotos && names.length) loadTeamPhotos(names);
    } catch {}
  }

  function albumHtml() {
    const codes = Object.keys(App.teams.groups).flatMap(g => App.teams.groups[g]);
    if (!albumTeam) albumTeam = codes[0];
    let h = `<div class="album-teams">${codes.map(c => {
      const need = byTeam(c).length, have = byTeam(c).filter(x => E.col[x.key]).length;
      const done = need && have === need;
      return `<button class="album-pill ${albumTeam === c ? "on" : ""} ${done ? "done" : ""}" data-act="cb-team" data-code="${c}">
        ${team(c).flag} <small>${have}/${need}</small></button>`;
    }).join("")}</div>`;
    const players = byTeam(albumTeam).sort((a, b) => (a.p.num || 99) - (b.p.num || 99));
    const have = players.filter(x => E.col[x.key]).length;
    h += `<div class="album-head">${team(albumTeam).flag} <b>${esc(team(albumTeam).name)}</b>
      <span class="album-prog">${have}/${players.length} ${have === players.length ? "✅ COMPLETE!" : ""}</span></div>`;
    h += `<div class="sticker-grid">${players.map(x => {
      const owned = E.col[x.key] || 0;
      if (!owned) return `<div class="sticker empty"><div class="s-q">?</div><div class="s-n">#${x.p.num ?? ""}</div></div>`;
      const rar = rarity(x.p.rating);
      return `<div class="sticker ${rar}" data-act="cb-sticker" data-key="${x.key}">
        <span class="s-ovr">${x.p.rating}</span>
        <img class="s-photo" data-photo="${esc(x.p.name)}" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'%3E%3Ccircle cx='30' cy='24' r='11' fill='%23ffffff55'/%3E%3Cellipse cx='30' cy='52' rx='18' ry='12' fill='%23ffffff55'/%3E%3C/svg%3E">
        <div class="s-nm">${esc(x.p.name.split(" ").slice(-1)[0])}</div>
        ${owned > 1 ? `<span class="s-dup">×${owned}</span>` : ""}</div>`;
    }).join("")}</div>`;
    const dupes = metrics().dupes;
    if (dupes) h += `<p class="cb-help">You have <b>${dupes}</b> duplicate sticker${dupes > 1 ? "s" : ""} — tap any ×2 sticker to send it to a league friend! 🎁</p>`;
    return h;
  }

  function packsHtml() {
    let h = `<div class="packs-wrap">`;
    if (E._reveal) {
      h += `<div class="reveal-row">${E._reveal.map((s, i) => `
        <div class="reveal-card ${rarity(s.p.rating)} ${s.isNew ? "newone" : ""}" style="animation-delay:${i * 0.12}s">
          <span class="s-ovr">${s.p.rating}</span>
          <img class="s-photo" data-photo="${esc(s.p.name)}" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'%3E%3Ccircle cx='30' cy='24' r='11' fill='%23ffffff55'/%3E%3Cellipse cx='30' cy='52' rx='18' ry='12' fill='%23ffffff55'/%3E%3C/svg%3E">
          <div class="s-nm">${esc(s.p.name.split(" ").slice(-1)[0])}</div>
          <div class="s-team">${team(s.code).flag}</div>
          ${s.isNew ? '<span class="s-new">NEW!</span>' : '<span class="s-old">dupe</span>'}</div>`).join("")}</div>`;
    } else {
      h += `<div class="pack-big">🎁</div>`;
    }
    h += `<div class="pack-actions">
      <div class="pack-have">You have <b>${E.data.packs}</b> pack${E.data.packs === 1 ? "" : "s"}</div>
      <button class="sim-btn gold ${E.data.packs ? "" : "dim"}" data-act="cb-open">${E.data.packs ? "✨ OPEN A PACK!" : "No packs — play to earn more!"}</button>
      <p class="cb-help">Earn packs every day you play (🔥 streak), every 10 predictions, by winning trivia, and from badges!</p>
    </div></div>`;
    return h;
  }

  function badgesHtml() {
    const bs = earnedBadges();
    const got = bs.filter(b => b.got).length;
    return `<div class="badge-head">🏅 ${got}/${bs.length} badges unlocked</div>
      <div class="badge-grid">${bs.map(b => `<div class="badge ${b.got ? "got" : "locked"}">
        <div class="b-e">${b.got ? b.e : "🔒"}</div><div class="b-n">${b.n}</div><div class="b-d">${b.d}</div></div>`).join("")}</div>`;
  }

  function triviaHtml() {
    const q = todaysTrivia(), tv = E.data.trivia;
    let h = `<div class="trivia-card"><div class="tv-q">❓ ${esc(q.q)}</div><div class="tv-opts">`;
    q.a.forEach((opt, i) => {
      let cls = "";
      if (tv.answered) cls = i === 0 ? "right" : "wrong";
      h += `<button class="tv-opt ${cls}" data-act="cb-trivia" data-i="${i}" ${tv.answered ? "disabled" : ""}>${esc(opt)}</button>`;
    });
    h += `</div>`;
    if (tv.answered) h += `<p class="cb-help">${tv.correct ? "⭐ Nice one! " : "The answer was highlighted. "}Come back tomorrow for a fresh question!</p>`;
    else h += `<p class="cb-help">Get it right for a ⭐ trivia star and a free pack! One question a day.</p>`;
    h += `<div class="tv-stars">⭐ Trivia stars: <b>${E.data.stats.trivia}</b></div></div>`;
    return h;
  }

  const KITS = ["#1877d2", "#e3000f", "#2e9e44", "#ffc83d", "#7c4dbe", "#ff7a00", "#000000", "#ff4fa3"];
  const MASCOTS = ["🦁", "🐯", "🦅", "🐉", "🦈", "🐺", "🐻", "🦊", "🐨", "🦄", "🐸", "⚽"];
  function kitHtml() {
    const av = E.data.avatar;
    const codes = Object.keys(App.teams.teams);
    let h = `<div class="kit-card">
      <div class="kit-preview" style="--kit:${av.kit}"><div class="kit-shirt">${av.mascot}</div><div class="kit-flag">${av.flag}</div></div>
      <div class="kit-row"><span>Shirt colour</span><div class="kit-opts">${KITS.map(k =>
        `<button class="kit-dot ${av.kit === k ? "on" : ""}" style="background:${k}" data-act="cb-kit" data-kit="${k}"></button>`).join("")}</div></div>
      <div class="kit-row"><span>Mascot</span><div class="kit-opts">${MASCOTS.map(mc =>
        `<button class="kit-emoji ${av.mascot === mc ? "on" : ""}" data-act="cb-mascot" data-m="${mc}">${mc}</button>`).join("")}</div></div>
      <div class="kit-row"><span>Favourite team ⭐</span>
        <select class="kit-fav" data-act="cb-fav">${["<option value=''>— none —</option>"].concat(
          codes.map(c => `<option value="${c}" ${av.fav === c ? "selected" : ""}>${team(c).name}</option>`)).join("")}</select></div>
      <p class="cb-help">Your kit & mascot show next to your name on the league leaderboard. Pick a favourite team and the game cheers for them! 📣</p>
    </div>`;
    return h;
  }

  /* ───── gifting (needs Cloud) ───── */
  function giftSticker(key) {
    if (!(window.Cloud && Cloud.user && Cloud.profile && Cloud.profile.leagueId)) {
      toast("👥 Join a league (League tab) to send stickers to friends!"); return;
    }
    if ((E.col[key] || 0) < 2) { toast("You need a spare (×2+) to gift this one!"); return; }
    Cloud.openGiftPicker(key);
  }
  E.applyIncomingGift = function (key) {
    grantSticker(key); save();
    const pl = allPlayers().find(x => x.key === key);
    toast(`🎁 You received ${pl ? pl.p.name : "a sticker"}! Check your Album.`);
    if (window.sfx) sfx("goal");
    renderClubhouse();
  };
  E.removeForGift = function (key) { if (E.col[key] > 0) { E.col[key]--; if (!E.col[key]) delete E.col[key]; save(); renderClubhouse(); } };
  E.loadCloudCollection = function (col, avatar) {
    if (col && Object.keys(col).length >= Object.keys(E.col).length) E.col = col;
    if (avatar) E.data.avatar = Object.assign(E.data.avatar, avatar);
    save(); applyFavTheme(); renderClubhouse();
  };

  /* ───── favourite-team theming + cheers ───── */
  function applyFavTheme() {
    const fav = E.data.avatar.fav;
    document.body.classList.toggle("has-fav", !!fav);
    if (fav) document.documentElement.style.setProperty("--fav", "#1877d2");
  }

  /* ───── decorate existing views after each render ───── */
  function decorate() {
    if (!E.inited) return;
    // group scenario buttons
    document.querySelectorAll("#view-groups .group-card:not(.thirds-card)").forEach(card => {
      const h2 = card.querySelector("h2");
      if (h2 && !h2.querySelector(".scn-btn")) {
        const g = (h2.textContent.match(/GROUP\s+(\w)/) || [])[1];
        if (g) { const b = document.createElement("button"); b.className = "scn-btn"; b.dataset.act = "scenario"; b.dataset.group = g; b.textContent = "🔮 What needs to happen?"; h2.appendChild(b); }
      }
    });
    // favourite-team star on matches
    const fav = E.data.avatar.fav;
    if (fav) document.querySelectorAll(`#view-groups [data-team="${fav}"]`).forEach(e => {
      if (e.classList.contains("flag") && !e.dataset.starred) { e.dataset.starred = 1; e.insertAdjacentText("afterend", " ⭐"); }
    });
    // upset meter on bracket winners
    document.querySelectorAll("#view-bracket .ko-team.winner").forEach(w => {
      if (w.dataset.upchecked) return; w.dataset.upchecked = 1;
      const win = w.dataset.pick, m = w.closest(".ko-match");
      const teams = [...m.querySelectorAll(".ko-team[data-pick]")].map(x => x.dataset.pick);
      const loser = teams.find(c => c !== win);
      if (win && loser && powerOf(win) + 4 < powerOf(loser)) {
        const t = document.createElement("span"); t.className = "upset-tag"; t.textContent = "🔥 UPSET!"; w.appendChild(t);
      }
    });
    // path to glory in champion view
    const champ = $("#view-champion");
    if (champ && !champ.querySelector(".ptg") && champ.querySelector(".champ-name")) {
      const res = resolveBracket(effResult).out;
      const fin = res[App.schedule.knockout.FINAL.match];
      if (fin && fin.winner) champ.insertAdjacentHTML("beforeend", ptgHtml(fin.winner));
    }
    // match-day MVP banner in league handled by cloud.js
  }
  function ptgHtml(code) {
    const steps = pathToGlory(code);
    if (!steps.length) return "";
    return `<div class="ptg"><h3>🛤️ ${esc(team(code).name)}'s Road to Glory</h3>
      <div class="ptg-steps">${steps.map(s => `<div class="ptg-step ${s.won ? "won" : s.lost ? "lost" : ""}">
        <b>${s.rn}</b><span>vs ${s.oppLabel}</span>${s.won ? "✅" : s.lost ? "❌" : "⏳"}</div>`).join("")}</div></div>`;
  }

  function scenarioModal(group) {
    const codes = App.teams.groups[group];
    const body = codes.map(c => {
      const s = qualScenario(group, c);
      return `<div class="scn-row ${s.tag}"><div class="scn-team">${team(c).flag} <b>${esc(team(c).name)}</b></div>
        <div class="scn-head">${s.head}</div><div class="scn-line">${s.line}</div></div>`;
    }).join("");
    $("#team-modal").innerHTML = `<div class="tm-head" style="background:#7c4dbe"><h2>🔮 Group ${group} — What needs to happen?</h2>
      <button class="tm-close" data-act="close-modal">✕</button></div><div class="scn-wrap">${body}</div>`;
    $("#modal-backdrop").classList.remove("hidden");
  }

  /* ───── event handling ───── */
  document.body.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "cb-sub") { sub = el.dataset.sub; if (sub !== "packs") E._reveal = null; renderClubhouse(); }
    else if (act === "cb-team") { albumTeam = el.dataset.code; renderClubhouse(); }
    else if (act === "cb-open") {
      const r = openPack(); if (!r) { toast("No packs left — play to earn more! 🎮"); return; }
      E._reveal = r; sub = "packs"; if (window.sfx) sfx("goal"); checkNewBadges(); renderClubhouse();
    }
    else if (act === "cb-sticker") giftSticker(el.dataset.key);
    else if (act === "cb-trivia") answerTrivia(Number(el.dataset.i));
    else if (act === "cb-kit") { E.data.avatar.kit = el.dataset.kit; save(); pushAvatar(); renderClubhouse(); }
    else if (act === "cb-mascot") { E.data.avatar.mascot = el.dataset.m; save(); pushAvatar(); renderClubhouse(); }
    else if (act === "scenario") scenarioModal(el.dataset.group);
    // count sims & shootouts for badges
    if (act === "sim-group" || act === "sim-all-groups" || act === "sim-tournament") { E.data.stats.sims++; save(); setTimeout(checkNewBadges, 50); }
    if (act === "pens" && !el._counted) { el._counted = 1; E.data.stats.shootouts++; save(); setTimeout(checkNewBadges, 50); }
  });
  document.body.addEventListener("change", e => {
    const el = e.target.closest("[data-act=cb-fav]");
    if (el) { E.data.avatar.fav = el.value || null; save(); applyFavTheme(); pushAvatar(); if (window.renderAll) renderAll(); }
  });
  function pushAvatar() { if (window.Cloud && Cloud.pushAvatar) Cloud.pushAvatar(E.data.avatar); }

  E.notedShootout = function () { E.data.stats.shootouts++; save(); checkNewBadges(); };
  E.gotFirstView = function (code) {
    if (E.data.stats.viewed[code]) { checkNewBadges(); return; }
    E.data.stats.viewed[code] = 1;
    // reward: 2 stickers from this team on first peek
    const pls = byTeam(code); const picks = [];
    for (let i = 0; i < 2 && pls.length; i++) { const s = pls[rnd(pls.length)]; grantSticker(s.key); picks.push(s); }
    save();
    setTimeout(() => { toast(`🃏 +2 ${team(code).name} stickers for your Album!`); }, 600);
    checkNewBadges();
  };

  /* ───── init + wrap app globals ───── */
  E.init = function () {
    if (E.inited) return; E.inited = true;
    load(); dailyCheck(); applyFavTheme();
    E.ready = true;
    checkNewBadges();
  };

  // wrap renderAll -> also decorate + clubhouse refresh
  function wrap(name, after) {
    const orig = window[name]; if (typeof orig !== "function") return;
    window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) {} return r; };
  }
  const tryWrap = setInterval(() => {
    if (typeof window.renderAll === "function" && typeof window.openTeamModal === "function" && typeof window.switchTab === "function") {
      clearInterval(tryWrap);
      wrap("renderAll", () => { if (E.inited) { grantPredictionRewards(); decorate(); if (!$("#view-clubhouse").classList.contains("hidden")) renderClubhouse(); } });
      wrap("openTeamModal", (code) => { if (E.inited) E.gotFirstView(code); });
      wrap("switchTab", (name) => { if (name === "clubhouse") { if (!E.inited) E.init(); renderClubhouse(); } });
      // first init shortly after boot data loads
      const bootWait = setInterval(() => { if (App.teams && App.schedule && Object.keys(App.squads).length) { clearInterval(bootWait); E.init(); decorate(); } }, 200);
    }
  }, 120);

  E.renderClubhouse = renderClubhouse;
  E.qualScenario = qualScenario;
})();
