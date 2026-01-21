import { setActiveNav, loadTournament, esc } from "./util.js";
setActiveNav("teams");

(async function(){
  const t = await loadTournament();
  const wrap = document.getElementById("teamsWrap");
  wrap.innerHTML = Object.entries(t.groups).map(([g, teams])=>`
    <div class="card">
      <div class="h1" style="font-size:18px">Group ${esc(g)}</div>
      <div class="sep"></div>
      <div class="list">
        ${teams.map(tm=>`<div class="item">
          <div class="left">
            <span class="tag">TEAM</span>
            <div><b>${esc(tm)}</b></div>
          </div>
          <div class="row" style="gap:8px">
            <a class="chip" href="stats.html?team=${encodeURIComponent(tm)}&view=squad" style="text-decoration:none">Squad</a>
            <a class="chip" href="stats.html?team=${encodeURIComponent(tm)}&view=stats" style="text-decoration:none">Statistics</a>
          </div>
        </div>`).join("")}
      </div>
    </div>
  `).join("");
})();
