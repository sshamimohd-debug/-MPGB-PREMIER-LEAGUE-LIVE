import { esc } from "./util.js";

function _oversTextFromBalls(balls){
  const o = Math.floor((Number(balls||0))/6);
  const b = Math.floor((Number(balls||0))%6);
  return `${o}.${b}`;
}

function _displaySummary(m){
  const ds = _displaySummary(m);
  const st = m.state || {};
  const idx = Number(st.inningsIndex ?? sum.inningsIndex ?? 0);
  const innings = Array.isArray(st.innings) ? st.innings : [];
  const i0 = innings[0] || null;
  const i1 = innings[1] || null;

  // If innings 2 is selected but hasn't started yet, keep showing innings 1 final score.
  const i1Started = !!(i1 && (Number(i1.balls||0)>0 || (Array.isArray(i1.ballByBall) && i1.ballByBall.length>0)));
  if(idx===1 && !i1Started && i0){
    const oversLimit = Number(st.oversPerInnings || 10);
    const oversText = `${_oversTextFromBalls(i0.balls)}/${oversLimit}`;
    const rr = (Number(i0.balls||0)>0) ? Math.round(((Number(i0.runs||0)*6)/Number(i0.balls||0))*100)/100 : 0;
    return {
      batting: i0.batting || sum.batting || m.a,
      scoreText: `${Number(i0.runs||0)}/${Number(i0.wkts||0)}`,
      oversText,
      rr
    };
  }

  return {
    batting: sum.batting || m.a,
    scoreText: sum.scoreText || "0/0",
    oversText: sum.oversText || "0.0/10",
    rr: (sum.rr!=null) ? sum.rr : 0
  };
}


export function renderScoreLine(doc){
  const m = doc;
  const sum = m.summary || {};
  return `
    <div class="item">
      <div class="left">
        <span class="badge ${m.status==='LIVE'?'live':(m.status==='COMPLETED'?'done':'up')}">${m.status}</span>
        <div>
          <div><b>${esc(m.a)} vs ${esc(m.b)}</b> <span class="muted small">• Match ${esc(m.matchId)} • Group ${esc(m.group)} • ${esc(m.time)}</span></div>
          <div class="muted small">
            <b>${esc(ds.batting)}</b> ${esc(ds.scoreText)} <span class="muted">(${esc(ds.oversText)})</span>
            • RR ${esc(ds.rr||0)}
          </div>
        </div>
      </div>
    </div>
  `;
}

// CricHeroes-style: Best performances block (Top batters + bowlers)
export function renderBestPerformers(doc){
  const st = doc?.state;
  const inn = st?.innings || [];
  if(!inn.length) return `<div class="muted small">No performance data yet.</div>`;

  // Aggregate batters and bowlers across innings
  const batAgg = {};
  const bowlAgg = {};

  for(const x of inn){
    for(const [name, b] of Object.entries(x.batters||{})){
      const a = batAgg[name] || { r:0, b:0, f4:0, f6:0, team: x.batting||"" };
      a.r += Number(b.r||0); a.b += Number(b.b||0); a.f4 += Number(b.f4||0); a.f6 += Number(b.f6||0);
      // keep team if blank
      a.team = a.team || x.batting||"";
      batAgg[name]=a;
    }
    for(const [name, bo] of Object.entries(x.bowlers||{})){
      const a = bowlAgg[name] || { oBalls:0, r:0, w:0, wd:0, nb:0, team: x.bowling||"" };
      a.oBalls += Number(bo.oBalls||0);
      a.r += Number(bo.r||0);
      a.w += Number(bo.w||0);
      a.wd += Number(bo.wd||0);
      a.nb += Number(bo.nb||0);
      a.team = a.team || x.bowling||"";
      bowlAgg[name]=a;
    }
  }

  const topBat = Object.entries(batAgg)
    .sort((a,b)=> (b[1].r - a[1].r) || (a[1].b - b[1].b))
    .slice(0,3);
  const topBowl = Object.entries(bowlAgg)
    .sort((a,b)=> (b[1].w - a[1].w) || (a[1].r - b[1].r))
    .slice(0,3);

  const batRows = topBat.length ? topBat.map(([name, b])=>{
    const sr = b.b>0 ? Math.round((b.r*10000)/b.b)/100 : 0;
    return `
      <tr>
        <td><b>${esc(name)}</b> <span class="muted small">${esc(b.team||"")}</span></td>
        <td>${esc(b.r)}</td>
        <td>${esc(b.b)}</td>
        <td>${esc(b.f4)}</td>
        <td>${esc(b.f6)}</td>
        <td>${esc(sr)}</td>
      </tr>`;
  }).join("") : `<tr><td colspan="6" class="muted small">—</td></tr>`;

  const bowlRows = topBowl.length ? topBowl.map(([name, bo])=>{
    const o = Math.floor((bo.oBalls||0)/6);
    const bb = (bo.oBalls||0)%6;
    const overs = `${o}.${bb}`;
    const eco = bo.oBalls>0 ? Math.round((bo.r*6*100)/bo.oBalls)/100 : 0;
    return `
      <tr>
        <td><b>${esc(name)}</b> <span class="muted small">${esc(bo.team||"")}</span></td>
        <td>${esc(overs)}</td>
        <td>${esc(bo.r)}</td>
        <td>${esc(bo.w)}</td>
        <td>${esc(eco)}</td>
      </tr>`;
  }).join("") : `<tr><td colspan="5" class="muted small">—</td></tr>`;

  return `
    <div class="grid cols2">
      <div>
        <div class="h1" style="font-size:14px">Batters</div>
        <table class="table" style="margin-top:8px">
          <thead><tr><th>Player</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
          <tbody>${batRows}</tbody>
        </table>
      </div>
      <div>
        <div class="h1" style="font-size:14px">Bowlers</div>
        <table class="table" style="margin-top:8px">
          <thead><tr><th>Player</th><th>O</th><th>R</th><th>W</th><th>Eco</th></tr></thead>
          <tbody>${bowlRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// Right-side "Match details" card content
export function renderMatchDetailsCard(doc){
  const parts = [];
  if(doc.seriesName) parts.push(`<div><b>Series</b>: ${esc(doc.seriesName)}</div>`);
  if(doc.date) parts.push(`<div><b>Match date</b>: ${esc(doc.date)}</div>`);
  if(doc.venue) parts.push(`<div><b>Location</b>: ${esc(doc.venue)}</div>`);
  if(doc.time) parts.push(`<div><b>Time</b>: ${esc(doc.time)}</div>`);
  if(doc.oversPerInnings) parts.push(`<div><b>Overs</b>: ${esc(doc.oversPerInnings)} Ov</div>`);
  const toss = doc.toss;
  if(toss?.winner){
    parts.push(`<div><b>Toss</b>: ${esc(toss.winner)} opted to ${esc(toss.decision||"-")}</div>`);
  }
  if(doc.result?.text) parts.push(`<div><b>Result</b>: ${esc(doc.result.text)}</div>`);
  return parts.length ? parts.join("") : `<span class="muted small">—</span>`;
}

export function renderCommentary(doc){
  const balls = doc?.state?.balls || [];
  if(balls.length===0) return `<div class="muted small">No balls yet.</div>`;
  const last = balls.slice(-30).reverse();
  return `<div class="list">` + last.map(b=>{
    const tag = `<span class="tag">${b.seq}</span>`;
    const who = `<b>${esc(b.bowler)}</b> to <b>${esc(b.batter)}</b>`;
    const what = b.type==="RUN" ? `${b.runs} run` + (b.runs===1?"":"s")
      : b.type==="WD" ? `Wide +${1+(b.runs||0)}`
      : b.type==="NB" ? `No-ball +${1+(b.runs||0)}`
      : b.type==="B" ? `Bye ${b.runs||0}`
      : b.type==="W" ? `WICKET (${esc(b.dismissal||"out")})`
      : b.type;
    const at = b.at ? new Date(b.at).toLocaleTimeString() : "";
    return `<div class="item"><div class="left">${tag}<div><div>${who}</div><div class="muted small">${esc(what)} • ${esc(at)}</div></div></div></div>`;
  }).join("") + `</div>`;
}

export function renderScorecard(doc){
  const st = doc?.state;
  if(!st) return `<div class="muted small">No data.</div>`;
  const inn = st.innings || [];
  const liveIdx = Math.max(0, Math.min(Number(st.inningsIndex||0), Math.max(0, inn.length-1)));

  // Chase helpers (innings 2)
  const totalOvers = Number(st.oversPerInnings || doc?.oversPerInnings || 10);
  const totalBalls = Math.max(0, totalOvers * 6);
  const chaseInfo = (innArr)=>{
    const i1 = innArr?.[0];
    const i2 = innArr?.[1];
    if(!i1 || !i2) return null;
    const target = Number(i1.runs || 0) + 1;
    const ballsUsed = Number(i2.balls || 0);
    const ballsLeft = Math.max(0, totalBalls - ballsUsed);
    const runs = Number(i2.runs || 0);
    const runsNeeded = Math.max(0, target - runs);
    const reqRR = ballsLeft > 0 ? (runsNeeded * 6) / ballsLeft : 0;
    const crr = ballsUsed > 0 ? (runs * 6) / ballsUsed : 0;
    return {
      target,
      ballsLeft,
      runsNeeded,
      reqRR: Math.round(reqRR * 100) / 100,
      crr: Math.round(crr * 100) / 100,
    };
  };

  const tabs = inn.length > 1 ? `
    <div class="row wrap" style="gap:8px; margin-top:12px">
      ${inn.map((x, idx)=>{
        const label = `Innings ${idx+1}: ${x.batting||""}`;
        const isLive = idx===liveIdx;
        return `<button class="chip ${isLive?"on":""}" data-inn-tab="${idx}" type="button">${esc(label)}</button>`;
      }).join("")}
    </div>
    <div class="muted small" style="margin-top:6px">Live innings default खुलती है. किसी innings पर click करके scorecard देख सकते हो.</div>
  ` : "";

  const blocks = inn.map((x, idx)=>{
    const bats = Object.entries(x.batters||{});
    const bowls = Object.entries(x.bowlers||{});
    const isLive = idx===liveIdx;
    const striker = isLive ? (x.onField?.striker || "") : "";
    const nonStriker = isLive ? (x.onField?.nonStriker || "") : "";
    const bowlerNow = isLive ? (x.onField?.bowler || "") : "";

    const liveMini = (isLive && (striker||nonStriker||bowlerNow)) ? `
      <div class="card" style="margin-top:10px; padding:10px">
        <div class="row wrap" style="gap:10px; justify-content:space-between">
          <div>
            <div class="muted small">Batting now</div>
            <div style="margin-top:4px">
              <b>${esc(striker||"-")}</b>${striker?" *":""} <span class="muted">&nbsp;|&nbsp;</span>
              <b>${esc(nonStriker||"-")}</b>
            </div>
          </div>
          <div>
            <div class="muted small">Bowling now</div>
            <div style="margin-top:4px"><b>${esc(bowlerNow||"-")}</b></div>
          </div>
        </div>
      </div>
    ` : "";

    const batRows = bats.length ? bats.map(([name, b])=>`
      <tr>
        <td>
          <b>${esc(name)}</b>${(isLive && striker && name===striker) ? " *" : ""}
          ${b.out? `<span class="muted small">(${esc(b.how)})</span>`:""}
        </td>
        <td>${b.r}</td><td>${b.b}</td><td>${b.f4}</td><td>${b.f6}</td>
      </tr>
    `).join("") : `<tr><td colspan="5" class="muted small">No batting entries yet.</td></tr>`;
    const bowlRows = bowls.length ? bowls.map(([name, bo])=>{
      const o = Math.floor((bo.oBalls||0)/6);
      const bb = (bo.oBalls||0)%6;
      const overs = `${o}.${bb}`;
      return `
      <tr>
        <td><b>${esc(name)}</b></td>
        <td>${overs}</td><td>${bo.r||0}</td><td>${bo.w||0}</td><td>${bo.wd||0}</td><td>${bo.nb||0}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="6" class="muted small">No bowling entries yet.</td></tr>`;

    const i1 = inn?.[0];
    const i1Complete = !!i1 && (
      Number(i1.balls||0) >= totalBalls ||
      Number(i1.wkts||0) >= 10 ||
      Number(st.inningsIndex||0) >= 1
    );
    const chase = (idx===1 && i1Complete) ? chaseInfo(inn) : null;
    const chaseStrip = (chase && (idx===liveIdx)) ? `
      <div class="card" style="margin-top:10px; padding:10px">
        <div class="row wrap" style="gap:10px; justify-content:space-between; align-items:center">
          <div>
            <div class="muted small">Chase</div>
            <div style="margin-top:4px">
              <b>Target</b> ${esc(chase.target)}
              <span class="muted">&nbsp;•&nbsp;</span>
              ${chase.runsNeeded<=0 ? `<b>Target achieved</b>` : `<b>Need</b> ${esc(chase.runsNeeded)} in ${esc(chase.ballsLeft)} balls`}
            </div>
          </div>
          <div style="text-align:right">
            <div class="muted small">CRR / Req RR</div>
            <div style="margin-top:4px"><b>${esc(chase.crr)}</b> <span class="muted">/</span> <b>${esc(chase.reqRR)}</b></div>
          </div>
        </div>
      </div>
    ` : "";

    return `
      <div class="card innBlock" data-inn-block="${idx}" style="margin-top:14px; ${idx===liveIdx?"":"display:none"}">
        <div class="row wrap">
          <div>
            <div class="h1" style="font-size:18px">Innings ${idx+1}: ${esc(x.batting)}</div>
            <div class="muted small">Score: <b>${x.runs}/${x.wkts}</b> • Overs: <b>${x.overs}</b></div>
          </div>
        </div>
        ${chaseStrip}
        ${liveMini}
        <div class="sep"></div>

        <div class="h1" style="font-size:14px">Batting</div>
        <table class="table">
          <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
          <tbody>${batRows}</tbody>
        </table>

        <div class="sep"></div>
        <div class="h1" style="font-size:14px">Bowling</div>
        <table class="table">
          <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>WD</th><th>NB</th></tr></thead>
          <tbody>${bowlRows}</tbody>
        </table>

        <div class="sep"></div>
        <div class="muted small">Extras: WD ${x.extras?.wd||0}, NB ${x.extras?.nb||0}, B ${x.extras?.b||0}</div>
      </div>
    `;
  }).join("");

  const awards = (()=>{
    const a = doc.awards;
    if(!a) return "";
    const mom = a.mom;
    const six = a.sixerKing;
    const bb = a.bestBowler;
    const res = doc.result?.text ? `<div class="muted small" style="margin-top:8px">Result</div><div style="margin-top:4px"><b>${esc(doc.result.text)}</b></div>` : "";
    return `
      <div class="card" style="margin-top:14px; padding:12px">
        <div class="row wrap" style="justify-content:space-between; align-items:flex-start; gap:10px">
          <div>
            <div class="h1" style="font-size:14px">🏆 Match Awards</div>
            ${res}
          </div>
          <div class="row wrap" style="gap:10px">
            <div class="card" style="padding:10px; min-width:180px">
              <div class="muted small">Man of the Match</div>
              <div style="margin-top:4px"><b>${esc(mom?.name||"-")}</b></div>
              <div class="muted small">${esc(mom?.team||"")}${mom?.score!=null?` • Score ${esc(mom.score)}`:""}</div>
            </div>
            <div class="card" style="padding:10px; min-width:180px">
              <div class="muted small">Sixer King</div>
              <div style="margin-top:4px"><b>${esc(six?.name||"-")}</b></div>
              <div class="muted small">${esc(six?.team||"")}${six?.sixes!=null?` • 6s ${esc(six.sixes)}`:""}</div>
            </div>
            <div class="card" style="padding:10px; min-width:180px">
              <div class="muted small">Best Bowler</div>
              <div style="margin-top:4px"><b>${esc(bb?.name||"-")}</b></div>
              <div class="muted small">${esc(bb?.team||"")}${bb?.wickets!=null?` • ${esc(bb.wickets)}W`:""}${bb?.econ!=null?` • Eco ${esc(bb.econ)}`:""}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  })();

  const resultOnly = (!doc.awards && doc.result?.text)
    ? `<div class="card" style="margin-top:14px"><div class="badge done">Result</div><div style="margin-top:8px"><b>${esc(doc.result.text)}</b></div></div>`
    : "";

  return awards + resultOnly + tabs + blocks;
}
