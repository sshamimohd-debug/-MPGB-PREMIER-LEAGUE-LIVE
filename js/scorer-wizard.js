// js/scorer-wizard.js
// Full-screen setup wizard (UI-only) for NEW match setup.
// STRICT: Do NOT change scoring logic / ball-by-ball rules / Firebase schema.
// Flow (one screen at a time):
//   1) Playing XI (Team A/Team B tabs; only active team visible)
//   2) Toss (winner + bat/bowl)
//   3) Opening (striker/non-striker/opening bowler) – only at innings start
// After "Start Match": set match status LIVE and close wizard; scorer page continues normally.

const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function setHidden(el, hidden){
  if(!el) return;
  el.classList.toggle("hidden", !!hidden);
}

function setActivePane(root, paneName){
  qsa(".wizPane", root).forEach(p=>{
    const name = p.getAttribute("data-pane");
    setHidden(p, name !== paneName);
  });
}

function htmlEscape(s){
  return (s ?? "").toString().replace(/[&<>"']/g, c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function uniq(arr){
  const out=[]; const seen=new Set();
  (arr||[]).forEach(x=>{
    const k=(x??"").toString().trim();
    if(!k || seen.has(k)) return;
    seen.add(k); out.push(k);
  });
  return out;
}

function fillSelect(sel, items, placeholder="Select..."){
  if(!sel) return;
  const val = sel.value;
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder;
  sel.appendChild(o0);
  (items||[]).forEach(n=>{
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  });
  // try restore
  if(items && items.includes(val)) sel.value = val;
}

function renderXIList(listEl, squad, selectedSet){
  if(!listEl) return;
  listEl.innerHTML = "";
  (squad||[]).forEach(name=>{
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wizPill" + (selectedSet.has(name) ? " sel" : "");
    b.setAttribute("data-player", name);
    b.innerHTML = `<span class="dot"></span><span class="t">${htmlEscape(name)}</span>`;
    listEl.appendChild(b);
  });
}

function normalizeStatus(s){
  return (s||"").toString().trim().toUpperCase();
}

export function initScorerWizard(opts){
  const root = document.getElementById("setupWizard");
  if(!root) return null;

  const card = qs(".wizCard", root);
  const titleEl = qs("#wizTitle", root);
  const stepEl  = qs("#wizStep", root);
  const dotsEl  = qs("#wizDots", root);
  const btnBack = qs("#wizBack", root);
  const btnNext = qs("#wizNext", root);

  // panes in scorer.html
  const paneXI_A = qs('[data-pane="xiA"]', root);
  const paneXI_B = qs('[data-pane="xiB"]', root);
  const paneToss = qs('[data-pane="toss"]', root);
  const paneOpen = qs('[data-pane="opening"]', root);
  const paneLeaders = qs('[data-pane="leaders"]', root);
  const paneBreak = qs('[data-pane="break"]', root);
  const paneReady = qs('[data-pane="ready"]', root);

  // hard-disable unused panes (user requested remove captain/vc/wk etc.)
  setHidden(paneLeaders, true);
  setHidden(paneBreak, true);
  setHidden(paneReady, true);

  // state
  let step = 1; // 1=XI, 2=Toss, 3=Opening
  let activeTeam = "A"; // tab selection for XI
  let xiA = new Set();
  let xiB = new Set();
  let tossWinner = null; // "A"|"B"
  let tossChoice = null; // "BAT"|"BOWL"

  // build XI tabs UI (inside xiA pane header area)
  function ensureXITabs(){
    if(!paneXI_A || qs(".xiTabs", paneXI_A)) return;

    const tabBar = document.createElement("div");
    tabBar.className = "xiTabs";
    tabBar.innerHTML = `
      <button type="button" class="xiTab" data-team="A">Team A</button>
      <button type="button" class="xiTab" data-team="B">Team B</button>
      <div class="xiHint">Select 11 players from each team</div>
    `;
    paneXI_A.insertBefore(tabBar, paneXI_A.firstChild);
  }

  function syncXITabUI(){
    ensureXITabs();
    const tabs = qsa(".xiTab", paneXI_A);
    tabs.forEach(t=>t.classList.toggle("on", t.getAttribute("data-team")===activeTeam));
    // show only active team pane
    setHidden(paneXI_A, activeTeam!=="A");
    setHidden(paneXI_B, activeTeam!=="B");
  }

  function updateXICounters(){
    const cA = qs("#xiACount", root);
    const cB = qs("#xiBCount", root);
    if(cA) cA.textContent = `${xiA.size}/11 selected`;
    if(cB) cB.textContent = `${xiB.size}/11 selected`;
  }

  function canGoNext(){
    if(step===1) return xiA.size===11 && xiB.size===11;
    if(step===2) return !!tossWinner && !!tossChoice;
    if(step===3){
      const s = qs("#openStriker", root)?.value || "";
      const n = qs("#openNon", root)?.value || "";
      const b = qs("#openBowler", root)?.value || "";
      return !!s && !!n && !!b && s!==n;
    }
    return false;
  }

  function setNextLabel(){
    if(step===3){
      btnNext.textContent = "Start Match";
    }else{
      btnNext.textContent = "Next";
    }
  }

  function renderStep(){
    // IMPORTANT: one screen at a time
    // Hide all panes first (DOM purge feel)
    qsa(".wizPane", root).forEach(p=>setHidden(p, true));

    // Update header
    if(titleEl){
      titleEl.textContent = step===1 ? "Select Playing XI" : (step===2 ? "Toss" : "Opening Setup");
    }
    if(stepEl){
      stepEl.textContent = `Step ${step}/3`;
    }

    // Dots
    if(dotsEl){
      dotsEl.innerHTML = "";
      for(let i=1;i<=3;i++){
        const d=document.createElement("div");
        d.className="d" + (i===step ? " on" : "");
        dotsEl.appendChild(d);
      }
    }

    // Back
    btnBack.disabled = (step===1);

    // Next label + enable
    setNextLabel();
    btnNext.disabled = !canGoNext();

    if(step===1){
      // Show XI pane with tabs controlling A/B
      activeTeam = activeTeam || "A";
      // show relevant pane
      syncXITabUI();
      // ensure lists rendered
      const squads = (typeof opts.getSquads==="function" ? opts.getSquads() : {}) || {};
      const aName = opts.getDoc()?.teamA || "Team A";
      const bName = opts.getDoc()?.teamB || "Team B";
      // Update titles
      const tA = qs("#xiATitle", root); if(tA) tA.textContent = `Playing XI (${aName})`;
      const tB = qs("#xiBTitle", root); if(tB) tB.textContent = `Playing XI (${bName})`;
      // Update tab labels
      const tabA = qs('.xiTab[data-team="A"]', paneXI_A); if(tabA) tabA.textContent = aName;
      const tabB = qs('.xiTab[data-team="B"]', paneXI_A); if(tabB) tabB.textContent = bName;

      const squadA = uniq(squads?.A || squads?.teamA || squads?.[aName] || []);
      const squadB = uniq(squads?.B || squads?.teamB || squads?.[bName] || []);

      renderXIList(qs("#xiAList", root), squadA, xiA);
      renderXIList(qs("#xiBList", root), squadB, xiB);
      updateXICounters();

      // set visibility correctly (only active team visible)
      syncXITabUI();
    }
    else if(step===2){
      // Toss pane
      setHidden(paneToss, false);

      // set team names
      const aName = opts.getDoc()?.teamA || "Team A";
      const bName = opts.getDoc()?.teamB || "Team B";
      const btnA = qs("#btnTossA", root); if(btnA) qs(".tossName", btnA).textContent = aName;
      const btnB = qs("#btnTossB", root); if(btnB) qs(".tossName", btnB).textContent = bName;

      // Clear / apply selection UI
      qsa('.tossCard', paneToss).forEach(b=>b.classList.remove("sel"));
      if(tossWinner==="A") qs("#btnTossA", root)?.classList.add("sel");
      if(tossWinner==="B") qs("#btnTossB", root)?.classList.add("sel");
      if(tossChoice==="BAT") qsa('.tossCard[data-pick="bat"]', paneToss).forEach(b=>b.classList.add("sel"));
      if(tossChoice==="BOWL") qsa('.tossCard[data-pick="bowl"]', paneToss).forEach(b=>b.classList.add("sel"));
    }
    else if(step===3){
      // Opening pane
      setHidden(paneOpen, false);

      const doc = opts.getDoc() || {};
      const squads = (typeof opts.getSquads==="function" ? opts.getSquads() : {}) || {};
      const aName = doc.teamA || "Team A";
      const bName = doc.teamB || "Team B";

      // Determine batting/bowling based on toss selection (simple, UI-only)
      const battingTeam = (tossWinner==="A" ? aName : bName);
      const bowlingTeam = (tossWinner==="A" ? bName : aName);
      const electedBat = (tossChoice==="BAT");
      const batFirst = electedBat ? battingTeam : bowlingTeam;
      const bowlFirst = electedBat ? bowlingTeam : battingTeam;

      const lblBat = qs("#openBattingLabel", root);
      const lblBowl = qs("#openBowlingLabel", root);
      if(lblBat) lblBat.textContent = `Batting: ${batFirst}`;
      if(lblBowl) lblBowl.textContent = `Bowling: ${bowlFirst}`;

      // Opening options must come from PLAYING XI (not full squad)
      const batXI = (batFirst===aName) ? Array.from(xiA) : Array.from(xiB);
      const bowlXI = (bowlFirst===aName) ? Array.from(xiA) : Array.from(xiB);

      fillSelect(qs("#openStriker", root), batXI, "Select striker");
      fillSelect(qs("#openNon", root), batXI, "Select non-striker");
      fillSelect(qs("#openBowler", root), bowlXI, "Select opening bowler");
    }

    btnNext.disabled = !canGoNext();
  }

  function open(doc){
    // full-screen overlay on
    root.classList.remove("hidden");
    step = 1;
    activeTeam = "A";
    xiA = new Set();
    xiB = new Set();
    tossWinner = null;
    tossChoice = null;

    // Try hydrate from existing doc if any
    const st = (doc && doc.state) ? doc.state : {};
    const xi = st?.playingXI || st?.xi || null;
    if(xi?.A) xiA = new Set(uniq(xi.A));
    if(xi?.B) xiB = new Set(uniq(xi.B));
    if(st?.toss){
      const tw = st.toss.winner;
      const dec = (st.toss.decision||"").toString().toUpperCase();
      if(tw==="A" || tw===doc.teamA) tossWinner="A";
      if(tw==="B" || tw===doc.teamB) tossWinner="B";
      if(dec==="BAT" || dec==="BATTING") tossChoice="BAT";
      if(dec==="BOWL" || dec==="BOWLING") tossChoice="BOWL";
    }

    renderStep();
  }

  function close(){
    root.classList.add("hidden");
  }

  // Event delegation
  root.addEventListener("click", async (ev)=>{
    const t = ev.target;

    // XI tabs
    const tab = t.closest?.(".xiTab");
    if(tab && step===1){
      activeTeam = tab.getAttribute("data-team")==="B" ? "B" : "A";
      syncXITabUI();
      return;
    }

    // XI player taps
    const pill = t.closest?.(".wizPill");
    if(pill && step===1){
      const name = pill.getAttribute("data-player");
      if(!name) return;
      const set = (activeTeam==="A") ? xiA : xiB;
      if(set.has(name)){
        set.delete(name);
      }else{
        if(set.size>=11) return;
        set.add(name);
      }
      // rerender only active list for speed
      if(activeTeam==="A"){
        renderXIList(qs("#xiAList", root), uniq(opts.getSquads()?.A || opts.getSquads()?.teamA || []), xiA);
      }else{
        renderXIList(qs("#xiBList", root), uniq(opts.getSquads()?.B || opts.getSquads()?.teamB || []), xiB);
      }
      updateXICounters();
      btnNext.disabled = !canGoNext();
      return;
    }

    // Toss picks
    const tossBtn = t.closest?.(".tossCard");
    if(tossBtn && step===2){
      const pick = tossBtn.getAttribute("data-pick") || "";
      if(pick==="tossTeamA"){ tossWinner="A"; }
      else if(pick==="tossTeamB"){ tossWinner="B"; }
      else if(pick==="bat"){ tossChoice="BAT"; }
      else if(pick==="bowl"){ tossChoice="BOWL"; }

      // visual update
      qsa('.tossCard', paneToss).forEach(b=>b.classList.remove("sel"));
      if(tossWinner==="A") qs("#btnTossA", root)?.classList.add("sel");
      if(tossWinner==="B") qs("#btnTossB", root)?.classList.add("sel");
      if(tossChoice==="BAT") qsa('.tossCard[data-pick="bat"]', paneToss).forEach(b=>b.classList.add("sel"));
      if(tossChoice==="BOWL") qsa('.tossCard[data-pick="bowl"]', paneToss).forEach(b=>b.classList.add("sel"));

      btnNext.disabled = !canGoNext();
      return;
    }
  });

  root.addEventListener("change", ()=>{
    if(step===3){
      btnNext.disabled = !canGoNext();
    }
  });

  btnBack.addEventListener("click", ()=>{
    if(step<=1) return;
    step -= 1;
    renderStep();
  });

  btnNext.addEventListener("click", async ()=>{
    if(!canGoNext()) return;

    if(step===1){
      // persist XI (both teams) then go toss
      try{
        await opts.setPlayingXI(opts.FB, opts.matchId, {
          A: Array.from(xiA),
          B: Array.from(xiB)
        });
      }catch(e){
        console.error("setPlayingXI failed", e);
      }
      step = 2;
      renderStep();
      return;
    }

    if(step===2){
      // persist toss then go opening
      const doc = opts.getDoc() || {};
      const aName = doc.teamA || "Team A";
      const bName = doc.teamB || "Team B";
      const winnerName = (tossWinner==="A") ? aName : bName;
      const decision = (tossChoice==="BAT") ? "BAT" : "BOWL";
      try{
        await opts.setToss(opts.FB, opts.matchId, { winner: winnerName, decision });
      }catch(e){
        console.error("setToss failed", e);
      }
      step = 3;
      renderStep();
      return;
    }

    if(step===3){
      // persist opening + set LIVE + close wizard
      const striker = qs("#openStriker", root).value;
      const nonStriker = qs("#openNon", root).value;
      const bowler = qs("#openBowler", root).value;

      try{
        await opts.setOpeningSetup(opts.FB, opts.matchId, { striker, nonStriker, bowler });
      }catch(e){
        console.error("setOpeningSetup failed", e);
      }

      // set match LIVE for NEW match so scorer renders (old matches already have state)
      try{
        if(typeof opts.setMatchStatus === "function"){
          await opts.setMatchStatus(opts.FB, opts.matchId, "LIVE");
        }
      }catch(e){
        console.error("setMatchStatus failed", e);
      }

      close();
      try{ opts.onDone && opts.onDone(); }catch(e){}
      return;
    }
  });

  function shouldOpenForDoc(doc){
    const st = doc?.state || {};
    const hasXI = !!(st.playingXI?.A?.length===11 && st.playingXI?.B?.length===11);
    const hasToss = !!(st.toss?.winner && st.toss?.decision);
    const inn0 = st?.innings?.[0] || {};
    const hasOpeners = !!(inn0?.onField?.striker && inn0?.onField?.nonStriker) || !!(st.opening?.striker && st.opening?.nonStriker);
    const balls = Number(inn0?.ballsTotal || inn0?.legalBalls || 0);
    const inningsStarted = balls>0 || Number(inn0?.runs||0)>0;
    const needOpening = (!hasOpeners && !inningsStarted);
    return (!hasXI || !hasToss || needOpening);
  }

  return {
    open(doc){ open(doc || opts.getDoc?.()); },
    close,
    sync(doc){
      const need = shouldOpenForDoc(doc);
      if(need && root.classList.contains("hidden")) open(doc);
      if(!need && !root.classList.contains("hidden")) close();
    }
  };
}
