import { setActiveNav, loadTournament, esc, persistLastMatchId } from "./util.js";
import { getFB, watchAllMatches } from "./store-fb.js";
import { firebaseReady } from "./firebase.js";

setActiveNav("home");

const FB = getFB();


function wireInfoModal(){
  const btn = document.getElementById("btnInfo");
  const modal = document.getElementById("infoModal");
  if(!btn || !modal) return;

  const open = ()=>{
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    document.body.classList.add("modalOpen");
  };
  const close = ()=>{
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden","true");
    document.body.classList.remove("modalOpen");
  };

  btn.addEventListener("click", open);
  modal.querySelectorAll('[data-close="1"]').forEach(el=> el.addEventListener("click", close));
  window.addEventListener("keydown", (e)=>{ if(e.key==="Escape") close(); });
}

function badgeState(){
  const el = document.getElementById("fbState");
  if(!firebaseReady()){
    el.className = "badge up";
    el.textContent = "Firebase: not configured";
  } else {
    el.className = "badge done";
    el.textContent = "Firebase: connected";
  }
}

function renderStatic(t){
  // Keep header meta small (shown on hero)
  document.getElementById("tMeta").textContent = `${t.dates} • ${t.oversPerInnings} overs/innings • Powerplay ${t.powerplayOvers} overs • Max ${t.maxOversPerBowler} overs/bowler`;

  // Move KPIs into Info modal (reduces clutter on home)
  const infoMeta = document.getElementById("infoMeta");
  if(infoMeta) infoMeta.textContent = `${t.dates} • ${t.oversPerInnings} overs/innings • Powerplay ${t.powerplayOvers} overs • Max ${t.maxOversPerBowler} overs/bowler`;

  const infoKpi = document.getElementById("infoKpi");
  if(infoKpi){
    infoKpi.innerHTML = [
      `<span class="pill"><b>${Object.values(t.groups).flat().length}</b> teams</span>`,
      `<span class="pill"><b>${Object.keys(t.groups).length}</b> groups</span>`,
      `<span class="pill"><b>${t.oversPerInnings}</b> overs/innings</span>`,
      `<span class="pill">Powerplay: <b>${t.powerplayOvers}</b> overs</span>`,
      `<span class="pill">Ball: <b>${esc(t.ball)}</b></span>`
    ].join("");
  }

  const rules = [
    `No LBW`,
    `Tie → Super Over (repeat until result)`,
    `Wide at umpire's discretion`,
    `No-ball for front-foot`
  ];
  const rl = document.getElementById("rulesList");
  if(rl){
    rl.innerHTML = rules.map(r=>`<div class="item"><div class="left"><span class="tag">RULE</span><div>${esc(r)}</div></div></div>`).join("");
  }
}


function renderFromMatches(t, docs){
<<<<<<< HEAD
  // Render list using Live / Upcoming / Completed tabs (mobile app style)
  window.__HOME_MATCHES__ = docs || [];
  // Keep other tabs (Live/Scorecard) in-sync even when user opens them
  // from bottom navigation without selecting a match.
  try{
    const all = window.__HOME_MATCHES__;
    const pickLive = all.filter(m=>m.status==='LIVE')
      .sort((a,b)=> (b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0))[0];
    const pickUp = all.filter(m=>m.status!=='LIVE' && m.status!=='COMPLETED')
      .sort((a,b)=> (a.matchId||'').localeCompare(b.matchId||''))[0];
    const pickDone = all.filter(m=>m.status==='COMPLETED')
      .sort((a,b)=> (b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0))[0];
    const best = pickLive || pickUp || pickDone;
    if(best?.matchId) persistLastMatchId(best.matchId);
  }catch(e){}
  renderHomeTab(window.__HOME_ACTIVE_TAB__ || "LIVE");
}
=======
  // live: any LIVE, choose latest updated
  const live = docs.filter(d=>d.status==="LIVE");
  live.sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
  const liveBox = document.getElementById("liveBox");
>>>>>>> 1fc36c5134207650797bb5b0cdb4221f8a759d44

  if(live.length===0){
    liveBox.innerHTML = `<div class="muted small">No live match right now.</div>`;
  } else {
    const m = live[0];
    const sum = m.summary || {};
    liveBox.innerHTML = `
      <div class="item">
        <div class="left">
          <span class="badge live">🔴 LIVE</span>
          <div>
            <div><b>${esc(m.a)} vs ${esc(m.b)}</b> <span class="muted small">• Group ${esc(m.group)} • ${esc(m.time)}</span></div>
            <div class="muted small">${esc(sum.batting||m.a)}: <b>${esc(sum.scoreText||"0/0")}</b> <span class="muted">(${esc(sum.oversText||"0.0/10")})</span> • RR ${esc(sum.rr||0)}</div>
          </div>
        </div>
        <div class="kpi">
          <a class="btn" href="summary.html?match=${encodeURIComponent(m.matchId)}">Live</a>
          <a class="btn ghost" href="live.html?match=${encodeURIComponent(m.matchId)}">Ball-by-ball</a>
        </div>
      </div>
    `;
  }

  // upcoming: earliest by matchId order but only UPCOMING
  const upcoming = docs.filter(d=>d.status!=="COMPLETED" && d.status!=="LIVE");
  upcoming.sort((a,b)=> a.matchId.localeCompare(b.matchId));
  const upEl = document.getElementById("upcomingList");
  upEl.innerHTML = upcoming.slice(0,10).map(m=>`
    <div class="item">
      <div class="left">
        <span class="badge up">🕒 UPCOMING</span>
        <div>
          <div><b>${esc(m.a)} vs ${esc(m.b)}</b></div>
          <div class="muted small">Group ${esc(m.group)} • ${esc(m.time)} • Match ${esc(m.matchId)}</div>
        </div>
      </div>
      <a class="btn ghost" href="summary.html?match=${encodeURIComponent(m.matchId)}">Open</a>
    </div>
  `).join("") || `<div class="muted small">No upcoming fixtures found.</div>`;

  const recent = docs.filter(d=>d.status==="COMPLETED");
  recent.sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
  const rEl = document.getElementById("recentList");
  rEl.innerHTML = recent.slice(0,6).map(m=>`
    <div class="item">
      <div class="left">
        <span class="badge done">✅ DONE</span>
        <div>
          <div><b>${esc(m.a)} vs ${esc(m.b)}</b></div>
          <div class="muted small">Match ${esc(m.matchId)} • Group ${esc(m.group)} • ${esc(m.time)}</div>
        </div>
      </div>
      <a class="btn ghost" href="summary.html?match=${encodeURIComponent(m.matchId)}">Summary</a>
    </div>
  `).join("") || `<div class="muted small">No completed matches yet.</div>`;
}

(async function(){
  badgeState();
  wireInfoModal();
  const t = await loadTournament();
  renderStatic(t);

  if(!FB){
    document.getElementById("liveBox").textContent = "Firebase not configured. Configure js/firebase-config.js and redeploy.";
    return;
  }

  watchAllMatches(FB, (docs)=> renderFromMatches(t, docs));
})();
