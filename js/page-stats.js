import { setActiveNav, loadTournament, esc, qs } from "./util.js";
import { getFB, watchAllMatches } from "./store-fb.js";

setActiveNav("stats");
const FB = getFB();
const $ = (id)=>document.getElementById(id);

let TOURNAMENT = null;
let ALL_MATCHES = [];

function teamList(t){
  const set = new Set();
  Object.values(t.groups||{}).forEach(arr=>arr.forEach(x=>set.add(x)));
  return Array.from(set);
}

function initTeamPick(){
  const params = qs();
  const pref = params.get("team") || "";
  const view = (params.get("view") || "stats").toLowerCase();

  const teams = teamList(TOURNAMENT);
  const sel = $("teamPick");
  sel.innerHTML = `<option value="">All Teams</option>` + teams.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
  if(pref && teams.includes(pref)) sel.value = pref;

  $("tabStats").addEventListener("click", ()=>setView("stats"));
  $("tabSquad").addEventListener("click", ()=>setView("squad"));
  sel.addEventListener("change", render);

  setView(view);
}

function setView(v){
  const isStats = v!=="squad";
  $("viewStats").style.display = isStats ? "block" : "none";
  $("viewSquad").style.display = isStats ? "none" : "block";
  $("tabStats").classList.toggle("active", isStats);
  $("tabSquad").classList.toggle("active", !isStats);
  render();
}

function addAgg(map, team, player, patch){
  if(!team || !player) return;
  if(!map[team]) map[team] = {};
  if(!map[team][player]) map[team][player] = { team, player,
    bat:{ inns:0, r:0, b:0, f4:0, f6:0, outs:0 },
    bowl:{ inns:0, balls:0, r:0, w:0, wd:0, nb:0 },
    field:{ c:0, ro:0, st:0 }
  };
  const o = map[team][player];
  patch(o);
}

function aggregate(matches){
  const byTeam = {}; // team -> player -> stats

  for(const m of matches){
    const st = m?.state;
    if(!st) continue;
    const inns = Array.isArray(st.innings) ? st.innings : [];
    for(const inn of inns){
      if(!inn) continue;
      const batTeam = inn.batting;
      const bowlTeam = inn.bowling;

      // Batting
      const batters = inn.batters || {};
      for(const [name, b] of Object.entries(batters)){
        addAgg(byTeam, batTeam, name, (o)=>{
          o.bat.inns += 1;
          o.bat.r += Number(b.r||0);
          o.bat.b += Number(b.b||0);
          o.bat.f4 += Number(b.f4||0);
          o.bat.f6 += Number(b.f6||0);
          if(b.out) o.bat.outs += 1;
        });
      }

      // Bowling
      const bowlers = inn.bowlers || {};
      for(const [name, bw] of Object.entries(bowlers)){
        addAgg(byTeam, bowlTeam, name, (o)=>{
          o.bowl.inns += 1;
          o.bowl.balls += Number(bw.oBalls||0);
          o.bowl.r += Number(bw.r||0);
          o.bowl.w += Number(bw.w||0);
          o.bowl.wd += Number(bw.wd||0);
          o.bowl.nb += Number(bw.nb||0);
        });
      }

      // Fielding
      const fld = inn.fielding || {};
      for(const [name, f] of Object.entries(fld)){
        addAgg(byTeam, bowlTeam, name, (o)=>{
          o.field.c += Number(f.c||0);
          o.field.ro += Number(f.ro||0);
          o.field.st += Number(f.st||0);
        });
      }
    }
  }

  return byTeam;
}

function flatPlayers(byTeam, teamFilter){
  const rows = [];
  const teams = teamFilter ? [teamFilter] : Object.keys(byTeam);
  for(const t of teams){
    const m = byTeam[t] || {};
    for(const p of Object.keys(m)) rows.push(m[p]);
  }
  return rows;
}

function fmtSR(r,b){
  const sr = b>0 ? (r*100/b) : 0;
  return (Math.round(sr*100)/100).toFixed(2);
}
function fmtEco(r,balls){
  const ovs = balls/6;
  const eco = ovs>0 ? (r/ovs) : 0;
  return (Math.round(eco*100)/100).toFixed(2);
}

function renderTables(players){
  // Batting leaderboard
  const bat = [...players].sort((a,b)=> (b.bat.r - a.bat.r) || (a.bat.outs - b.bat.outs));
  const bowl = [...players].sort((a,b)=> (b.bowl.w - a.bowl.w) || (a.bowl.r - b.bowl.r));
  const six = [...players].sort((a,b)=> (b.bat.f6 - a.bat.f6) || (b.bat.r - a.bat.r));

  const takeN = (arr,n)=> arr.slice(0,n);

  const mkTable = (head, rows, renderRow)=>`
    <div class="card" style="margin-top:12px">
      <div class="h1" style="font-size:18px">${head}</div>
      <div class="sep"></div>
      <table class="table">
        <thead><tr>${renderRow(null,true)}</tr></thead>
        <tbody>
          ${rows.map(r=>`<tr>${renderRow(r,false)}</tr>`).join("") || `<tr><td colspan="8" class="muted">No data yet</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  const batting = mkTable("Top Batters (Runs)", takeN(bat, 30), (r,head)=>{
    if(head) return `<th>Player</th><th>Team</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th><th>Out</th>`;
    return `<td><b>${esc(r.player)}</b></td><td class="muted">${esc(r.team)}</td><td>${r.bat.r}</td><td>${r.bat.b}</td><td>${r.bat.f4}</td><td>${r.bat.f6}</td><td>${fmtSR(r.bat.r,r.bat.b)}</td><td>${r.bat.outs}</td>`;
  });

  const bowling = mkTable("Top Bowlers (Wickets)", takeN(bowl, 30), (r,head)=>{
    if(head) return `<th>Player</th><th>Team</th><th>W</th><th>Runs</th><th>Balls</th><th>Overs</th><th>Eco</th><th>WD/NB</th>`;
    const ovs = `${Math.floor(r.bowl.balls/6)}.${r.bowl.balls%6}`;
    return `<td><b>${esc(r.player)}</b></td><td class="muted">${esc(r.team)}</td><td>${r.bowl.w}</td><td>${r.bowl.r}</td><td>${r.bowl.balls}</td><td>${ovs}</td><td>${fmtEco(r.bowl.r,r.bowl.balls)}</td><td>${r.bowl.wd}/${r.bowl.nb}</td>`;
  });

  const sixes = mkTable("Sixer King (6s)", takeN(six, 30), (r,head)=>{
    if(head) return `<th>Player</th><th>Team</th><th>6s</th><th>R</th><th>B</th>`;
    return `<td><b>${esc(r.player)}</b></td><td class="muted">${esc(r.team)}</td><td>${r.bat.f6}</td><td>${r.bat.r}</td><td>${r.bat.b}</td>`;
  });

  // Fielding table
  const field = [...players].sort((a,b)=> (b.field.c - a.field.c) || (b.field.ro - a.field.ro) || (b.field.st - a.field.st));
  const fielding = mkTable("Fielding", takeN(field, 30), (r,head)=>{
    if(head) return `<th>Player</th><th>Team</th><th>Catches</th><th>Run outs</th><th>Stumpings</th>`;
    return `<td><b>${esc(r.player)}</b></td><td class="muted">${esc(r.team)}</td><td>${r.field.c}</td><td>${r.field.ro}</td><td>${r.field.st}</td>`;
  });

  return batting + bowling + sixes + fielding;
}

function renderSquad(team){
  if(!team){
    return `<div class="card"><div class="muted">Team select karo to squad dikhega.</div></div>`;
  }
  const squad = TOURNAMENT?.squads?.[team] || [];
  const list = squad.length ? squad : Array.from({length:15}, (_,i)=>`${team} Player ${i+1}`);
  return `
    <div class="card">
      <div class="h1" style="font-size:18px">${esc(team)} Squad</div>
      <div class="sep"></div>
      <div class="list">
        ${list.map(p=>`<div class="item"><div class="left"><span class="tag">P</span><div><b>${esc(p)}</b></div></div></div>`).join("")}
      </div>
      <div class="muted small" style="margin-top:10px">(Scoring dropdowns me Playing XI enforce hota hai. Yeh full 15 players squad list hai.)</div>
    </div>
  `;
}

function render(){
  const team = $("teamPick")?.value || "";
  const byTeam = aggregate(ALL_MATCHES);
  const players = flatPlayers(byTeam, team || null);

  $("viewStats").innerHTML = renderTables(players);
  $("viewSquad").innerHTML = renderSquad(team);
}

(async function main(){
  TOURNAMENT = await loadTournament();
  initTeamPick();

  // Live updates from Firestore
  watchAllMatches(FB, (list)=>{
    ALL_MATCHES = list || [];
    render();
  });
})();
