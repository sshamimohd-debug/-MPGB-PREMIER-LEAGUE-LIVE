import { setActiveNav, loadTournament, esc, persistLastMatchId, wireBottomNav } from "./util.js";
import { getFB, watchAllMatches } from "./store-fb.js";
import { firebaseReady } from "./firebase.js";

setActiveNav("home");

const FB = getFB();

// Home: Match tabs (UI-only)
let ACTIVE_TAB = "live"; // live | upcoming | completed

function normStatus(raw){
  const s = (raw||"").toString().trim().toUpperCase();
  // LIVE variants
  if(s.includes("LIVE") || s.includes("IN_PROGRESS") || s.includes("INPROGRESS") || s.includes("RUNNING")) return "LIVE";
  // COMPLETED variants
  if(s.includes("COMPLETED") || s.includes("FINISHED") || s.includes("RESULT") || s.includes("DONE")) return "COMPLETED";
  // UPCOMING variants
  if(s.includes("UPCOMING") || s.includes("SCHEDULED") || s.includes("FIXTURE")) return "UPCOMING";
  // Fallbacks
  return s || "UPCOMING";
}

function wireMatchTabs(){
  const wrap = document.querySelector(".segTabs");
  if(!wrap) return;
  const buttons = Array.from(wrap.querySelectorAll(".segBtn[data-tab]"));
  const setTab = (tab)=>{
    ACTIVE_TAB = tab;
    buttons.forEach(b=>{
      const on = (b.dataset.tab === tab);
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  };
  buttons.forEach(b=>{
    b.addEventListener("click", ()=> setTab(b.dataset.tab));
  });
  setTab(ACTIVE_TAB);
}


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
  // Decide a "best" match for app-wide context:
  // LIVE (latest updated) → else next UPCOMING → else latest COMPLETED.
  const all = Array.isArray(docs) ? docs : [];
  const pickLive = all.filter(m=> normStatus(m.status)==="LIVE")
    .sort((a,b)=> (b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0))[0];
  const pickUp = all.filter(m=>{
      const st = normStatus(m.status);
      return st!=="LIVE" && st!=="COMPLETED";
    })
    .sort((a,b)=> (a.matchId||"").localeCompare(b.matchId||""))[0];
  const pickDone = all.filter(m=> normStatus(m.status)==="COMPLETED")
    .sort((a,b)=> (b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0))[0];
  const best = pickLive || pickUp || pickDone;

  // Persist + wire bottom nav so Scorecard/Live tabs open the same match.
  if(best?.matchId){
    persistLastMatchId(best.matchId);
    wireBottomNav(best.matchId);
  }


  // Build filtered lists
  const live = all.filter(d=> normStatus(d.status)==="LIVE")
    .sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
  const upcoming = all.filter(d=>{
      const st = normStatus(d.status);
      return st!=="COMPLETED" && st!=="LIVE";
    })
    .sort((a,b)=> (a.matchId||"").localeCompare(b.matchId||""));
  const completed = all.filter(d=> normStatus(d.status)==="COMPLETED")
    .sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));

  const listEl = document.getElementById("matchesList");
  if(!listEl) return;

  const fmtRR = (n)=>{
    const x = Number(n||0);
    if(!isFinite(x)) return "0.00";
    return (Math.round(x*100)/100).toFixed(2);
  };

  const statusBadge = (st)=>{
    if(st==="LIVE") return `<span class="mDot live"></span><span class="mSt live">LIVE</span>`;
    if(st==="COMPLETED") return `<span class="mDot done"></span><span class="mSt done">COMPLETED</span>`;
    return `<span class="mDot up"></span><span class="mSt up">UPCOMING</span>`;
  };

  const resultLine = (m)=>{
    const txt = m?.result?.text || m?.state?.result?.text || m?.summary?.resultText || m?.summary?.result || "";
    return (txt||"").toString().trim();
  };

  const scoreLine = (m)=>{
    const sum = m.summary || {};
    const batting = sum.batting || m.battingFirst || m.a;
    const scoreText = sum.scoreText || "0/0";
    const oversText = sum.oversText || `0.0/${t.oversPerInnings||10}`;
    const rr = (sum.rr!=null) ? fmtRR(sum.rr) : null;
    const rrTxt = rr ? ` • RR ${rr}` : "";
    return `${esc(batting)}: <b>${esc(scoreText)}</b> <span class="muted">(${esc(oversText)})</span>${rrTxt}`;
  };

  const matchRow = (m)=>{
    const st = normStatus(m.status);
    const sum = m.summary || {};
    const res = resultLine(m);
    const sub = (st==="COMPLETED" && res)
      ? `<div class="mSub done">${esc(res)}</div>`
      : (st==="LIVE")
        ? `<div class="mSub">${scoreLine(m)}</div>`
        : `<div class="mSub">Group ${esc(m.group)} • ${esc(m.time)} • Match ${esc(m.matchId)}</div>`;

    const right = (st==="LIVE")
      ? `<div class="mActions">
           <a class="mBtn" href="summary.html?match=${encodeURIComponent(m.matchId)}">Open</a>
           <a class="mBtn ghost" href="live.html?match=${encodeURIComponent(m.matchId)}">Live</a>
         </div>`
      : `<div class="mActions">
           <a class="mBtn" href="summary.html?match=${encodeURIComponent(m.matchId)}">Open</a>
         </div>`;

    return `
      <div class="mRow">
        <div class="mL">
          <div class="mTop">${statusBadge(st)}<span class="mMeta">${esc(m.group||"")}${m.group?" • ":""}${esc(m.time||"")}</span></div>
          <div class="mTeams"><b>${esc(m.a)}</b> <span class="vs">vs</span> <b>${esc(m.b)}</b></div>
          ${sub}
        </div>
        ${right}
      </div>
    `;
  };

  const renderTab = ()=>{
    const tab = (ACTIVE_TAB||"live").toLowerCase();
    const list = (tab==="completed") ? completed : (tab==="upcoming") ? upcoming : live;

    if(list.length===0){
      const msg = (tab==="completed") ? "No completed matches yet." : (tab==="upcoming") ? "No upcoming fixtures found." : "No live match right now.";
      listEl.innerHTML = `<div class="muted small">${esc(msg)}</div>`;
      return;
    }

    const limit = (tab==="live") ? 8 : (tab==="upcoming") ? 12 : 12;
    listEl.innerHTML = list.slice(0, limit).map(matchRow).join("");
  };

  // Re-render on tab changes
  renderTab();
  // Lightweight tab listener (no extra global state)
  const tabs = document.querySelector(".segTabs");
  if(tabs && !tabs.__wired){
    tabs.__wired = true;
    tabs.addEventListener("click", (e)=>{
      const b = e.target?.closest?.(".segBtn[data-tab]");
      if(!b) return;
      ACTIVE_TAB = (b.dataset.tab||"live");
      renderTab();
    });
  }
}

(async function(){
  badgeState();
  wireInfoModal();
  wireMatchTabs();
  const t = await loadTournament();
  renderStatic(t);

  if(!FB){
    const el = document.getElementById("matchesList");
    if(el) el.textContent = "Firebase not configured. Configure js/firebase-config.js and redeploy.";
    return;
  }

  watchAllMatches(FB, (docs)=> renderFromMatches(t, docs));
})();
