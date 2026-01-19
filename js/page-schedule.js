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

  const groupCards = groupsToShow.map(g=>{
    const rows = byGroup[g].map(m=>{
      const st = fmtStatus(m.status);
      const action = m.status==="LIVE"
        ? `<a class="btn" href="summary.html?match=${encodeURIComponent(m.matchId)}">Live</a>`
        : `<a class="btn ghost" href="summary.html?match=${encodeURIComponent(m.matchId)}">${m.status==="COMPLETED"?"Summary":"Open"}</a>`;
      return `
      <tr>
        <td><span class="tag">${esc(m.matchId)}</span></td>
        <td>Group ${esc(m.group)}</td>
        <td><b>${esc(m.time||"-")}</b></td>
        <td><b>${esc(m.a||"-")}</b></td>
        <td><b>${esc(m.b||"-")}</b></td>
        <td><span class="badge ${st.cls}">${st.text}</span></td>
        <td>${action}</td>
      </tr>`;
    }).join("");

    return `
      <div class="card" style="margin-top:14px">
        <div class="row wrap">
          <div>
            <div class="h1" style="font-size:18px">Group ${esc(g)}</div>
            <div class="muted small">${byGroup[g].length} matches</div>
          </div>
        </div>
        <div class="sep"></div>
        <table class="table">
          <thead>
            <tr>
              <th>Match</th><th>Group</th><th>Time</th><th>Team A</th><th>Team B</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  // Knockouts / Deciders (group not in A-D)
  const knownGroups = new Set(Object.keys(t.groups||{}));
  const ko = (docs||[]).filter(m=> !knownGroups.has(String(m.group||"")) );
  ko.sort((a,b)=> String(a.matchId||"").localeCompare(String(b.matchId||"")) );
  const koCard = ko.length? (()=>{
    const rows = ko.map(m=>{
      const st = fmtStatus(m.status);
      const label = m.label || (m.stage==="SF"?"Semi Final": m.stage==="F"?"Final": (m.stage||"Knockout"));
      const action = m.status==="LIVE"
        ? `<a class="btn" href="summary.html?match=${encodeURIComponent(m.matchId)}">Live</a>`
        : `<a class="btn ghost" href="summary.html?match=${encodeURIComponent(m.matchId)}">${m.status==="COMPLETED"?"Summary":"Open"}</a>`;
      return `
      <tr>
        <td><span class="tag">${esc(m.matchId)}</span></td>
        <td>${esc(label)}</td>
        <td><b>${esc(m.time||"-")}</b></td>
        <td><b>${esc(m.a||"TBD")}</b></td>
        <td><b>${esc(m.b||"TBD")}</b></td>
        <td><span class="badge ${st.cls}">${st.text}</span></td>
        <td>${action}</td>
      </tr>`;
    }).join("");

    return `
      <div class="card" style="margin-top:14px">
        <div class="row wrap">
          <div>
            <div class="h1" style="font-size:18px">Knockouts</div>
            <div class="muted small">${ko.length} matches</div>
          </div>
        </div>
        <div class="sep"></div>
        <table class="table">
          <thead>
            <tr>
              <th>Match</th><th>Stage</th><th>Time</th><th>Team A</th><th>Team B</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
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
