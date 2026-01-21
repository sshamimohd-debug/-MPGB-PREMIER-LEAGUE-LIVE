// js/scorer-wizard.js
// CLEAN SINGLE-SCREEN Setup Wizard for scorer page.
// STRICT: This module is UI-only. It must NOT change scoring logic, ball-by-ball rules, or Firebase schema/keys.
//
// Flow (one screen at a time):
// 1) Playing XI (Team A/Team B tabs; only active team list visible) -> save XI
// 2) Toss -> save toss
// 3) Opening (innings start only) -> save opening -> done

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
function setDot(dotsEl, idx){
  qsa(".d", dotsEl).forEach((d,i)=> d.classList.toggle("on", i===idx));
}

function el(tag, cls, text){
  const x = document.createElement(tag);
  if(cls) x.className = cls;
  if(text!=null) x.textContent = text;
  return x;
}

function pill(text, on, disabled=false){
  const p = el("button", "wizPill" + (on ? " on" : "") + (disabled ? " dis" : ""), text);
  p.type = "button";
  return p;
}

function clampStr(x){ return (x==null) ? "" : String(x); }

function getTeamsFromDoc(doc){
  const a = doc?.a || doc?.teamA || doc?.home || "";
  const b = doc?.b || doc?.teamB || doc?.away || "";
  return { a, b };
}

function getSquadForTeam(squads, teamName){
  if(!squads || !teamName) return [];
  // squads.json can be { "TEAM": [..] } or { teams: { "TEAM": [..] } }
  if(Array.isArray(squads[teamName])) return squads[teamName];
  if(squads.teams && Array.isArray(squads.teams[teamName])) return squads.teams[teamName];
  // fallback: case-insensitive
  const key = Object.keys(squads).find(k=>k.toLowerCase()===teamName.toLowerCase());
  if(key && Array.isArray(squads[key])) return squads[key];
  if(squads.teams){
    const key2 = Object.keys(squads.teams).find(k=>k.toLowerCase()===teamName.toLowerCase());
    if(key2 && Array.isArray(squads.teams[key2])) return squads.teams[key2];
  }
  return [];
}

function fillSelect(sel, items, placeholder){
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder || "Select";
  sel.appendChild(o0);
  (items||[]).forEach(it=>{
    const o = document.createElement("option");
    o.value = it;
    o.textContent = it;
    sel.appendChild(o);
  });
}

function hasXIInState(state, a, b){
  const xi = state?.playingXI;
  if(!xi) return false;
  const xA = xi[a] || xi.teamA || xi.A;
  const xB = xi[b] || xi.teamB || xi.B;
  return Array.isArray(xA) && xA.length===11 && Array.isArray(xB) && xB.length===11;
}

function hasTossInState(state){
  return !!(state?.toss?.winner || state?.tossWinner);
}

function hasOpeningInState(state){
  // In store-fb, opening is stored under state.opening and also reflected in innings[0] maybe.
  return !!(state?.opening?.striker && state?.opening?.nonStriker && state?.opening?.bowler);
}

function shouldOpenForDoc(doc){
  const state = doc?.state || {};
  const { a, b } = getTeamsFromDoc(doc);
  const needXI = !hasXIInState(state, a, b);
  const needToss = !hasTossInState(state);
  const needOpening = !hasOpeningInState(state);
  // Opening is required before first ball; if match already started, don't force wizard.
  const hasAnyBall = (state?.innings?.[0]?.balls && state.innings[0].balls.length>0) || (doc?.balls && doc.balls.length>0);
  if(hasAnyBall) return false;
  return needXI || needToss || needOpening;
}

export function initScorerWizard(opts){
  const wiz = qs("#setupWizard");
  if(!wiz) throw new Error("setupWizard not found in scorer.html");
  const host = qs("#wizHost", wiz);
  const titleEl = qs("#wizTitle", wiz);
  const stepEl  = qs("#wizStep", wiz);
  const dotsEl  = qs("#wizDots", wiz);
  const btnBack = qs("#wizBack", wiz);
  const btnNext = qs("#wizNext", wiz);

  // steps: 0 XI, 1 Toss, 2 Opening
  const STEPS = ["XI","TOSS","OPENING"];
  makeDots(dotsEl, STEPS.length);

  const state = {
    step: 0,
    activeTeam: "A", // tab
    a: "",
    b: "",
    squads: null,
    // selections
    selA: new Set(),
    selB: new Set(),
    // toss
    tossWinner: "",
    tossDecision: "BAT",
    // opening
    striker: "",
    nonStriker: "",
    bowler: "",
    // ui msg
    msg: ""
  };

  function setMsg(s){
    state.msg = s || "";
  }

  function snapshotFromDoc(doc){
    const st = doc?.state || {};
    const { a, b } = getTeamsFromDoc(doc);
    state.a = a; state.b = b;

    // squads reference
    state.squads = (typeof opts.getSquads === "function") ? opts.getSquads() : null;

    // XI from doc if present
    const xi = st.playingXI || {};
    const xa = xi[a] || xi.teamA || xi.A || [];
    const xb = xi[b] || xi.teamB || xi.B || [];
    state.selA = new Set(Array.isArray(xa)? xa.filter(Boolean) : []);
    state.selB = new Set(Array.isArray(xb)? xb.filter(Boolean) : []);

    // toss
    const toss = st.toss || {};
    state.tossWinner = toss.winner || st.tossWinner || "";
    state.tossDecision = (toss.decision || st.tossDecision || "BAT").toUpperCase();
    if(state.tossDecision!=="BAT" && state.tossDecision!=="BOWL") state.tossDecision="BAT";

    // opening
    const op = st.opening || {};
    state.striker = op.striker || "";
    state.nonStriker = op.nonStriker || "";
    state.bowler = op.bowler || "";

    // default active tab
    state.activeTeam = "A";
    setMsg("");
  }

  function computeStep(){
    const doc = (typeof opts.getDoc==="function") ? opts.getDoc() : null;
    const st = doc?.state || {};
    const { a, b } = getTeamsFromDoc(doc);
    const needXI = !hasXIInState(st, a, b);
    const needToss = !hasTossInState(st);
    const needOpening = !hasOpeningInState(st);
    if(needXI) return 0;
    if(needToss) return 1;
    if(needOpening) return 2;
    return 0;
  }

  function render(){
    // 🔥 One screen at a time: purge host completely.
    host.innerHTML = "";

    setDot(dotsEl, state.step);
    titleEl.textContent = (state.step===0) ? "Select Playing XI" : (state.step===1 ? "Toss" : "Opening Players");
    stepEl.textContent = `Step ${state.step+1}/${STEPS.length}`;

    btnBack.disabled = (state.step===0);
    btnNext.textContent = (state.step===2) ? "Start Match" : "Next";
    btnNext.disabled = true;

    if(state.step===0) renderStepXI();
    if(state.step===1) renderStepToss();
    if(state.step===2) renderStepOpening();

    // message banner
    if(state.msg){
      const msg = el("div","wizMsg", state.msg);
      host.prepend(msg);
    }
  }

  function renderStepXI(){
    const wrap = el("div","wizScreen");
    // Tabs
    const tabs = el("div","wizTabs");
    const tabA = el("button","wizTab" + (state.activeTeam==="A" ? " on" : ""), clampStr(state.a||"Team A"));
    const tabB = el("button","wizTab" + (state.activeTeam==="B" ? " on" : ""), clampStr(state.b||"Team B"));
    tabA.type="button"; tabB.type="button";
    tabA.addEventListener("click", ()=>{
      state.activeTeam="A"; setMsg(""); render();
    });
    tabB.addEventListener("click", ()=>{
      state.activeTeam="B"; setMsg(""); render();
    });
    tabs.appendChild(tabA); tabs.appendChild(tabB);

    // Counters
    const counters = el("div","wizCounters");
    counters.textContent = `${clampStr(state.a||"A")}: ${state.selA.size}/11   •   ${clampStr(state.b||"B")}: ${state.selB.size}/11`;

    // List
    const teamName = (state.activeTeam==="A") ? state.a : state.b;
    const squad = getSquadForTeam(state.squads, teamName);
    const selected = (state.activeTeam==="A") ? state.selA : state.selB;

    const help = el("div","wizH", `Select 11 players (${teamName})`);
    const sub = el("div","wizP", "15 में से exact 11 चुनें। 11 पूरे होने पर Next खुलेगा।");

    const list = el("div","wizList");
    (squad||[]).forEach(p=>{
      const name = (typeof p==="string") ? p : (p?.name || p?.player || JSON.stringify(p));
      const isOn = selected.has(name);
      const dis = (!isOn && selected.size>=11);
      const it = pill(name, isOn, dis);
      it.addEventListener("click", ()=>{
        if(selected.has(name)) selected.delete(name);
        else{
          if(selected.size>=11){ setMsg("Exact 11 players ही select हो सकते हैं।"); render(); return; }
          selected.add(name);
        }
        setMsg("");
        // Update counters without full rerender? easiest rerender for consistency; host purge is fine.
        render();
      });
      list.appendChild(it);
    });

    wrap.appendChild(tabs);
    wrap.appendChild(counters);
    wrap.appendChild(help);
    wrap.appendChild(sub);
    wrap.appendChild(list);

    host.appendChild(wrap);

    // Next enabled only when both complete
    btnNext.disabled = !(state.selA.size===11 && state.selB.size===11);
  }

  function renderStepToss(){
    const wrap = el("div","wizScreen");

    const h = el("div","tossHead","Toss");
    const p = el("div","tossSub","Toss winner और decision select करें।");
    wrap.appendChild(h);
    wrap.appendChild(p);

    // Winner cards
    const grid = el("div","tossGrid");
    const cA = el("button","tossCard" + (state.tossWinner===state.a ? " on" : ""), state.a || "Team A");
    const cB = el("button","tossCard" + (state.tossWinner===state.b ? " on" : ""), state.b || "Team B");
    cA.type="button"; cB.type="button";
    cA.addEventListener("click", ()=>{ state.tossWinner=state.a; setMsg(""); render(); });
    cB.addEventListener("click", ()=>{ state.tossWinner=state.b; setMsg(""); render(); });
    grid.appendChild(cA);
    grid.appendChild(cB);

    // Decision cards
    const grid2 = el("div","tossGrid");
    const bat = el("button","tossCard" + (state.tossDecision==="BAT" ? " on" : ""), "BAT");
    const bowl = el("button","tossCard" + (state.tossDecision==="BOWL" ? " on" : ""), "BOWL");
    bat.type="button"; bowl.type="button";
    bat.addEventListener("click", ()=>{ state.tossDecision="BAT"; setMsg(""); render(); });
    bowl.addEventListener("click", ()=>{ state.tossDecision="BOWL"; setMsg(""); render(); });
    grid2.appendChild(bat);
    grid2.appendChild(bowl);

    wrap.appendChild(grid);
    wrap.appendChild(el("div","tossSep","Decision"));
    wrap.appendChild(grid2);

    host.appendChild(wrap);

    btnNext.disabled = !(state.tossWinner && (state.tossDecision==="BAT" || state.tossDecision==="BOWL"));
  }

  function renderStepOpening(){
    const wrap = el("div","wizScreen");
    wrap.appendChild(el("div","wizH","Opening Setup"));
    wrap.appendChild(el("div","wizP","Innings start पर Striker/Non-striker और Opening Bowler select करें।"));

    const row1 = el("div","wizRow");
    const selStr = el("select","wizSelect");
    const selNon = el("select","wizSelect");
    const selBow = el("select","wizSelect");

    // Determine batting/bowling teams from doc state (after toss saved)
    const doc = (typeof opts.getDoc==="function") ? opts.getDoc() : null;
    const st = doc?.state || {};
    const xi = st.playingXI || {};
    const { a, b } = getTeamsFromDoc(doc);

    // batting first / bowling first can be inferred from innings[0] bindings OR toss decision
    const inn0 = st.innings?.[0] || {};
    const battingTeam = inn0.batting || st.battingFirst || st?.inningsBattingFirst || null;
    const bowlingTeam = inn0.bowling || st.bowlingFirst || st?.inningsBowlingFirst || null;

    const xiBat = (battingTeam && xi[battingTeam]) ? xi[battingTeam] : (xi[a] || []);
    const xiBowl = (bowlingTeam && xi[bowlingTeam]) ? xi[bowlingTeam] : (xi[b] || []);

    fillSelect(selStr, xiBat, "Striker");
    fillSelect(selNon, xiBat, "Non-striker");
    fillSelect(selBow, xiBowl, "Opening bowler");

    selStr.value = state.striker || "";
    selNon.value = state.nonStriker || "";
    selBow.value = state.bowler || "";

    selStr.addEventListener("change", ()=>{ state.striker = selStr.value; setMsg(""); btnNext.disabled = !isOpeningValid(); });
    selNon.addEventListener("change", ()=>{ state.nonStriker = selNon.value; setMsg(""); btnNext.disabled = !isOpeningValid(); });
    selBow.addEventListener("change", ()=>{ state.bowler = selBow.value; setMsg(""); btnNext.disabled = !isOpeningValid(); });

    row1.appendChild(selStr);
    row1.appendChild(selNon);
    wrap.appendChild(row1);
    wrap.appendChild(el("div","wizRow")).appendChild(selBow);

    host.appendChild(wrap);

    btnNext.disabled = !isOpeningValid();
  }

  function isOpeningValid(){
    if(!state.striker || !state.nonStriker || !state.bowler) return false;
    if(state.striker===state.nonStriker) return false;
    return true;
  }

  async function persistAndNext(){
    try{
      if(state.step===0){
        if(!(state.selA.size===11 && state.selB.size===11)){
          setMsg("Dono teams ke exact 11 players select karo।");
          render();
          return;
        }
        await opts.setPlayingXI(opts.FB, opts.matchId, Array.from(state.selA), Array.from(state.selB), null, null);
        state.step = 1;
        setMsg("");
        render();
        return;
      }
      if(state.step===1){
        if(!state.tossWinner){
          setMsg("Toss winner select karo।"); render(); return;
        }
        await opts.setToss(opts.FB, opts.matchId, state.tossWinner, state.tossDecision);
        state.step = 2;
        setMsg("");
        render();
        return;
      }
      if(state.step===2){
        if(!isOpeningValid()){
          setMsg("Striker, Non-striker aur Bowler sahi select karo।"); render(); return;
        }
        await opts.setOpeningSetup(opts.FB, opts.matchId, state.striker, state.nonStriker, state.bowler);
        setMsg("");
        close();
        if(typeof opts.onDone === "function") opts.onDone();
        return;
      }
    }catch(e){
      setMsg(e?.message || String(e));
      render();
    }
  }

  btnBack.addEventListener("click", ()=>{
    if(state.step<=0) return;
    state.step = Math.max(0, state.step-1);
    setMsg("");
    render();
  });
  btnNext.addEventListener("click", ()=>{
    persistAndNext();
  });

  function open(doc){
    snapshotFromDoc(doc);
    // Choose initial step based on doc state
    state.step = computeStep();
    wiz.classList.remove("hidden");
    render();
  }

  function close(){
    wiz.classList.add("hidden");
    host.innerHTML = "";
    setMsg("");
  }

  return {
    open,
    close,
    sync(doc){
      const openNow = shouldOpenForDoc(doc);
      if(openNow && wiz.classList.contains("hidden")) open(doc);
      if(!openNow && !wiz.classList.contains("hidden")) close();
    }
  };
}
