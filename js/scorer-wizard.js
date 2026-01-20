// js/scorer-wizard.js
// Mobile operator setup wizard for scorer page.
// Step flow: Toss -> XI (Team A) -> XI (Team B) -> Captain/VC/WK -> Opening -> Ready.
// This module is UI-only; scoring rules/logic remain unchanged.

const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function makeDots(dotsEl, n){
  dotsEl.innerHTML = "";
  for(let i=0;i<n;i++){
    const d = document.createElement("div");
    d.className = "d" + (i===0 ? " on" : "");
    dotsEl.appendChild(d);
  }
}

function setDots(dotsEl, idx){
  const dots = qsa(".d", dotsEl);
  dots.forEach((d,i)=> d.classList.toggle("on", i===idx));
}

function showPane(wiz, paneName){
  qsa(".wizPane", wiz).forEach(p=> p.classList.add("hidden"));
  const el = qs(`.wizPane[data-pane="${paneName}"]`, wiz);
  if(el) el.classList.remove("hidden");
}

function fillSelect(sel, items, placeholder){
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder || "Select...";
  sel.appendChild(o0);
  items.forEach(x=>{
    const o = document.createElement("option");
    o.value = x;
    o.textContent = x;
    sel.appendChild(o);
  });
}

function renderXI(listEl, squad, selected){
  listEl.innerHTML = "";
  squad.forEach(p=>{
    const pill = document.createElement("div");
    pill.className = "wizPill" + (selected.has(p) ? " on" : "");
    pill.textContent = p;
    pill.addEventListener("click", ()=>{
      if(selected.has(p)) selected.delete(p);
      else {
        if(selected.size >= 11) return;
        selected.add(p);
      }
      renderXI(listEl, squad, selected);
      const cap = qs(".wizCounter", listEl.parentElement);
      if(cap) cap.textContent = `${selected.size}/11 selected`;
    });
    listEl.appendChild(pill);
  });
}

function guessBatBowl(doc){
  const st = doc?.state || {};
  const inn0 = st?.innings?.[0];
  const batting = inn0?.batting || doc?.battingFirst || doc?.a;
  const bowling = inn0?.bowling || doc?.bowlingFirst || doc?.b;
  return { batting, bowling };
}

function oversTextFromLegalBalls(lb){
  const n = Number(lb||0);
  const o = Math.floor(n/6);
  const b = n%6;
  return `${o}.${b}`;
}

function hasMatchSetup(st, a, b){
  const hasToss = !!(st?.toss || st?.tossWinner);
  const hasXI = !!(st?.playingXI && st.playingXI[a]?.length===11 && st.playingXI[b]?.length===11);
  const mA = st?.playingXIMeta?.[a] || {};
  const mB = st?.playingXIMeta?.[b] || {};
  const hasLeaders = !!(mA.captainId && mA.viceCaptainId && mA.wicketKeeperId && mB.captainId && mB.viceCaptainId && mB.wicketKeeperId);
  return { hasToss, hasXI, hasLeaders };
}

export function initScorerWizard(opts){
  const {
    FB,
    matchId,
    getDoc,
    getTournament,
    setToss,
    setPlayingXI,
    setOpeningSetup,
    onDone
  } = opts;

  const wiz = qs("#setupWizard");
  if(!wiz) return null;

  // Panes are dynamic:
  // - Full setup for 1st innings or incomplete match setup
  // - Short flow for 2nd innings: Innings Break -> Opening -> Ready
  let panes = ["xiA","xiB","leaders","toss","opening","ready"];
  let step = 0;

  const titleEl = qs("#wizTitle", wiz);
  const stepEl  = qs("#wizStep", wiz);
  const dotsEl  = qs("#wizDots", wiz);
  const btnBack = qs("#wizBack", wiz);
  const btnNext = qs("#wizNext", wiz);

  // Innings break pane (optional)
  const breakSummaryEl = qs("#breakSummary", wiz);
  const breakTargetEl  = qs("#breakTarget", wiz);
  const breakNoteEl    = qs("#breakNote", wiz);

  const state = {
    tossWinner: "",
    tossDecision: "",
    xiA: new Set(),
    xiB: new Set(),
    capA: "", vcA: "", wkA: "",
    capB: "", vcB: "", wkB: "",
    openStriker: "", openNon: "", openBowler: ""
  };

  function fmtOversFromLegalBalls(lb){
    const n = Number(lb||0);
    const o = Math.floor(n/6);
    const b = n%6;
    return `${o}.${b}`;
  }

  function computeHasSetup(doc){
    const st = doc?.state || {};
    const a = doc?.a, b = doc?.b;
    const hasToss = !!(st.toss?.winner && st.toss?.decision);
    const hasXI = !!(st.playingXI && st.playingXI[a]?.length===11 && st.playingXI[b]?.length===11);
    const hasLeaders = !!(
      st.playingXIMeta?.[a]?.captainId && st.playingXIMeta?.[a]?.viceCaptainId && st.playingXIMeta?.[a]?.wicketKeeperId &&
      st.playingXIMeta?.[b]?.captainId && st.playingXIMeta?.[b]?.viceCaptainId && st.playingXIMeta?.[b]?.wicketKeeperId
    );
    return { hasToss, hasXI, hasLeaders };
  }

  function setFlowForDoc(doc){
    const st = doc?.state || {};
    const idx = Number(st?.inningsIndex||0);
    const { hasToss, hasXI } = computeHasSetup(doc);

    // If it's 2nd innings AND match setup is already done, use short flow.
    if(idx>=1 && hasToss && hasXI){
      panes = ["break","opening","ready"];
    } else {
      panes = ["xiA","xiB","leaders","toss","opening","ready"];
    }

    // Rebuild dots whenever flow changes
    makeDots(dotsEl, panes.length);
  }

  function renderInningsBreak(doc){
    if(!breakSummaryEl || !breakTargetEl) return;
    const st = doc?.state || {};
    const inn0 = st?.innings?.[0] || {};
    const runs = Number(inn0?.runs||0);
    const wk = Number(inn0?.wickets||0);
    const lb = Number(inn0?.legalBalls||inn0?.ballsTotal||0);
    const ov = fmtOversFromLegalBalls(lb);

    const target = runs + 1;

    // Who is chasing? prefer innings[1].batting if present
    const inn1 = st?.innings?.[1] || {};
    const chasing = inn1?.batting || (doc?.a && doc?.b ? (inn0?.batting===doc.a ? doc.b : doc.a) : "");

    breakSummaryEl.textContent = `1st Innings: ${runs}/${wk} (${ov} ov)`;
    breakTargetEl.textContent = chasing ? `Target for ${chasing}: ${target}` : `Target: ${target}`;

    if(breakNoteEl){
      breakNoteEl.textContent = "Start 2nd innings ke liye sirf openers aur first bowler select hoga.";
    }
  }

  function updateHeader(){
    const pane = panes[step];
    titleEl.textContent = (pane==="break") ? "Innings Break" : "Match Setup";
    stepEl.textContent = `Step ${step+1}/${panes.length}`;
    setDots(dotsEl, step);
    btnBack.disabled = (step===0);
    if(pane==="break") btnNext.textContent = "Start 2nd Innings";
    else btnNext.textContent = (step===panes.length-1) ? "Start" : "Next";
  }

  function err(msg){
    alert(msg);
  }

  function validate(){
    const pane = panes[step];
    if(pane==="toss"){
      if(!state.tossWinner || !state.tossDecision) return "Toss winner aur decision dono select karo.";
    }
    if(pane==="xiA"){
      if(state.xiA.size !== 11) return "Team A ke exactly 11 players select karo.";
    }
    if(pane==="xiB"){
      if(state.xiB.size !== 11) return "Team B ke exactly 11 players select karo.";
    }
    if(pane==="leaders"){
      const need = [state.capA,state.vcA,state.wkA,state.capB,state.vcB,state.wkB];
      if(need.some(x=>!x)) return "Captain/VC/WK sab select karo.";
      if(state.capA===state.vcA || state.capA===state.wkA || state.vcA===state.wkA) return "Team A me Captain/VC/WK alag-alag hone chahiye.";
      if(state.capB===state.vcB || state.capB===state.wkB || state.vcB===state.wkB) return "Team B me Captain/VC/WK alag-alag hone chahiye.";
    }
    if(pane==="opening"){
      if(!state.openStriker || !state.openNon || !state.openBowler) return "Opening me Striker, Non-striker aur Bowler select karo.";
      if(state.openStriker===state.openNon) return "Striker aur Non-striker same nahi ho sakte.";
    }
    return "";
  }

  function bindTossButtons(doc){
    const btnA = qs("#btnTossA", wiz);
    const btnB = qs("#btnTossB", wiz);
    if(btnA) btnA.textContent = doc?.a || "Team A";
    if(btnB) btnB.textContent = doc?.b || "Team B";

    // Clear previous selections
    qsa('.wizPane[data-pane="toss"] .wizBtn', wiz).forEach(b=> b.classList.remove("sel"));

    const tossPane = qs('.wizPane[data-pane="toss"]', wiz);
    if(!tossPane || tossPane.__bound) return;
    tossPane.__bound = true;

    qsa('.wizPane[data-pane="toss"] .wizBtn', wiz).forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const pick = btn.getAttribute("data-pick");
        if(pick==="tossTeamA") state.tossWinner = doc?.a;
        if(pick==="tossTeamB") state.tossWinner = doc?.b;
        if(pick==="bat") state.tossDecision = "BAT";
        if(pick==="bowl") state.tossDecision = "BOWL";

        // visual selection
        if(["tossTeamA","tossTeamB"].includes(pick)){
          // remove sel from the 2 team buttons
          qsa('[data-pick="tossTeamA"],[data-pick="tossTeamB"]', tossPane).forEach(b=> b.classList.remove("sel"));
          btn.classList.add("sel");
        }
        if(["bat","bowl"].includes(pick)){
          qsa('[data-pick="bat"],[data-pick="bowl"]', tossPane).forEach(b=> b.classList.remove("sel"));
          btn.classList.add("sel");
        }
      });
    });
  }

  function bindSelectState(){
    ["capA","vcA","wkA","capB","vcB","wkB","openStriker","openNon","openBowler"].forEach(id=>{
      const el = qs("#"+id, wiz);
      if(!el || el.__bound) return;
      el.__bound = true;
      el.addEventListener("change", ()=>{
        state[id] = el.value;
      });
    });
  }

  function hydrateLists(doc){
    const t = getTournament();
    const squads = (t && t.squads) ? t.squads : {};
    const a = doc?.a;
    const b = doc?.b;

    const squadA = Array.isArray(squads?.[a]) && squads[a].length ? squads[a] : Array.from({length:15}, (_,i)=>`${a} Player ${i+1}`);
    const squadB = Array.isArray(squads?.[b]) && squads[b].length ? squads[b] : Array.from({length:15}, (_,i)=>`${b} Player ${i+1}`);

    renderXI(qs("#xiAList", wiz), squadA, state.xiA);
    renderXI(qs("#xiBList", wiz), squadB, state.xiB);

    // Counter labels
    const ca = qs("#xiACount", wiz);
    const cb = qs("#xiBCount", wiz);
    if(ca) ca.textContent = `${state.xiA.size}/11 selected`;
    if(cb) cb.textContent = `${state.xiB.size}/11 selected`;

    // Leaders + Opening dropdowns depend on XI
    const xiA = Array.from(state.xiA);
    const xiB = Array.from(state.xiB);

    fillSelect(qs("#capA", wiz), xiA, "Captain");
    fillSelect(qs("#vcA",  wiz), xiA, "Vice Captain");
    fillSelect(qs("#wkA",  wiz), xiA, "Wicket Keeper");

    fillSelect(qs("#capB", wiz), xiB, "Captain");
    fillSelect(qs("#vcB",  wiz), xiB, "Vice Captain");
    fillSelect(qs("#wkB",  wiz), xiB, "Wicket Keeper");

    // Opening: use current innings batting/bowling after toss is saved
    const { batting, bowling } = guessBatBowl(doc);
    const batXI = (batting===a) ? xiA : xiB;
    const bowlXI = (bowling===a) ? xiA : xiB;

    fillSelect(qs("#openStriker", wiz), batXI, `Striker (${batting})`);
    fillSelect(qs("#openNon",    wiz), batXI, `Non-striker (${batting})`);
    fillSelect(qs("#openBowler", wiz), bowlXI, `Opening bowler (${bowling})`);
  }

  async function persistCurrent(doc){
    const pane = panes[step];
    if(pane==="break"){
      // UI-only pane; do not persist anything.
      return;
    }
    if(pane==="toss"){
      await setToss(FB, matchId, state.tossWinner, state.tossDecision);
    }
    if(pane==="xiA" || pane==="xiB" || pane==="leaders"){
      // Save XI + leaders together (safe to call multiple times)
      const metaA = { captainId: state.capA, viceCaptainId: state.vcA, wicketKeeperId: state.wkA };
      const metaB = { captainId: state.capB, viceCaptainId: state.vcB, wicketKeeperId: state.wkB };
      await setPlayingXI(FB, matchId, Array.from(state.xiA), Array.from(state.xiB), metaA, metaB);
    }
    if(pane==="opening"){
      await setOpeningSetup(FB, matchId, state.openStriker, state.openNon, state.openBowler);
    }
  }

  function open(doc){
    setFlowForDoc(doc);

    // preload any existing saved values if present
    const st = doc?.state || {};
    const a = doc?.a;
    const b = doc?.b;

    // reset local selection only if not already chosen
    if(st.toss?.winner) state.tossWinner = st.toss.winner;
    if(st.toss?.decision) state.tossDecision = (st.toss.decision||"BAT").toUpperCase();

    // XI
    const xiA = st?.playingXI?.[a];
    const xiB = st?.playingXI?.[b];
    if(Array.isArray(xiA) && xiA.length===11){ state.xiA = new Set(xiA); }
    if(Array.isArray(xiB) && xiB.length===11){ state.xiB = new Set(xiB); }

    // Leaders meta
    const mA = st?.playingXIMeta?.[a] || {};
    const mB = st?.playingXIMeta?.[b] || {};
    state.capA = mA.captainId || state.capA;
    state.vcA  = mA.viceCaptainId || state.vcA;
    state.wkA  = mA.wicketKeeperId || state.wkA;
    state.capB = mB.captainId || state.capB;
    state.vcB  = mB.viceCaptainId || state.vcB;
    state.wkB  = mB.wicketKeeperId || state.wkB;

    // Opening (current innings)
    const idx = Number(st?.inningsIndex||0);
    const inn = st?.innings?.[idx];
    const of = inn?.onField || {};
    state.openStriker = of.striker || state.openStriker;
    state.openNon     = of.nonStriker || state.openNon;
    state.openBowler  = of.bowler || state.openBowler;

    bindTossButtons(doc);
    bindSelectState();
    hydrateLists(doc);

    // Fill innings break pane summary (if present)
    if(qs('.wizPane[data-pane="break"]', wiz)){
      renderInningsBreak(doc);
    }

    step = 0;
    showPane(wiz, panes[step]);
    updateHeader();
    wiz.classList.remove("hidden");
  }

  function close(){
    wiz.classList.add("hidden");
  }

  btnBack.addEventListener("click", ()=>{
    if(step===0) return;
    step--;
    const doc = getDoc();
    hydrateLists(doc);
    showPane(wiz, panes[step]);
    updateHeader();
  });

  btnNext.addEventListener("click", async ()=>{
    const msg = validate();
    if(msg){ err(msg); return; }

    try {
      const doc = getDoc();
      await persistCurrent(doc);

      if(step < panes.length-1){
        step++;
        const doc2 = getDoc();
        hydrateLists(doc2);
        showPane(wiz, panes[step]);
        updateHeader();
        return;
      }

      // done
      close();
      if(onDone) onDone();
    } catch(e){
      err(e?.message || "Save failed");
    }
  });

  function shouldOpenForDoc(doc){
    const st = doc?.state || {};
    const a = doc?.a, b = doc?.b;
    const hasToss = !!(st.toss?.winner && st.toss?.decision);
    const hasXI = !!(st.playingXI && st.playingXI[a]?.length===11 && st.playingXI[b]?.length===11);
    const idx = Number(st.inningsIndex||0);
    const inn = st.innings?.[idx];
    const inningsStarted = (
      !!inn?.openingDone ||
      Number(inn?.ballsTotal||0)>0 ||
      Number(inn?.legalBalls||0)>0 ||
      Number(inn?.runs||0)>0 ||
      (Array.isArray(inn?.ballByBall) && inn.ballByBall.length>0)
    );
    const hasOpeners = !!(inn?.onField?.striker && inn?.onField?.nonStriker);
    const needOpening = (!hasOpeners && !inningsStarted);

    return !hasToss || !hasXI || needOpening;
  }

  return {
    open,
    close,
    // call on every render
    sync(doc){
      // if setup incomplete and wizard not open, open
      const openNow = shouldOpenForDoc(doc);
      if(openNow && wiz.classList.contains("hidden")) open(doc);
      // if setup complete and wizard open, close
      if(!openNow && !wiz.classList.contains("hidden")) close();
    }
  };
}
