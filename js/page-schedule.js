import { setActiveNav, loadTournament, esc, fmtStatus, qs } from "./util.js";
import { getFB, watchAllMatches } from "./store-fb.js";

setActiveNav("schedule");
const FB = getFB();

function renderTabs(groups){
  const wrap = document.getElementById("groupTabs");
  const params = qs();
  const active = params.get("g") || "ALL";
  const tabs = ["ALL", ...Object.keys(groups)];
  wrap.innerHTML = tabs.map(k=>{
    const is = (k===active);
    return `<a class="pill" style="cursor:pointer; border-color:${is?'rgba(106,167,255,.65)':'rgba(255,255,255,.08)'}" href="schedule.html?g=${encodeURIComponent(k)}">${k==="ALL"?"All groups":"Group "+k}</a>`;
  }).join("");
  return active;
}

function groupMatches(t, docs, active){
  const byGroup = {};
  for(const g of Object.keys(t.groups)) byGroup[g]=[];
  for(const m of docs){
    if(byGroup[m.group]) byGroup[m.group].push(m);
  }
  for(const g of Object.keys(byGroup)){
    byGroup[g].sort((a,b)=> a.matchId.localeCompare(b.matchId));
  }
  const groupsToShow = active==="ALL" ? Object.keys(byGroup) : [active].filter(x=>byGroup[x]);
  return {byGroup, groupsToShow};
}

function render(t, docs, active){
  const {byGroup, groupsToShow} = groupMatches(t, docs, active);
  const wrap = document.getElementById("scheduleWrap");

  // Mobile-first card list (Cricbuzz style). Keep data flow same.
  const matchCard = (m, labelOverride="")=>{
    const st = fmtStatus(m.status);
    const href = `summary.html?match=${encodeURIComponent(m.matchId)}`;
    const right = (m.status==="LIVE") ? `<span class="badge live">LIVE</span>` : `<span class="badge ${st.cls}">${st.text}</span>`;
    const when = esc(m.time||"-");
    const label = labelOverride || (m.group ? `Group ${esc(m.group)}` : "");
    const a = esc(m.a||"TBD"), b = esc(m.b||"TBD");
    return `
      <a class="matchCard" href="${href}" style="text-decoration:none">
        <div class="mcTop">
          <div class="mcLeft">
            <div class="mcId"><span class="tag">${esc(m.matchId)}</span> <span class="mcLbl">${label}</span></div>
            <div class="mcTeams"><b>${a}</b> <span class="muted">vs</span> <b>${b}</b></div>
            <div class="mcMeta muted small">🕒 ${when}</div>
          </div>
          <div class="mcRight">${right}</div>
        </div>
      </a>`;
  };

  const groupCards = groupsToShow.map(g=>{
    const list = (byGroup[g]||[]).map(m=> matchCard(m, `Group ${esc(g)}`)).join("");
    return `
      <div class="card" style="margin-top:14px">
        <div class="row wrap" style="justify-content:space-between">
          <div>
            <div class="h1" style="font-size:18px">Group ${esc(g)}</div>
            <div class="muted small">${byGroup[g].length} matches</div>
          </div>
        </div>
        <div class="sep"></div>
        <div class="mcList">${list || `<div class="muted small">No matches</div>`}</div>
      </div>`;
  }).join("");

  // Knockouts / Deciders (group not in A-D)
  const knownGroups = new Set(Object.keys(t.groups||{}));
  const ko = (docs||[]).filter(m=> !knownGroups.has(String(m.group||"")) );
  ko.sort((a,b)=> String(a.matchId||"").localeCompare(String(b.matchId||"")) );
  const koCard = ko.length? (()=>{
    const list = ko.map(m=>{
      const label = m.label || (m.stage==="SF"?"Semi Final": m.stage==="F"?"Final": (m.stage||"Knockout"));
      return matchCard(m, esc(label));
    }).join("");

    return `
      <div class="card" style="margin-top:14px">
        <div class="row wrap" style="justify-content:space-between">
          <div>
            <div class="h1" style="font-size:18px">Knockouts</div>
            <div class="muted small">${ko.length} matches</div>
          </div>
        </div>
        <div class="sep"></div>
        <div class="mcList">${list}</div>
      </div>`;
  })() : "";

  wrap.innerHTML = groupCards + koCard;
}

(async function(){
  const t = await loadTournament();
  const active = renderTabs(t.groups);
  if(!FB){
    document.getElementById("scheduleWrap").innerHTML = `<div class="card"><div class="muted small">Firebase not configured.</div></div>`;
    return;
  }
  watchAllMatches(FB, (docs)=> render(t, docs, active));
})();
