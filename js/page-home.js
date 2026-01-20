import { setActiveNav, loadTournament, esc } from "./util.js";
import { getFB, watchAllMatches } from "./store-fb.js";
import { firebaseReady } from "./firebase.js";

setActiveNav("home");

const FB = getFB();

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
  document.getElementById("tMeta").textContent = `${t.dates} • ${t.oversPerInnings} overs/innings • Powerplay ${t.powerplayOvers} overs • Max ${t.maxOversPerBowler} overs/bowler`;
  const kpi = document.getElementById("kpi");
  kpi.innerHTML = [
    `<span class="pill"><b>${Object.values(t.groups).flat().length}</b> teams</span>`,
    `<span class="pill"><b>${Object.keys(t.groups).length}</b> groups</span>`,
    `<span class="pill"><b>${t.oversPerInnings}</b> overs/innings</span>`,
    `<span class="pill">Powerplay: <b>${t.powerplayOvers}</b> overs</span>`,
    `<span class="pill">Ball: <b>${esc(t.ball)}</b></span>`
  ].join("");
  const rules = [
    `No LBW`,
    `Tie → Super Over (repeat until result)`,
    `Wide at umpire's discretion`,
    `No-ball for front-foot`
  ];
  const rl = document.getElementById("rulesList");
  rl.innerHTML = rules.map(r=>`<div class="item"><div class="left"><span class="tag">RULE</span><div>${esc(r)}</div></div></div>`).join("");
}

function renderFromMatches(t, docs){
  // Render list using Live / Upcoming / Completed tabs (mobile app style)
  window.__HOME_MATCHES__ = docs || [];
  renderHomeTab(window.__HOME_ACTIVE_TAB__ || "LIVE");
}

function getTabEl(){
  return document.getElementById("homeTabs");
}

function setActiveTab(tab){
  window.__HOME_ACTIVE_TAB__ = tab;
  const tabs = getTabEl();
  if(!tabs) return;
  tabs.querySelectorAll(".seg").forEach(btn=>{
    const on = (btn.getAttribute("data-tab")===tab);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function matchBadge(status){
  if(status==="LIVE") return `<span class="badge live">🔴 LIVE</span>`;
  if(status==="COMPLETED") return `<span class="badge done">✅ DONE</span>`;
  return `<span class="badge up">🕒 UPCOMING</span>`;
}

function safeText(v, d="-"){ return (v===undefined || v===null || v==="") ? d : v; }

function renderHomeTab(tab){
  setActiveTab(tab);
  const list = document.getElementById("homeMatchList");
  if(!list) return;
  const docs = window.__HOME_MATCHES__ || [];

  let filtered = [];
  if(tab==="LIVE"){
    filtered = docs.filter(d=>d.status==="LIVE");
    filtered.sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
  } else if(tab==="COMPLETED"){
    filtered = docs.filter(d=>d.status==="COMPLETED");
    filtered.sort((a,b)=> (b.updatedAt?.seconds||0) - (a.updatedAt?.seconds||0));
  } else {
    filtered = docs.filter(d=>d.status!=="LIVE" && d.status!=="COMPLETED");
    filtered.sort((a,b)=> a.matchId.localeCompare(b.matchId));
  }

  if(filtered.length===0){
    list.innerHTML = `<div class="muted small" style="padding:10px 2px">No matches in this tab.</div>`;
    return;
  }

  list.innerHTML = filtered.slice(0, 30).map(m=>{
    const sum = m.summary || {};
    const leftLine = tab==="LIVE"
      ? `${esc(safeText(sum.batting||m.a))}: <b>${esc(safeText(sum.scoreText, "0/0"))}</b> <span class="muted">(${esc(safeText(sum.oversText, "0.0"))})</span>`
      : (tab==="COMPLETED" ? esc(safeText(sum.resultText || sum.result || sum.winnerText || "Result updated")) : `Group ${esc(safeText(m.group))} • ${esc(safeText(m.time))}`);

    const rightChip = tab==="LIVE" ? `<span class="pill" style="border-color:rgba(255,255,255,.18)">RR ${esc(safeText(sum.rr, 0))}</span>` : `<span class="pill">Match <b>${esc(m.matchId)}</b></span>`;

    const actions = tab==="LIVE"
      ? `
        <a class="btn" href="summary.html?match=${encodeURIComponent(m.matchId)}">Open</a>
        <a class="btn ghost" href="live.html?match=${encodeURIComponent(m.matchId)}">Ball-by-ball</a>
      `
      : `
        <a class="btn" href="summary.html?match=${encodeURIComponent(m.matchId)}">Open</a>
        <a class="btn ghost" href="scorecard.html?match=${encodeURIComponent(m.matchId)}">Scorecard</a>
      `;

    return `
      <details class="mCard">
        <summary class="mSum">
          <div class="mLeft">
            ${matchBadge(m.status)}
            <div class="mTeams"><b>${esc(m.a)} vs ${esc(m.b)}</b></div>
            <div class="mMeta">${leftLine}</div>
          </div>
          <div class="mRight">${rightChip}<span class="mChevron" aria-hidden="true">›</span></div>
        </summary>
        <div class="mBody">
          <div class="mBodyGrid">
            <div class="muted small">Group: <b>${esc(safeText(m.group))}</b></div>
            <div class="muted small">Time: <b>${esc(safeText(m.time))}</b></div>
            <div class="muted small">Venue: <b>${esc(safeText(m.venue))}</b></div>
            <div class="muted small">Status: <b>${esc(safeText(m.status))}</b></div>
          </div>
          <div class="mActions">${actions}</div>
        </div>
      </details>
    `;
  }).join("");
}

(async function(){
  badgeState();
  const t = await loadTournament();
  renderStatic(t);

  // Tabs listeners
  try{
    const tabs = getTabEl();
    if(tabs){
      tabs.addEventListener("click", (e)=>{
        const btn = e.target?.closest?.(".seg");
        if(!btn) return;
        renderHomeTab(btn.getAttribute("data-tab") || "LIVE");
      });
    }
  }catch(e){}

  if(!FB){
    const box = document.getElementById("homeMatchList");
    if(box) box.innerHTML = "Firebase not configured. Configure js/firebase-config.js and redeploy.";
    return;
  }

  watchAllMatches(FB, (docs)=> renderFromMatches(t, docs));
})();
