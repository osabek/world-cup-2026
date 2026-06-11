/* ☁️ League play — Firebase Auth + Firestore (loaded as an ES module).
   No personal data is collected: accounts are a made-up username + a 6-digit PIN.
   The PIN is mapped to Firebase's email/password auth under the hood. */
"use strict";

const Cloud = window.Cloud = {
  on: false, user: null, profile: null, league: null,
  members: {}, picks: {}, unsubs: [], queue: {}, notified: new Set(),
};

const $c = s => document.querySelector(s);
const escC = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PSEUDO = "@wc26.players";

let fb = null; // {auth, db, fns...}

async function initFirebase() {
  if (!window.FIREBASE_CONFIG) { renderLeague(); return; }
  const [appM, authM, fsM] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
  ]);
  const app = appM.initializeApp(window.FIREBASE_CONFIG);
  fb = {
    auth: authM.getAuth(app), db: fsM.getFirestore(app),
    ...authM, ...fsM,
  };
  Cloud.on = true;
  fb.onAuthStateChanged(fb.auth, async (user) => {
    Cloud.user = user;
    if (user) await loadProfile();
    else { Cloud.profile = null; detachLeague(); }
    renderLeague();
  });
}

/* ───────── profile / auth ───────── */
function cleanUsername(u) { return String(u || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15); }

async function loadProfile() {
  const banned = await fb.getDoc(fb.doc(fb.db, "banned", Cloud.user.uid));
  if (banned.exists()) {
    Cloud.profile = null;
    await fb.signOut(fb.auth);
    cloudToast("🚫 This account was removed by the league admin.");
    return;
  }
  const snap = await fb.getDoc(fb.doc(fb.db, "users", Cloud.user.uid));
  if (!snap.exists()) { Cloud.profile = null; return; }
  Cloud.profile = snap.data();
  const setup = await fb.getDoc(fb.doc(fb.db, "config", "setup"));
  Cloud.profile.isAdmin = setup.exists() && setup.data().adminUsername === Cloud.profile.username;
  if (Cloud.profile.avatar && window.Extras && Extras.loadCloudCollection) Extras.loadCloudCollection(null, Cloud.profile.avatar);
  if (Cloud.profile.leagueId) await attachLeague(Cloud.profile.leagueId);
}

async function signUp(username, pin, displayName) {
  const u = cleanUsername(username);
  if (u.length < 3) throw new Error("Username needs at least 3 letters/numbers.");
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must be exactly 6 digits.");
  const taken = await fb.getDoc(fb.doc(fb.db, "usernames", u));
  if (taken.exists()) throw new Error(`"${u}" is taken — try another!`);
  const cred = await fb.createUserWithEmailAndPassword(fb.auth, u + PSEUDO, "pin-" + pin);
  try {
    await fb.setDoc(fb.doc(fb.db, "usernames", u), { uid: cred.user.uid });
    await fb.setDoc(fb.doc(fb.db, "users", cred.user.uid), {
      username: u, displayName: (displayName || u).trim().slice(0, 20) || u,
      leagueId: null, createdAt: fb.serverTimestamp(),
    });
  } catch (e) {
    await cred.user.delete().catch(() => {});
    throw new Error(`"${u}" was grabbed a second ago — try another!`);
  }
  await loadProfile();
}

async function signIn(username, pin) {
  const u = cleanUsername(username);
  try {
    await fb.signInWithEmailAndPassword(fb.auth, u + PSEUDO, "pin-" + pin);
  } catch {
    throw new Error("Wrong username or PIN — check with the team captain!");
  }
}

/* ───────── leagues ───────── */
function leagueCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}
async function createLeague(name) {
  const id = "lg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const code = leagueCode();
  await fb.setDoc(fb.doc(fb.db, "leagues", id), {
    name: (name || "Our World Cup League").trim().slice(0, 30),
    code, ownerUid: Cloud.user.uid, createdAt: fb.serverTimestamp(),
  });
  await joinLeagueById(id);
  return code;
}
async function joinLeagueByCode(code) {
  const q = fb.query(fb.collection(fb.db, "leagues"), fb.where("code", "==", code.trim().toUpperCase()), fb.limit(1));
  const res = await fb.getDocs(q);
  if (res.empty) throw new Error("No league with that code — double-check it!");
  await joinLeagueById(res.docs[0].id);
}
async function joinLeagueById(id) {
  await fb.setDoc(fb.doc(fb.db, "leagues", id, "members", Cloud.user.uid), {
    displayName: Cloud.profile.displayName, avatar: avatarNow(), joinedAt: fb.serverTimestamp(),
  });
  await fb.setDoc(fb.doc(fb.db, "users", Cloud.user.uid), { leagueId: id }, { merge: true });
  Cloud.profile.leagueId = id;
  await attachLeague(id);
}
function avatarNow() {
  try { return (window.Extras && Extras.data && Extras.data.avatar) || null; } catch { return null; }
}
function detachLeague() {
  Cloud.unsubs.forEach(u => u()); Cloud.unsubs = [];
  Cloud.league = null; Cloud.members = {}; Cloud.picks = {}; Cloud.reactions = {};
}
async function attachLeague(id) {
  detachLeague();
  const snap = await fb.getDoc(fb.doc(fb.db, "leagues", id));
  if (!snap.exists()) { Cloud.profile.leagueId = null; return; }
  Cloud.league = { id, ...snap.data() };
  Cloud.unsubs.push(fb.onSnapshot(fb.collection(fb.db, "leagues", id, "members"), s => {
    Cloud.members = {};
    s.forEach(d => Cloud.members[d.id] = d.data());
    renderLeague();
  }));
  Cloud.unsubs.push(fb.onSnapshot(fb.collection(fb.db, "leagues", id, "picks"), s => {
    Cloud.picks = {};
    s.forEach(d => {
      const p = d.data();
      (Cloud.picks[p.uid] = Cloud.picks[p.uid] || {})["m" + p.match] = p;
    });
    renderLeague();
  }));
  // emoji reactions on the leaderboard
  Cloud.reactions = {};
  Cloud.unsubs.push(fb.onSnapshot(fb.collection(fb.db, "leagues", id, "reactions"), s => {
    Cloud.reactions = {};
    s.forEach(d => Cloud.reactions[d.id] = d.data());
    renderLeague();
  }));
  // incoming sticker gifts addressed to me
  Cloud.unsubs.push(fb.onSnapshot(
    fb.query(fb.collection(fb.db, "leagues", id, "gifts"), fb.where("to", "==", Cloud.user.uid)),
    async s => {
      for (const d of s.docs) {
        const g = d.data();
        if (window.Extras && Extras.applyIncomingGift) Extras.applyIncomingGift(g.key);
        await fb.deleteDoc(d.ref).catch(() => {});
      }
    }));
  // pull my cloud-saved sticker collection + avatar
  try {
    const c = await fb.getDoc(fb.doc(fb.db, "collections", Cloud.user.uid));
    if (c.exists() && window.Extras && Extras.loadCloudCollection) Extras.loadCloudCollection(c.data().col || {}, c.data().avatar);
  } catch {}
}

/* ───────── stickers: cloud mirror + gifting ───────── */
Cloud.saveCollection = async function (col, avatar) {
  if (!Cloud.on || !Cloud.user) return;
  try { await fb.setDoc(fb.doc(fb.db, "collections", Cloud.user.uid), { col, avatar: avatar || null, at: fb.serverTimestamp() }); } catch {}
};
Cloud.pushAvatar = async function (avatar) {
  if (!Cloud.on || !Cloud.user) return;
  try {
    await fb.setDoc(fb.doc(fb.db, "users", Cloud.user.uid), { avatar }, { merge: true });
    if (Cloud.profile?.leagueId)
      await fb.setDoc(fb.doc(fb.db, "leagues", Cloud.profile.leagueId, "members", Cloud.user.uid), { avatar }, { merge: true });
  } catch {}
};
Cloud.openGiftPicker = function (key) {
  const lid = Cloud.profile.leagueId;
  const friends = Object.entries(Cloud.members).filter(([uid]) => uid !== Cloud.user.uid);
  const pl = (window.Extras) ? Extras._players?.find(x => x.key === key) : null;
  const name = pl ? pl.p.name : "this sticker";
  if (!friends.length) { toast("No league friends yet — invite some on the League tab!"); return; }
  document.querySelector("#team-modal").innerHTML = `<div class="tm-head" style="background:#00897b">
    <h2>🎁 Send ${escC(name)} to…</h2><button class="tm-close" data-act="close-modal">✕</button></div>
    <div class="gift-list">${friends.map(([uid, m]) =>
      `<button class="gift-friend" data-act="gift-send" data-uid="${uid}" data-key="${escC(key)}">
        ${(m.avatar && m.avatar.mascot) || "⚽"} ${escC(m.displayName)}</button>`).join("")}</div>`;
  document.querySelector("#modal-backdrop").classList.remove("hidden");
};
async function sendGift(toUid, key) {
  const lid = Cloud.profile.leagueId;
  try {
    await fb.addDoc(fb.collection(fb.db, "leagues", lid, "gifts"),
      { from: Cloud.user.uid, fromName: Cloud.profile.displayName, to: toUid, key, at: fb.serverTimestamp() });
    if (window.Extras && Extras.removeForGift) Extras.removeForGift(key);
    document.querySelector("#modal-backdrop").classList.add("hidden");
    cloudToast("🎁 Sticker sent! It'll pop into their Album.");
  } catch (e) { cloudToast("Couldn't send: " + e.message); }
}
async function reactTo(uid, emoji) {
  const lid = Cloud.profile.leagueId;
  try {
    await fb.setDoc(fb.doc(fb.db, "leagues", lid, "reactions", uid),
      { [emoji]: fb.increment(1) }, { merge: true });
    if (window.sfx) sfx("tick");
  } catch {}
}
/* who scored the most points from matches that finished TODAY */
function matchdayMVP() {
  if (!window.App || !App.schedule) return null;
  const today = new Date().toISOString().slice(0, 10);
  const groupNums = new Set(App.schedule.groupMatches.map(m => m.match));
  const todayMatchNums = new Set();
  for (const m of App.schedule.groupMatches) if (m.date === today) todayMatchNums.add(m.match);
  for (const arr of [App.schedule.knockout.R32, App.schedule.knockout.R16, App.schedule.knockout.QF, App.schedule.knockout.SF])
    for (const m of arr) if (m.date === today) todayMatchNums.add(m.match);
  if (!todayMatchNums.size) return null;
  let best = null;
  for (const [uid, m] of Object.entries(Cloud.members)) {
    let pts = 0, any = false;
    const picks = Cloud.picks[uid] || {};
    for (const num of todayMatchNums) {
      const real = App.state.real["m" + num];
      if (!real || real.live) continue;
      const s = scorePick(picks["m" + num], real, groupNums.has(num));
      if (s != null) { pts += s; any = true; }
    }
    if (any && (!best || pts > best.pts)) best = { uid, name: m.displayName, pts };
  }
  return best && best.pts > 0 ? best : null;
}

/* ───────── pick submission (called from app.js on every local pick) ───────── */
Cloud.submitPick = function (matchNum, rec) {
  if (!Cloud.on || !Cloud.user || !Cloud.profile?.leagueId) return;
  const info = window.lockInfo ? lockInfo(matchNum) : { locked: false };
  if (info.locked) return; // app.js already told the user
  Cloud.queue[matchNum] = rec;
  clearTimeout(Cloud._flushT);
  Cloud._flushT = setTimeout(flushQueue, 900);
};
async function flushQueue() {
  const q = Cloud.queue; Cloud.queue = {};
  for (const [num, rec] of Object.entries(q)) {
    const data = { uid: Cloud.user.uid, match: Number(num), at: fb.serverTimestamp() };
    if (rec && rec.h != null) { data.h = rec.h; data.a = rec.a; }
    if (rec && rec.winner) data.winner = rec.winner;
    try {
      if (rec) await fb.setDoc(fb.doc(fb.db, "leagues", Cloud.profile.leagueId, "picks", Cloud.user.uid + "_m" + num), data);
      else await fb.deleteDoc(fb.doc(fb.db, "leagues", Cloud.profile.leagueId, "picks", Cloud.user.uid + "_m" + num));
    } catch (e) {
      cloudToast("🔒 Too late for that one — kickoff is too close! The referee (server) said no.");
    }
  }
}

/* ───────── scoring ───────── */
function scorePick(pick, real, isGroup) {
  if (!pick || !real) return null;
  if (isGroup && pick.h != null && real.h != null) {
    if (pick.h === real.h && pick.a === real.a) return 3;
    return Math.sign(pick.h - pick.a) === Math.sign(real.h - real.a) ? 1 : 0;
  }
  if (!isGroup && pick.winner && real.winner) return pick.winner === real.winner ? 1 : 0;
  return null;
}
function memberTotals() {
  const groupNums = new Set(App.schedule.groupMatches.map(m => m.match));
  const rows = [];
  for (const [uid, m] of Object.entries(Cloud.members)) {
    let pts = 0, exact = 0, scored = 0, made = 0;
    const picks = Cloud.picks[uid] || {};
    for (const [k, p] of Object.entries(picks)) {
      made++;
      const num = Number(k.slice(1));
      const real = App.state.real[k];
      if (!real || real.live) continue;
      const s = scorePick(p, real, groupNums.has(num));
      if (s != null) { pts += s; scored++; if (s === 3) exact++; }
    }
    rows.push({ uid, name: m.displayName, pts, exact, scored, made });
  }
  rows.sort((a, b) => b.pts - a.pts || b.exact - a.exact || a.name.localeCompare(b.name));
  return rows;
}

/* ───────── admin ───────── */
async function adminRemove(uid, uname) {
  if (!Cloud.profile?.isAdmin) return;
  const lid = Cloud.profile.leagueId;
  await fb.setDoc(fb.doc(fb.db, "banned", uid), { by: Cloud.user.uid, at: fb.serverTimestamp() });
  const batch = fb.writeBatch(fb.db);
  batch.delete(fb.doc(fb.db, "users", uid));
  if (uname) batch.delete(fb.doc(fb.db, "usernames", uname));
  if (lid) batch.delete(fb.doc(fb.db, "leagues", lid, "members", uid));
  for (const k of Object.keys(Cloud.picks[uid] || {})) {
    batch.delete(fb.doc(fb.db, "leagues", lid, "picks", uid + "_" + k));
  }
  await batch.commit();
  cloudToast("🗑️ Account removed and banned.");
}
async function adminSeedDeadlines() {
  if (!Cloud.profile?.isAdmin) return;
  const data = {};
  for (const [num, iso] of Object.entries(App.kickoffs || {})) data["m" + num] = new Date(iso).getTime();
  if (!Object.keys(data).length) { cloudToast("No kickoff times in the feed yet — try after a Sync."); return; }
  await fb.setDoc(fb.doc(fb.db, "config", "deadlines"), data, { merge: true });
  cloudToast(`⏱️ ${Object.keys(data).length} kickoff deadlines locked into the server.`);
}
async function bootstrapSetup(adminUsername) {
  await fb.setDoc(fb.doc(fb.db, "config", "setup"), { adminUsername: cleanUsername(adminUsername) });
}

/* ───────── league tab UI ───────── */
function cloudToast(msg) { if (window.toast) toast(msg); }

function renderLeague() {
  const el = $c("#view-league");
  if (!el) return;

  if (!Cloud.on) {
    el.innerHTML = `<div class="champ-empty">☁️ <b>Connecting to league play…</b><br>
      If this sticks around, your game loaded an old cached copy. Tap below to grab the latest!<br>
      <button class="sim-btn gold" data-act="lg-hardreload" style="margin-top:14px">🔄 RELOAD THE GAME</button></div>`;
    return;
  }
  if (!Cloud.user || !Cloud.profile) {
    el.innerHTML = `<div class="lg-auth group-card">
      <h2>👥 JOIN THE LEAGUE!</h2>
      <div class="lg-form">
        <p class="setting-help">Make up a fun username (letters & numbers only — no real names needed!)
        and a secret 6-digit PIN. Write the PIN down somewhere safe!</p>
        <input id="lg-user" maxlength="15" placeholder="username, e.g. goal_machine9" autocomplete="off">
        <input id="lg-pin" maxlength="6" inputmode="numeric" placeholder="6-digit PIN" autocomplete="off">
        <input id="lg-display" maxlength="20" placeholder="display name (optional)" autocomplete="off">
        <div class="row">
          <button class="sim-btn gold" data-act="lg-signup">⭐ CREATE ACCOUNT</button>
          <button class="sim-btn" data-act="lg-signin">🔑 SIGN IN</button>
        </div>
        <p id="lg-err" class="lg-err"></p>
      </div></div>`;
    return;
  }
  if (!Cloud.league) {
    el.innerHTML = `<div class="lg-auth group-card">
      <h2>👋 HI ${escC(Cloud.profile.displayName).toUpperCase()}!</h2>
      <div class="lg-form">
        <p class="setting-help">Start a league and share the code, or join a friend's league.</p>
        <input id="lg-lname" maxlength="30" placeholder="new league name, e.g. RECESS LEGENDS">
        <button class="sim-btn gold" data-act="lg-create">🏟️ CREATE LEAGUE</button>
        <div class="lg-or">— or —</div>
        <input id="lg-code" maxlength="6" placeholder="6-letter invite code" style="text-transform:uppercase">
        <button class="sim-btn" data-act="lg-join">🎟️ JOIN WITH CODE</button>
        <p id="lg-err" class="lg-err"></p>
        <button class="btn-plain lg-out" data-act="lg-signout">Sign out</button>
      </div></div>`;
    return;
  }

  const rows = memberTotals();
  const medals = ["🥇", "🥈", "🥉"];
  const REACTS = ["🔥", "⚽", "😂", "😱", "👏"];
  const av = uid => (Cloud.members[uid] && Cloud.members[uid].avatar) || null;
  const chip = uid => { const a = av(uid); return `<span class="mini-av" style="--kit:${a && a.kit || "#1877d2"}">${a && a.mascot || "⚽"}</span>`; };
  const mvp = matchdayMVP();
  let html = `<div class="lg-wrap">`;
  if (mvp) html += `<div class="mvp-banner">⭐ Today's MVP: ${chip(mvp.uid)} <b>${escC(mvp.name)}</b> with ${mvp.pts} pts! 🏅</div>`;
  html += `<div class="group-card lg-card"><h2>🏟️ ${escC(Cloud.league.name).toUpperCase()}</h2>
      <div class="lg-codebar">Invite code: <b class="lg-code">${escC(Cloud.league.code)}</b>
        <span class="setting-help">friends: open the game → 👥 League → Join with code</span></div>
      <table class="standings"><tr><th></th><th>Player</th><th>Pts</th><th>🎯 Exact</th><th>Picks</th></tr>
      ${rows.map((r, i) => {
        const rc = Cloud.reactions[r.uid] || {};
        const rsum = REACTS.map(em => rc[em] ? `${em}${rc[em]}` : "").filter(Boolean).join(" ");
        return `<tr class="${r.uid === Cloud.user.uid ? "q1" : ""}">
        <td>${medals[i] || i + 1}</td>
        <td class="teamcell lg-member" data-uid="${r.uid}">${chip(r.uid)} ${escC(r.name)}${r.uid === Cloud.user.uid ? " (you)" : ""}
          ${rsum ? `<span class="react-sum">${rsum}</span>` : ""}</td>
        <td class="pts">${r.pts}</td><td>${r.exact}</td><td>${r.made}</td></tr>`;
      }).join("")}
      </table>
      <div class="react-bar">React to friends: ${REACTS.map(em =>
        `<button class="react-btn" data-act="lg-react" data-em="${em}">${em}</button>`).join("")}
        <span class="setting-help" id="react-target">pick a player above, then tap an emoji</span></div>
      <p class="sc-help">Tap a player to peek at their picks 👀 (upcoming picks stay secret until kickoff lock!).
      Scoring: 🎯 exact score 3 pts · ✅ right result 1 pt · bracket pick 1 pt.</p>
    </div>
    <div id="lg-peek"></div>`;

  if (Cloud.profile.isAdmin) {
    html += `<div class="group-card lg-card lg-admin"><h2>🛡️ ADMIN</h2><div class="lg-form">
      <p class="setting-help">Remove cheaters/duplicate accounts (bans the account and deletes its picks),
      and push kickoff deadlines to the server so late picks are rejected for everyone.</p>
      <button class="btn-plain" data-act="lg-seed">⏱️ Sync kickoff deadlines to server</button>
      ${rows.filter(r => r.uid !== Cloud.user.uid).map(r =>
        `<div class="slot-row"><b>${escC(r.name)}</b>
         <button class="wipe-btn lg-del" data-act="lg-remove" data-uid="${r.uid}">🗑️ Remove & ban</button></div>`).join("") ||
        '<p class="setting-help">No other members yet.</p>'}
    </div></div>`;
  }
  html += `<button class="btn-plain lg-out" data-act="lg-signout">Sign out (${escC(Cloud.profile.username)})</button></div>`;
  el.innerHTML = html;
}

function renderPeek(uid) {
  const el = $c("#lg-peek");
  if (!el) return;
  const m = Cloud.members[uid];
  const picks = Cloud.picks[uid] || {};
  const groupNums = new Set(App.schedule.groupMatches.map(x => x.match));
  const rows = Object.entries(picks).map(([k, p]) => ({ num: Number(k.slice(1)), p }))
    .sort((a, b) => a.num - b.num);
  const visible = rows.filter(({ num }) => {
    const li = lockInfo(num);
    return li.locked || App.state.real["m" + num]; // hidden until lock
  });
  const hidden = rows.length - visible.length;
  el.innerHTML = `<div class="group-card lg-card"><h2>👀 ${escC(m?.displayName || "?")}'S PICKS</h2>
    ${visible.length ? `<div class="match-list">${visible.map(({ num, p }) => {
      const gm = App.schedule.groupMatches.find(x => x.match === num);
      const label = gm ? `${team(gm.home).flag} ${team(gm.home).code} – ${team(gm.away).code} ${team(gm.away).flag}` : `KO M${num}`;
      const real = App.state.real["m" + num];
      const s = real && !real.live ? scorePick(p, real, groupNums.has(num)) : null;
      const badge = s == null ? "" : s === 3 ? '<span class="chip real">🎯 3</span>' : s === 1 ? '<span class="chip pick">✅ 1</span>' : '<span class="chip whatif">❌ 0</span>';
      const pickTxt = p.h != null ? `${p.h}–${p.a}` : (p.winner ? team(p.winner).flag + " through" : "—");
      return `<div class="match-row lg-pickrow"><span>${label}</span><b>${pickTxt}</b>
        <span>${real && real.h != null ? "real " + real.h + "–" + real.a : ""}</span><span>${badge}</span></div>`;
    }).join("")}</div>` : '<p class="sc-help" style="padding:14px">Nothing to show yet!</p>'}
    ${hidden ? `<p class="sc-help" style="padding:0 14px 12px">🙈 ${hidden} upcoming pick${hidden > 1 ? "s" : ""} hidden until kickoff lock.</p>` : ""}
  </div>`;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ───────── events ───────── */
function err(msg) { const e = $c("#lg-err"); if (e) e.textContent = msg; }
document.body.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  const act = el?.dataset.act;
  if (act === "lg-hardreload") {
    location.replace(location.pathname + "?fresh=" + Date.now());
    return;
  }
  if (act === "gift-send") { await sendGift(el.dataset.uid, el.dataset.key); return; }
  if (act === "lg-react") {
    if (!Cloud._reactTarget) { cloudToast("Tap a player's name first, then the emoji! 👆"); return; }
    await reactTo(Cloud._reactTarget, el.dataset.em); return;
  }
  if (!act || !act.startsWith("lg-")) {
    const member = e.target.closest(".lg-member[data-uid]");
    if (member) {
      Cloud._reactTarget = member.dataset.uid;
      const t = $c("#react-target");
      if (t) t.textContent = "reacting to " + ((Cloud.members[member.dataset.uid] || {}).displayName || "player") + " — tap an emoji!";
      renderPeek(member.dataset.uid);
    }
    return;
  }
  try {
    if (act === "lg-signup") await signUp($c("#lg-user").value, $c("#lg-pin").value, $c("#lg-display").value);
    if (act === "lg-signin") await signIn($c("#lg-user").value, $c("#lg-pin").value);
    if (act === "lg-create") { const code = await createLeague($c("#lg-lname").value); cloudToast(`🏟️ League created! Invite code: ${code}`); }
    if (act === "lg-join") await joinLeagueByCode($c("#lg-code").value);
    if (act === "lg-signout") { detachLeague(); await fb.signOut(fb.auth); }
    if (act === "lg-seed") await adminSeedDeadlines();
    if (act === "lg-remove") {
      const uid = el.dataset.uid;
      const uname = Object.entries(Cloud.members).find(([id]) => id === uid)?.[1]?.username;
      const userDoc = await fb.getDoc(fb.doc(fb.db, "users", uid));
      if (confirm("Remove & ban this account? Their picks are deleted too.")) {
        await adminRemove(uid, userDoc.exists() ? userDoc.data().username : uname);
      }
    }
    renderLeague();
  } catch (ex) { err(ex.message); }
});

Cloud.renderLeague = renderLeague;
Cloud.bootstrapSetup = bootstrapSetup;
Cloud.signUpFn = signUp;
/* internal handle — used for provisioning/testing and admin cleanup */
Cloud._api = {
  createLeague, joinLeagueByCode, joinLeagueById, adminRemove, adminSeedDeadlines,
  bootstrapSetup, memberTotals, scorePick, signIn, loadProfile,
  signOut: () => fb.signOut(fb.auth),
  fb: () => fb,
};
initFirebase();
