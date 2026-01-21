// js/scorer-wizard.js
// ✅ One-screen-at-a-time setup wizard for scorer page (UI-only).
// Flow:
//   1) Playing XI (Team A + Team B, 15→11 each)
//   2) Toss
//   3) Opening setup (only at innings start; uses setOpeningSetup which marks openingDone)
// NOTE: Captain/VC/WK selection removed as per requirement. (They will be pre-defined in squad elsewhere.)
// IMPORTANT: Do NOT change scoring logic / ball-by-ball / Firebase structure. This module only calls existing setters.

const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function show(el){ el?.classList.remove("hidden"); }
function hide(el){ el?.classList.add("hidden"); }

function setActiveCard(btn, on){
  if(!btn) return;
  btn.classList.toggle("on", !!on);
}

function toast(wiz, msg){
  const box = qs("#wizMsg", wiz);
  if(!box) return;
  box.textContent = msg || "";
  if(!msg){ hide(box); return; }
  show(box);
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> hide(box), 2400);
}

function makeDots(dotsEl, n){
  if(!dotsEl) return;
  dotsEl.innerHTML = "";
  for(let i=0;i<n;i++){
    const d = document.createElement("div");
    d.className = "d" + (i===0 ? " on" : "");
    dotsEl.appendChild(d);
  }
}
function setDots(dotsEl, idx){
  if(!dotsEl) return;
  const dots = qsa(".d", dotsEl);
  dots.forEach((d,i)=> d.classList.toggle("on", i===idx));
}

function showPane(wiz, pane){
  qsa(".wizPane", wiz).forEach(p=> p.classList.add("hidden"));
  const el = qs(`.wizPane[data-pane="${pane}"]`, wiz);
  el?.classList.remove("hidden");
}

function normList(list, fallbackTeamName){
  // Squads may be array of strings or objects. We store IDs as strings.
  if(!Array.isArray(list) || !list.length){
    const base = (fallbackTeamName||"Team").toString().trim() || "Team";
    return Array.from({length:15}, (_,i)=> ({ id: `${base} Player ${i+1}`, name: `${base} Player ${i+1}` }));
  }
  return list.map((p, i)=>{
    if(typeof p === "string") return { id: p, name: p };
    const id = (p.id || p.playerId || p.name || p.fullName || `P${i+1}`).toString();
    const name = (p.name || p.fullName || p.playerName || id).toString();
    return { id, name };
  });
}

function getTeamsFromDoc(doc){
  const a = doc?.a || doc?.teamA || doc?.team_a || "Team A";
  const b = doc?.b || doc?.teamB || doc?.team_b || "Team B";
  return { a, b };
}

function hasXI(doc, a, b){
  const s = doc?.state;
  return !!(s?.playingXI && Array.isArray(s.playingXI[a]) && s.playingXI[a].length===11
                 && Array.isArray(s.playingXI[b]) && s.playingXI[b].length===11);
}
function hasToss(doc){
  const s = doc?.state;
  return !!(s?.toss || doc?.tossWinner);
}
function openingDone(doc){
  const s = doc?.state;
  const idx = Number(s?.inningsIndex || 0);
  const inn = s?.innings?.[idx];
  return !!inn?.openingDone;
}

export function initScorerWizard(opts){
  const {
    FB,
    matchId,
    getDoc,
    getTournament,
    getSquads,
    setToss,
    setPlayingXI,
    setOpeningSetup,
    onDone
  } = opts;

  const wiz = qs("#setupWizard");
  if(!wiz) return null;

  const titleEl = qs("#wizTitle", wiz);
  const stepEl  = qs("#wizStep", wiz);
  const dotsEl  = qs("#wizDots", wiz);
  const btnBack = qs("#wizBack", wiz);
  const btnNext = qs("#wizNext", wiz);

  // XI UI
  const xiTabA = qs("#xiTabA", wiz);
  const xiTabB = qs("#xiTabB", wiz);
  const xiTeamNameEl = qs("#xiTeamName", wiz);
  const xiCountEl = qs("#xiCount", wiz);
  const xiListAEl = qs("#xiListA", wiz);
  const xiListBEl = qs("#xiListB", wiz);

  // Toss UI
  const tossTeamAName = qs("#tossTeamA", wiz);
  const tossTeamBName = qs("#tossTeamB", wiz);
  const tossSummaryEl = qs("#tossSummary", wiz);

  // Opening UI
  const opStriker = qs("#opStriker", wiz);
  const opNonStriker = qs("#opNonStriker", wiz);
  const opBowler = qs("#opBowler", wiz);

  const panes = ["xi","toss","opening"];
  let step = 0;

  // local state
  let TEAM_A = "Team A";
  let TEAM_B = "Team B";
  let squads = {};
  let squadA = [];
  let squadB = [];
  let tab = "A"; // which team visible in XI step
  let xiA = new Set();
  let xiB = new Set();
  let tossWinner = "";
  let tossDecision = "";

  function openWizard(){
    wiz.classList.remove("hidden");
    wiz.setAttribute("aria-hidden","false");
    document.body.classList.add("wizOpen");
  }
  function closeWizard(){
    wiz.classList.add("hidden");
    wiz.setAttribute("aria-hidden","true");
    document.body.classList.remove("wizOpen");
  }

  function setHeader(){
    const total = panes.length;
    titleEl.textContent =
      step===0 ? "Select Playing XI" :
      step===1 ? "Toss" :
      "Opening Setup";
    stepEl.textContent = `Step ${step+1}/${total}`;
    setDots(dotsEl, step);
  }

  function enableNext(enabled){
    btnNext.disabled = !enabled;
    btnNext.classList.toggle("disabled", !enabled);
  }

  function renderPlayerList(teamKey){
    const listEl = (teamKey==="A") ? xiListAEl : xiListBEl;
    const squad = (teamKey==="A") ? squadA : squadB;
    const sel = (teamKey==="A") ? xiA : xiB;

    listEl.innerHTML = "";
    squad.forEach(p=>{
      const b = document.createElement("button");
      b.type = "button";
      b.className = "xiRow" + (sel.has(p.id) ? " on" : "");
      b.dataset.team = teamKey;
      b.dataset.pid = p.id;
      b.innerHTML = `
        <div class="xiLeft">
          <div class="xiName">${escapeHtml(p.name)}</div>
        </div>
        <div class="xiRight">
          <span class="xiTick">${sel.has(p.id) ? "✓" : ""}</span>
        </div>
      `;
      listEl.appendChild(b);
    });
  }

  function escapeHtml(s){
    return (s??"").toString()
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function updateXiHeader(){
    const sel = (tab==="A") ? xiA : xiB;
    xiTeamNameEl.textContent = (tab==="A") ? TEAM_A : TEAM_B;
    xiCountEl.textContent = `${sel.size}/11`;
    xiTabA.textContent = TEAM_A;
    xiTabB.textContent = TEAM_B;

    // tab highlight
    xiTabA.classList.toggle("on", tab==="A");
    xiTabB.classList.toggle("on", tab==="B");
    hide(tab==="A" ? xiListBEl : xiListAEl);
    show(tab==="A" ? xiListAEl : xiListBEl);

    // overall Next enabled only if BOTH teams have 11
    const ok = (xiA.size===11 && xiB.size===11);
    enableNext(ok);
    btnNext.textContent = ok ? "Next" : "Select 11+11";
  }

  function updateTossSummary(){
    const w = tossWinner ? tossWinner : "—";
    const d = tossDecision ? tossDecision : "—";
    tossSummaryEl.textContent = `Winner: ${w} • Decision: ${d}`;
    enableNext(!!tossWinner && !!tossDecision);
    btnNext.textContent = "Let’s Play";
  }

  function fillSelect(sel, items, placeholder){
    if(!sel) return;
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder || "Select…";
    sel.appendChild(opt0);
    items.forEach(id=>{
      const o = document.createElement("option");
      o.value = id;
      o.textContent = id;
      sel.appendChild(o);
    });
  }

  function renderOpeningSelects(doc){
    const s = doc?.state || {};
    const idx = Number(s.inningsIndex || 0);
    const inn = s.innings?.[idx] || {};
    const batting = inn.batting || s.summary?.batting || doc?.battingFirst || TEAM_A;
    const bowling = inn.bowling || s.summary?.bowling || doc?.bowlingFirst || TEAM_B;
    const batXI = s.playingXI?.[batting] || [];
    const bowlXI = s.playingXI?.[bowling] || [];

    fillSelect(opStriker, batXI, "Select striker…");
    fillSelect(opNonStriker, batXI, "Select non-striker…");
    fillSelect(opBowler, bowlXI, "Select opening bowler…");

    // Preselect if already set (rare)
    const of = inn.onField || {};
    if(of.striker) opStriker.value = of.striker;
    if(of.nonStriker) opNonStriker.value = of.nonStriker;
    if(of.bowler) opBowler.value = of.bowler;

    enableNext(true);
    btnNext.textContent = "Start Scoring";
  }

  function decideInitialStep(doc){
    const { a, b } = getTeamsFromDoc(doc||{});
    TEAM_A = a; TEAM_B = b;

    // labels update
    xiTabA.textContent = TEAM_A;
    xiTabB.textContent = TEAM_B;
    tossTeamAName.textContent = TEAM_A;
    tossTeamBName.textContent = TEAM_B;

    // initial selections from doc if present
    const s = doc?.state;
    const prevA = s?.playingXI?.[TEAM_A] || [];
    const prevB = s?.playingXI?.[TEAM_B] || [];
    xiA = new Set(prevA);
    xiB = new Set(prevB);

    // Toss
    tossWinner = (s?.toss?.winner || doc?.tossWinner || "");
    tossDecision = (s?.toss?.decision || doc?.tossDecision || "").toUpperCase();

    const needXI = !(hasXI(doc, TEAM_A, TEAM_B));
    const needT = !hasToss(doc);
    const needO = !openingDone(doc);

    if(needXI) return 0;
    if(needT) return 1;
    if(needO) return 2;
    return -1;
  }

  function renderStep(doc){
    setHeader();
    const pane = panes[step];
    showPane(wiz, pane);

    // Back button visibility
    btnBack.disabled = (step===0);
    btnBack.classList.toggle("disabled", step===0);

    if(pane==="xi"){
      btnNext.textContent = "Next";
      // build lists if empty
      if(!xiListAEl.children.length) renderPlayerList("A");
      if(!xiListBEl.children.length) renderPlayerList("B");
      updateXiHeader();
    }

    if(pane==="toss"){
      // highlight selection
      qsa('.tossCard[data-toss-winner]', wiz).forEach(b=>{
        const who = b.dataset.tossWinner === "A" ? TEAM_A : TEAM_B;
        setActiveCard(b, tossWinner===who);
      });
      qsa('.tossCard[data-toss-decision]', wiz).forEach(b=>{
        setActiveCard(b, (tossDecision||"")===(b.dataset.tossDecision||""));
      });
      updateTossSummary();
    }

    if(pane==="opening"){
      renderOpeningSelects(doc);
    }
  }

  async function loadData(){
    const doc = getDoc?.();
    if(!doc){
      closeWizard();
      return;
    }
    const { a, b } = getTeamsFromDoc(doc);
    TEAM_A=a; TEAM_B=b;

    // squads
    const sq = (typeof getSquads==="function") ? (getSquads()||{}) : {};
    squads = sq;
    squadA = normList(squads[TEAM_A], TEAM_A);
    squadB = normList(squads[TEAM_B], TEAM_B);

    // initial render lists
    renderPlayerList("A");
    renderPlayerList("B");

    const initial = decideInitialStep(doc);
    if(initial < 0){
      closeWizard();
      onDone?.();
      return;
    }

    step = clamp(initial, 0, panes.length-1);
    makeDots(dotsEl, panes.length);
    openWizard();
    renderStep(doc);
  }

  // ---- Event handlers ----
  xiTabA?.addEventListener("click", ()=>{
    tab="A";
    updateXiHeader();
  });
  xiTabB?.addEventListener("click", ()=>{
    tab="B";
    updateXiHeader();
  });

  // XI selection clicks (event delegation)
  wiz.addEventListener("click", (e)=>{
    const btn = e.target?.closest?.(".xiRow");
    if(!btn) return;
    if(btn.disabled) return;

    const teamKey = btn.dataset.team;
    const pid = btn.dataset.pid;
    const sel = (teamKey==="A") ? xiA : xiB;

    if(sel.has(pid)){
      sel.delete(pid);
    }else{
      if(sel.size>=11){
        toast(wiz, "Max 11 players already selected");
        return;
      }
      sel.add(pid);
    }
    btn.classList.toggle("on", sel.has(pid));
    const tick = qs(".xiTick", btn);
    if(tick) tick.textContent = sel.has(pid) ? "✓" : "";
    updateXiHeader();
  });

  // Toss selection (event delegation)
  wiz.addEventListener("click", (e)=>{
    const wbtn = e.target?.closest?.('.tossCard[data-toss-winner]');
    if(wbtn){
      const who = (wbtn.dataset.tossWinner==="A") ? TEAM_A : TEAM_B;
      tossWinner = who;
      qsa('.tossCard[data-toss-winner]', wiz).forEach(b=>{
        const name = (b.dataset.tossWinner==="A") ? TEAM_A : TEAM_B;
        setActiveCard(b, tossWinner===name);
      });
      updateTossSummary();
      return;
    }
    const dbtn = e.target?.closest?.('.tossCard[data-toss-decision]');
    if(dbtn){
      tossDecision = (dbtn.dataset.tossDecision||"BAT").toUpperCase();
      qsa('.tossCard[data-toss-decision]', wiz).forEach(b=>{
        setActiveCard(b, (b.dataset.tossDecision||"")===tossDecision);
      });
      updateTossSummary();
      return;
    }
  });

  btnBack?.addEventListener("click", ()=>{
    if(step<=0) return;
    step = clamp(step-1, 0, panes.length-1);
    const doc = getDoc?.();
    renderStep(doc);
  });

  btnNext?.addEventListener("click", async ()=>{
    const doc = getDoc?.();
    if(!doc) return;

    const pane = panes[step];

    try{
      if(pane==="xi"){
        if(xiA.size!==11 || xiB.size!==11){
          toast(wiz, "Dono teams ke exact 11 select karo");
          return;
        }
        await setPlayingXI(FB, matchId, Array.from(xiA), Array.from(xiB), null, null);
        // advance
        step = 1;
        renderStep(getDoc?.());
        return;
      }

      if(pane==="toss"){
        if(!tossWinner || !tossDecision){
          toast(wiz, "Toss winner & decision select karo");
          return;
        }
        await setToss(FB, matchId, tossWinner, tossDecision);
        // advance
        step = 2;
        renderStep(getDoc?.());
        return;
      }

      if(pane==="opening"){
        const s = opStriker.value;
        const ns = opNonStriker.value;
        const bo = opBowler.value;
        if(!s || !ns || !bo){
          toast(wiz, "Striker, non-striker aur bowler select karo");
          return;
        }
        await setOpeningSetup(FB, matchId, s, ns, bo);
        closeWizard();
        onDone?.();
        return;
      }

    }catch(err){
      toast(wiz, err?.message || "Save failed");
      console.error(err);
    }
  });

  // Public API (page-scorer can call .refresh() after doc updates)
  const api = {
    refresh(){
      const doc = getDoc?.();
      if(!doc) return;
      const initial = decideInitialStep(doc);
      if(initial < 0){
        closeWizard();
        onDone?.();
        return;
      }
      step = clamp(initial, 0, panes.length-1);
      makeDots(dotsEl, panes.length);
      openWizard();
      renderStep(doc);
    },
    close: closeWizard,
    open: openWizard
  };

  // initial
  loadData();

  return api;
}
