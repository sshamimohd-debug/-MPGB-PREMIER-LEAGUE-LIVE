import { setActiveNav, loadTournament, esc } from "./util.js";
setActiveNav("venues");

(async function(){
  const t = await loadTournament();
  const wrap = document.getElementById("venuesWrap");
  wrap.innerHTML = t.venues.map(v=>`
    <div class="card">
      <div class="h1" style="font-size:18px">${esc(v)}</div>
      <div class="muted small">Official venue for inter-regional matches.</div>
      <div class="sep"></div>
      <div class="muted small">Maps/ground details can be added later.</div>
    </div>
  `).join("");
})();
