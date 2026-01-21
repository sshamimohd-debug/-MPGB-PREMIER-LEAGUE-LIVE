import { setActiveNav, loadTournament, esc } from "./util.js";
import { getFB, watchAllMatches } from "./store-fb.js";

setActiveNav("points");
const FB = getFB();

function emptyRow(team, group){
  return {team, group, played:0, won:0, lost:0, tied:0, nr:0, pts:0};
}

function compute(t, matches){
  const map = {};
  for(const [g, teams] of Object.entries(t.groups||{})){
    for(const tm of teams) map[tm]=emptyRow(tm, g);
  }

  for(const m of (matches||[])){
    if(!map[m.a] || !map[m.b]) continue;
    if(m.status!=="COMPLETED") continue;

    map[m.a].played += 1;
    map[m.b].played += 1;

    const winner = m.result?.winner || null; // team name
    const tie = !!m.result?.tie;

    if(tie){
      map[m.a].tied += 1;
      map[m.b].tied += 1;
      map[m.a].pts += 1;
      map[m.b].pts += 1;
    } else if(winner){
      const wTeam = (winner==="A")? m.a : (winner==="B")? m.b : winner;
      const lTeam = (wTeam===m.a)? m.b : m.a;
      if(map[wTeam] && map[lTeam]){
        map[wTeam].won += 1; map[wTeam].pts += 2;
        map[lTeam].lost += 1;
      }
    } else {
      // If scorer didn't set result properly: treat as NR
      map[m.a].nr += 1;
      map[m.b].nr += 1;
      map[m.a].pts += 1;
      map[m.b].pts += 1;
    }
  }

  const byGroup = {};
  for(const row of Object.values(map)) (byGroup[row.group] ||= []).push(row);

  for(const g of Object.keys(byGroup)){
    byGroup[g].sort((x,y)=> (y.pts-x.pts) || (y.won-x.won) || x.team.localeCompare(y.team));
  }

  // Decider detection: if top 2 are tied on points (and wins), show decider needed
  const deciders = {}; // group -> {a,b}
  const winners = {};  // group -> team or null
  for(const [g, rows] of Object.entries(byGroup)){
    const r1 = rows[0], r2 = rows[1];
    if(!r1) continue;
    if(r2 && r1.pts===r2.pts && r1.won===r2.won){
      winners[g] = null;
      deciders[g] = { a:r1.team, b:r2.team };
    } else {
      winners[g] = r1.team;
    }
  }

  return { byGroup, winners, deciders };
}

function renderKnockouts(winners, deciders){
  const A = winners.A || (deciders.A ? "TBD (Decider A)" : "TBD");
  const B = winners.B || (deciders.B ? "TBD (Decider B)" : "TBD");
  const C = winners.C || (deciders.C ? "TBD (Decider C)" : "TBD");
  const D = winners.D || (deciders.D ? "TBD (Decider D)" : "TBD");

  return `
  <div class="card" style="margin-bottom:14px">
    <div class="h1" style="font-size:18px">Knockout (Auto Preview)</div>
    <div class="muted small" style="margin-top:6px">Fixtures are based on current points. If a group needs a Decider, that slot stays TBD.</div>
    <div class="sep"></div>
    <table class="table">
      <thead><tr><th>Match</th><th>Team A</th><th>Team B</th></tr></thead>
      <tbody>
        <tr><td><b>Semi Final 1</b></td><td>${esc(A)}</td><td>${esc(C)}</td></tr>
        <tr><td><b>Semi Final 2</b></td><td>${esc(B)}</td><td>${esc(D)}</td></tr>
        <tr><td><b>Final</b></td><td>${esc("Winner SF1")}</td><td>${esc("Winner SF2")}</td></tr>
      </tbody>
    </table>
  </div>`;
}

function render(byGroup, winners, deciders){
  const wrap = document.getElementById("pointsWrap");
  const ko = renderKnockouts(winners, deciders);

  wrap.innerHTML = ko + Object.entries(byGroup).map(([g, rows])=>{
    const dec = deciders[g];
    const note = dec ? `
      <div class="row" style="margin-top:10px">
        <div class="chip" style="border-color:rgba(255,196,0,.35)">⚠️ Decider needed</div>
        <div class="muted small">${esc(dec.a)} vs ${esc(dec.b)} (same points)</div>
      </div>
    ` : `
      <div class="muted small" style="margin-top:10px">Group Winner: <b>${esc(winners[g]||"-")}</b></div>
    `;

    return `
    <div class="card">
      <div class="h1" style="font-size:18px">Group ${esc(g)}</div>
      <div class="sep"></div>
      <table class="table">
        <thead><tr>
          <th>Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>NR</th><th>Pts</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr>
              <td><b>${esc(r.team)}</b></td>
              <td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.tied}</td><td>${r.nr}</td><td><b>${r.pts}</b></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${note}
      <div class="muted small" style="margin-top:8px">Note: NRR can be added later if required.</div>
    </div>
  `;
  }).join("");
}

(async function(){
  const t = await loadTournament();
  if(!FB){
    document.getElementById("pointsWrap").innerHTML = `<div class="card"><div class="muted small">Firebase not configured.</div></div>`;
    return;
  }
  watchAllMatches(FB, (docs)=>{
    const out = compute(t, docs);
    render(out.byGroup, out.winners, out.deciders);
  });
})();
