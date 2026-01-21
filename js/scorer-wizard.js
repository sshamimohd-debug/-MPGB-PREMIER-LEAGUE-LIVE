// js/scorer-wizard.js
// Full-screen setup wizard rendered inside scorer.html (#setupWizard -> #wizHost)
// STRICT: Do NOT change scoring logic / ball-by-ball rules / Firebase schema.
// Flow:
//   1) Playing XI (tabs Team A/Team B; only active team list visible)
//   2) Toss (winner + bat/bowl)
//   3) Opening (striker/non-striker/opening bowler)
// After "Start Match": set match status LIVE (if provided) and close wizard.

const qs = (sel, root=document)=>root.querySelector(sel);
const qsa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));

const esc = (s)=> (s??"").toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uniq = (arr)=> {
  const out=[]; const seen=new Set();
  (arr||[]).forEach(x=>{
    const k=(x??"").toString().trim();
    if(!k || seen.has(k)) return;
    seen.add(k); out.push(k);
  });
  return out;
};

function isXIReady(doc){
  const st = doc?.state || {};
  const a = doc?.a, b = doc?.b;
  const xi = st.playingXI || {};
  return Array.isArray(xi[a]) && xi[a].length===11 && Array.isArray(xi[b]) && xi[b].length===11;
}
function isTossReady(doc){
  const st = doc?.state || {};
  const t = st.toss || {};
  return !!t.winner && !!t.decision;
}
function isOpeningReady(doc){
  const st = doc?.state || {};
  const o = st.opening || {};
  return !!o.striker && !!o.nonStriker && !!o.bowler;
}

export function initScorerWizard(opts){
  const root = document.getElementById("setupWizard");
  if(!root) return null;

  const titleEl = qs("#wizTitle", root);
  const stepEl  = qs("#wizStep", root);
  const dotsEl  = qs("#wizDots", root);
  const host    = qs("#wizHost", root);
  const btnBack = qs("#wizBack", root);
  const btnNext = qs("#wizNext", root);

  let step = 1;
  let activeTeam = "A";
  let selA = new Set();
  let selB = new Set();

  let tossWinner = null;
  let tossDecision = "BAT";

  let opening = { striker:null, nonStriker:null, bowler:null };

  let _bound = false;

  function open(){
    root.classList.remove("hidden");
  }
  function close(){
    root.classList.add("hidden");
    host.innerHTML = "";
  }

  function renderDots(){
    if(!dotsEl) return;
    dotsEl.innerHTML = [1,2,3].map(n=>`<span class="dot ${n===step?'on':''}"></span>`).join("");
  }

  function updateNextState(doc){
    btnNext.textContent = (step===3) ? "Start Match" : "Next";
    if(step===1) btnNext.disabled = !(selA.size===11 && selB.size===11);
    else if(step===2) btnNext.disabled = !(!!tossWinner && !!tossDecision);
    else if(step===3) btnNext.disabled = !(!!opening.striker && !!opening.nonStriker && !!opening.bowler);
    else btnNext.disabled = true;
    btnBack.disabled = (step===1);
  }

  function renderPlayingXI(doc){
    const a = doc?.a || "Team A";
    const b = doc?.b || "Team B";

    const squads = (opts.getSquads && opts.getSquads()) || {};
    const squadA = uniq(squads[a] || squads.A || []);
    const squadB = uniq(squads[b] || squads.B || []);

    // hydrate from saved XI if exists
    const xi = (doc?.state?.playingXI) || {};
    const savedA = Array.isArray(xi[a]) ? xi[a] : [];
    const savedB = Array.isArray(xi[b]) ? xi[b] : [];
    if(savedA.length===11) selA = new Set(savedA);
    if(savedB.length===11) selB = new Set(savedB);

    host.innerHTML = `
      <div class="wizSection">
        <div class="wizRow" style="gap:10px; justify-content:center;">
          <button class="wizTab ${activeTeam==='A'?'on':''}" id="xiTabA">${esc(a)} <span class="muted">(${selA.size}/11)</span></button>
          <button class="wizTab ${activeTeam==='B'?'on':''}" id="xiTabB">${esc(b)} <span class="muted">(${selB.size}/11)</span></button>
        </div>
        <div class="wizHint">15 में से exact 11 चुनिए। दोनों टीम 11/11 होने पर ही Next खुलेगा।</div>
        <div class="wizList" id="xiList"></div>
      </div>
    `;

    const list = qs("#xiList", host);

    function draw(){
      const players = activeTeam==='A' ? squadA : squadB;
      const set = activeTeam==='A' ? selA : selB;

      if(!players || !players.length){
        list.innerHTML = `<div class="wizEmpty">Players list load नहीं हुई। (data/tournament.json) check करें।</div>`;
        return;
      }

      list.innerHTML = players.map(p=>{
        const on = set.has(p);
        return `
          <button type="button" class="wizPick ${on?'on':''}" data-player="${esc(p)}">
            <span class="name">${esc(p)}</span>
            <span class="tick">${on?'✓':'+'}</span>
          </button>
        `;
      }).join("");

      qsa(".wizPick", list).forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const p = btn.getAttribute("data-player");
          const cur = activeTeam==='A' ? selA : selB;
          if(cur.has(p)) cur.delete(p);
          else { if(cur.size>=11) return; cur.add(p); }
          render(); // re-render from current doc
        });
      });
    }

    qs("#xiTabA", host).addEventListener("click", ()=>{ activeTeam='A'; render(); });
    qs("#xiTabB", host).addEventListener("click", ()=>{ activeTeam='B'; render(); });

    draw();
  }

  function renderToss(doc){
    const a = doc?.a || "Team A";
    const b = doc?.b || "Team B";
    const st = doc?.state || {};
    const t = st.toss || {};
    tossWinner = tossWinner || t.winner || null;
    tossDecision = tossDecision || t.decision || "BAT";

    host.innerHTML = `
      <div class="wizSection">
        <div class="wizHint">Toss winner चुनिए और Bat/Bowl select कीजिए।</div>
        <div class="wizGrid2">
          <button type="button" class="wizCardBtn ${tossWinner===a?'on':''}" id="twA">${esc(a)}</button>
          <button type="button" class="wizCardBtn ${tossWinner===b?'on':''}" id="twB">${esc(b)}</button>
        </div>
        <div class="wizGrid2" style="margin-top:10px;">
          <button type="button" class="wizCardBtn ${tossDecision==='BAT'?'on':''}" id="tdBat">Bat</button>
          <button type="button" class="wizCardBtn ${tossDecision==='BOWL'?'on':''}" id="tdBowl">Bowl</button>
        </div>
      </div>
    `;

    qs("#twA", host).addEventListener("click", ()=>{ tossWinner=a; render(); });
    qs("#twB", host).addEventListener("click", ()=>{ tossWinner=b; render(); });
    qs("#tdBat", host).addEventListener("click", ()=>{ tossDecision="BAT"; render(); });
    qs("#tdBowl", host).addEventListener("click", ()=>{ tossDecision="BOWL"; render(); });
  }

  function renderOpening(doc){
    const a = doc?.a || "Team A";
    const b = doc?.b || "Team B";
    const st = doc?.state || {};
    const xi = st.playingXI || {};
    const toss = st.toss || {};
    if(!toss.winner){
      host.innerHTML = `<div class="wizEmpty">Toss पहले complete करें।</div>`;
      return;
    }
    const other = (toss.winner===a) ? b : a;
    const battingFirst = (toss.decision==="BAT") ? toss.winner : other;
    const bowlingFirst = (battingFirst===a) ? b : a;

    const batXI = Array.isArray(xi[battingFirst]) ? xi[battingFirst] : [];
    const bowlXI = Array.isArray(xi[bowlingFirst]) ? xi[bowlingFirst] : [];

    host.innerHTML = `
      <div class="wizSection">
        <div class="wizHint"><b>${esc(battingFirst)}</b> batting • <b>${esc(bowlingFirst)}</b> bowling</div>
        <div class="wizForm">
          <label>Striker</label>
          <select id="opStr">${batXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select>
          <label>Non-Striker</label>
          <select id="opNS">${batXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select>
          <label>Opening Bowler</label>
          <select id="opBow">${bowlXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select>
        </div>
      </div>
    `;

    const sEl = qs("#opStr", host);
    const nEl = qs("#opNS", host);
    const bEl = qs("#opBow", host);

    if(batXI.length>=2) nEl.value = batXI[1];

    opening = { striker: sEl.value || null, nonStriker: nEl.value || null, bowler: bEl.value || null };

    sEl.addEventListener("change", ()=>{ opening.striker=sEl.value; updateNextState(doc); });
    nEl.addEventListener("change", ()=>{ opening.nonStriker=nEl.value; updateNextState(doc); });
    bEl.addEventListener("change", ()=>{ opening.bowler=bEl.value; updateNextState(doc); });
  }

  async function onNext(){
    const doc = opts.getDoc && opts.getDoc();
    if(!doc) return;
    const FB = opts.FB;
    const matchId = opts.matchId;

    try{
      if(step===1){
        if(selA.size!==11 || selB.size!==11) return;
        await opts.setPlayingXI(FB, matchId, Array.from(selA), Array.from(selB), null, null);
      } else if(step===2){
        if(!tossWinner) return;
        await opts.setToss(FB, matchId, tossWinner, tossDecision);
      } else if(step===3){
        if(!opening.striker || !opening.nonStriker || !opening.bowler) return;
        await opts.setOpeningSetup(FB, matchId, opening.striker, opening.nonStriker, opening.bowler);
        if(typeof opts.setMatchStatus === "function"){
          await opts.setMatchStatus(FB, matchId, "LIVE");
        }
        close();
        return;
      }
      // step will be recomputed from updated doc via watchMatch -> sync
    }catch(e){
      alert(e?.message || String(e));
    }
  }

  function onBack(){
    if(step<=1) return;
    step -= 1;
    render();
  }

  function render(){
    const doc = opts.getDoc && opts.getDoc();
    if(!doc){ close(); return; }

    // resumable step from doc
    if(!isXIReady(doc)) step = 1;
    else if(!isTossReady(doc)) step = 2;
    else if(!isOpeningReady(doc)) step = 3;
    else { close(); return; }

    open();
    titleEl.textContent = (step===1) ? "Select Playing XI" : (step===2) ? "Toss" : "Opening Setup";
    stepEl.textContent = `Step ${step}/3`;
    renderDots();

    if(step===1) renderPlayingXI(doc);
    if(step===2) renderToss(doc);
    if(step===3) renderOpening(doc);

    updateNextState(doc);
  }

  if(!_bound){
    btnBack.addEventListener("click", onBack);
    btnNext.addEventListener("click", onNext);
    _bound = true;
  }

  return {
    sync: ()=>render(),
    close
  };
}
