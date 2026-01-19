import { initFirebase, firebaseReady, tournamentRef, matchRef, matchesCol } from "./firebase.js";
import { emptyInnings, applyBall } from "./scoring-core.js";

export function getFB(){
  return initFirebase();
}

/**
 * Admin Init: Tournament meta + matches ensure.
 * IMPORTANT: page-admin.js uses ensureTournamentDocs + auth exports for login.
 */
export async function ensureTournamentDocs(FB, tournament){
  const { _f } = FB;
  const tRef = tournamentRef(FB);
  const tSnap = await _f.getDoc(tRef);

  if(!tSnap.exists()){
    await _f.setDoc(tRef, {
      name: tournament.name,
      season: tournament.season,
      dates: tournament.dates,
      oversPerInnings: tournament.oversPerInnings,
      powerplayOvers: tournament.powerplayOvers,
      maxOversPerBowler: tournament.maxOversPerBowler,
      ball: tournament.ball,
      groups: tournament.groups || [],
      teams: tournament.teams || [],
      venues: tournament.venues || [],
      squads: tournament.squads || {},
      createdAt: _f.serverTimestamp(),
      updatedAt: _f.serverTimestamp()
    });
  } else {
    // Keep meta + squads in sync
    await _f.updateDoc(tRef, {
      updatedAt: _f.serverTimestamp(),
      groups: tournament.groups || [],
      teams: tournament.teams || [],
      venues: tournament.venues || [],
      squads: tournament.squads || {}
    });
  }

  // Ensure match docs exist
  for(const m of (tournament.matches || [])){
    const mRef = matchRef(FB, m.matchId);
    const mSnap = await _f.getDoc(mRef);
    if(!mSnap.exists()){
      const state = newMatchState(tournament, m);
      await _f.setDoc(mRef, {
        ...m,
        status: "UPCOMING",
        state,
        summary: state.summary,
        updatedAt: _f.serverTimestamp(),
        createdAt: _f.serverTimestamp()
      });
    }
  }
}

/**
 * Match State (extended): toss + playingXI + balls + innings
 */
export function newMatchState(tournament, m){
  const oversPerInnings = tournament.oversPerInnings || 10;
  const powerplayOvers = Number(tournament.powerplayOvers ?? 3);
  const maxOversPerBowler = Number(tournament.maxOversPerBowler ?? 2);

  const st = {
    matchId: m.matchId,
    oversPerInnings,
    powerplayOvers,
    maxOversPerBowler,
    superOverOvers: Number(tournament.superOverOvers ?? 1),
    rules: tournament.rules || {},
    status: "UPCOMING",
    inningsIndex: 0,

    // innings format compatible with renderers
    innings: [
      emptyInnings(m.a, m.b),
      emptyInnings(m.b, m.a)
    ],

    // ball-by-ball
    balls: [],

    // Phase-2
    playingXI: {}, // { "TeamName":[11 players], ... }

    // Phase-1/2
    toss: null,

    // Super Over (auto when tie and enabled)
    superOver: null
  };

  st.summary = {
    status:"UPCOMING",
    inningsIndex:0,
    scoreText:"0/0",
    oversText:`0.0/${oversPerInnings}`,
    rr:0,
    powerplayOvers,
    batting:m.a,
    bowling:m.b
  };

  return st;
}

export async function setMatchStatus(FB, matchId, status){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found. Initialize first.");

  const docData = snap.data();
  const state = docData.state;
  state.status = status;
  state.summary.status = status;

  // Auto awards on match completion
  let awards = docData.awards || null;
  if(status === "COMPLETED"){
    awards = computeAwardsFromState(state);
    // Ensure result is present (manual completion)
    if(!docData.result && state?.result?.text){
      docData.result = { ...(state.result||{}), computedAt: Date.now() };
    }
  }

  await _f.updateDoc(mRef, {
    status,
    state,
    summary: state.summary,
    ...(awards ? { awards } : {}),
    ...(docData.result ? { result: docData.result } : {}),
    updatedAt: _f.serverTimestamp()
  });
}

// Reset a match back to UPCOMING with a fresh empty state (clears balls + innings)
export async function resetMatch(FB, matchId){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found. Initialize first.");

  const m = snap.data();
  const tSnap = await _f.getDoc(tournamentRef(FB));
  const tMeta = tSnap.exists() ? (tSnap.data()||{}) : {};

  const tournament = {
    oversPerInnings: tMeta.oversPerInnings || 10,
    powerplayOvers: tMeta.powerplayOvers ?? 3,
    maxOversPerBowler: tMeta.maxOversPerBowler ?? 2
  };
  const fresh = newMatchState(tournament, { matchId, a: m.a, b: m.b });

  await _f.updateDoc(mRef, {
    status: "UPCOMING",
    state: fresh,
    summary: fresh.summary,
    // Clear any derived/computed fields from a previously completed match
    awards: _f.deleteField(),
    result: _f.deleteField(),
    completedAt: _f.deleteField(),
    updatedAt: _f.serverTimestamp()
  });
}

/**
 * Toss: winner + decision, then bind innings batting/bowling.
 */
export async function setToss(FB, matchId, winner, decision){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found. Initialize first.");

  const docData = snap.data();
  const a = docData.a, b = docData.b;

  if(!winner || (winner!==a && winner!==b)) throw new Error("Invalid toss winner");
  decision = (decision||"BAT").toUpperCase();
  if(decision!=="BAT" && decision!=="BOWL") decision="BAT";

  const other = (winner===a) ? b : a;
  const battingFirst = (decision==="BAT") ? winner : other;
  const bowlingFirst = (decision==="BAT") ? other : winner;

  const state = docData.state || newMatchState({ oversPerInnings: 10 }, { matchId, a, b });
  state.toss = { winner, decision, at: Date.now() };

  // innings bindings
  state.innings = state.innings || [ emptyInnings(a,b), emptyInnings(b,a) ];
  state.innings[0] = state.innings[0] || emptyInnings(battingFirst, bowlingFirst);
  state.innings[1] = state.innings[1] || emptyInnings(bowlingFirst, battingFirst);

  state.innings[0].batting = battingFirst;
  state.innings[0].bowling = bowlingFirst;
  state.innings[1].batting = bowlingFirst;
  state.innings[1].bowling = battingFirst;

  state.status = "UPCOMING";
  state.inningsIndex = 0;

  state.summary = state.summary || {};
  state.summary.status = "UPCOMING";
  state.summary.inningsIndex = 0;
  state.summary.batting = battingFirst;
  state.summary.bowling = bowlingFirst;

  await _f.updateDoc(mRef, {
    tossWinner: winner,
    tossDecision: decision,
    battingFirst,
    bowlingFirst,
    status: "UPCOMING",
    state,
    summary: state.summary,
    updatedAt: _f.serverTimestamp()
  });
}

/**
 * Phase-2: Save Playing XI (11 each)
 */
// Save Playing XI + mandatory meta (captain/vice-captain/wicket-keeper)
export async function setPlayingXI(FB, matchId, teamA_XI, teamB_XI, metaA=null, metaB=null){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found. Initialize first.");

  const m = snap.data();
  const a = m.a, b = m.b;

  const xiA = Array.isArray(teamA_XI) ? teamA_XI.filter(Boolean) : [];
  const xiB = Array.isArray(teamB_XI) ? teamB_XI.filter(Boolean) : [];

  if(xiA.length !== 11) throw new Error(`${a} ke liye exact 11 players select karo`);
  if(xiB.length !== 11) throw new Error(`${b} ke liye exact 11 players select karo`);

  // Meta validation (optional in older matches, but scorer UI enforces)
  const validateMeta = (teamName, xi, meta)=>{
    if(!meta) return null;
    const cap = (meta.captainId||"").toString().trim();
    const vc  = (meta.viceCaptainId||"").toString().trim();
    const wk  = (meta.wicketKeeperId||"").toString().trim();
    if(!cap || !vc || !wk) throw new Error(`${teamName}: Captain, Vice-Captain aur Wicket-Keeper mandatory hai`);
    if(!xi.includes(cap)) throw new Error(`${teamName}: Captain XI me hona chahiye`);
    if(!xi.includes(vc)) throw new Error(`${teamName}: Vice-Captain XI me hona chahiye`);
    if(!xi.includes(wk)) throw new Error(`${teamName}: Wicket-Keeper XI me hona chahiye`);
    if(cap === vc) throw new Error(`${teamName}: Captain aur Vice-Captain same nahi ho sakte`);
    return { captainId: cap, viceCaptainId: vc, wicketKeeperId: wk };
  };
  const mA = validateMeta(a, xiA, metaA);
  const mB = validateMeta(b, xiB, metaB);

  const state = m.state || newMatchState({ oversPerInnings: (m.state?.oversPerInnings||10) }, { matchId, a, b });
  state.playingXI = state.playingXI || {};
  state.playingXI[a] = xiA;
  state.playingXI[b] = xiB;

  if(mA || mB){
    state.playingXIMeta = state.playingXIMeta || {};
    if(mA) state.playingXIMeta[a] = mA;
    if(mB) state.playingXIMeta[b] = mB;
  }

  await _f.updateDoc(mRef, { state, updatedAt: _f.serverTimestamp() });
}

// Save opening setup for current innings (2 openers + opening bowler)
export async function setOpeningSetup(FB, matchId, striker, nonStriker, bowler){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found. Initialize first.");

  const m = snap.data();
  const state = m.state;
  if(!state) throw new Error("State missing. Reset match first.");

  const a = m.a, b = m.b;
  const hasToss = !!(state.toss || m.tossWinner);
  const hasXI = !!(state.playingXI && state.playingXI[a]?.length===11 && state.playingXI[b]?.length===11);
  if(!hasToss) throw new Error("Toss pending. Pehele Toss save karo.");
  if(!hasXI) throw new Error("Playing XI pending. Dono teams ke 11-11 players select karo.");

  const idx = Number(state.inningsIndex||0);
  state.innings = state.innings || [];
  state.innings[idx] = state.innings[idx] || emptyInnings("", "");
  const inn = state.innings[idx];
  inn.onField = inn.onField || {};

  const s = (striker||"").toString().trim();
  const ns = (nonStriker||"").toString().trim();
  const bo = (bowler||"").toString().trim();
  if(!s || !ns || !bo) throw new Error("Opening setup: 2 openers aur 1 bowler mandatory hai");
  if(s === ns) throw new Error("Opening batsmen same nahi ho sakte");

  // Validate from XI
  const batting = inn.batting || state.summary?.batting || m.battingFirst || a;
  const bowling = inn.bowling || state.summary?.bowling || m.bowlingFirst || b;
  const batXI = state.playingXI?.[batting] || [];
  const bowlXI = state.playingXI?.[bowling] || [];
  if(!batXI.includes(s) || !batXI.includes(ns)) throw new Error("Openers batting XI se hone chahiye");
  if(!bowlXI.includes(bo)) throw new Error("Bowler bowling XI se hona chahiye");

  // Bowler must not be wicket keeper
  const wkId = state.playingXIMeta?.[bowling]?.wicketKeeperId;
  if(wkId && wkId === bo) throw new Error("Bowler wicket-keeper nahi ho sakta");

  // Apply
  inn.onField.striker = s;
  inn.onField.nonStriker = ns;
  inn.onField.bowler = bo;
  // Mark opening as completed so UI never shows opening card again once match has started.
  // (Needed because bowler can be cleared at over end, but opening setup shouldn't re-appear.)
  inn.openingDone = true;
  inn.onField.needNewBowler = false;
  inn.onField.needNextBatter = false;
  inn.onField.vacantSlot = "";

  await _f.updateDoc(mRef, { state, updatedAt: _f.serverTimestamp() });
}

export async function addBall(FB, matchId, ball){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found. Initialize first.");

  const docData = snap.data();
  const state = docData.state;
  if(!state) throw new Error("State missing. Reset match first.");

  // ✅ Block scoring after completion (auto-complete or manual)
  if((docData.status||state.status) === "COMPLETED"){
    throw new Error("Match COMPLETED. Ab scoring nahi hogi.");
  }

  // ✅ Enforce match setup before scoring
  // If someone mistakenly logs a ball early, the match flips to LIVE and the UI setup cards can hide.
  // We block scoring until Toss + Playing XI are saved.
  const hasToss = !!(state.toss || docData.tossWinner);
  const a = docData.a, b = docData.b;
  const hasXI = !!(state.playingXI && state.playingXI[a]?.length === 11 && state.playingXI[b]?.length === 11);
  if(!hasToss) throw new Error("Toss pending. Pehele Toss save karo.");
  if(!hasXI) throw new Error("Playing XI pending. Dono teams ke 11-11 players select karo.");

  // ✅ Opening setup gate
  // NOTE: Bowler can be cleared at over end (needNewBowler=true). That should NOT re-trigger
  // the "opening setup pending" error once innings has started.
  const idxGate = Number(state.inningsIndex||0);
  const innGate = state.innings?.[idxGate];
  const hasOpeners = !!(innGate?.onField?.striker && innGate?.onField?.nonStriker);
  const inningsStarted = (
    !!innGate?.openingDone ||
    Number(innGate?.ballsTotal || 0) > 0 ||
    Number(innGate?.legalBalls || 0) > 0 ||
    Number(innGate?.runs || 0) > 0 ||
    (Array.isArray(innGate?.ballByBall) && innGate.ballByBall.length > 0)
  );
  if(!hasOpeners && !inningsStarted){
    throw new Error("Opening setup pending. 2 openers aur opening bowler select karke Save karo.");
  }
  // If innings already started, we only need *current* bowler selection (not 'opening setup').
  // NOTE: At over-end we intentionally clear inn.onField.bowler (needNewBowler=true).
  // The scorer UI sends the selected bowler with each ball as ball.bowler, so accept that too.
  const ballBowler = (ball?.bowler || "").toString().trim();
  if(inningsStarted && !(innGate?.onField?.bowler || ballBowler)){
    throw new Error("Bowler pending. New bowler select karo.");
  }

  // ✅ Enforce max overs per bowler (default 2 overs = 12 legal balls)
  const idx = Number(state.inningsIndex||0);
  const maxOversPerBowler = Number((idx>=2)? 1 : (state.maxOversPerBowler ?? 2));
  const maxBowlerBalls = Math.max(0, maxOversPerBowler * 6);
  const inn = state.innings?.[idx];
  const bowlerName = (ball.bowler || inn?.onField?.bowler || "").toString().trim();
  const type = (ball.type || "RUN").toString().toUpperCase();
  const legal = (type !== "WD" && type !== "NB");
  if(legal && maxBowlerBalls>0 && bowlerName){
    const oBalls = Number(inn?.bowlers?.[bowlerName]?.oBalls || 0);
    if(oBalls >= maxBowlerBalls){
      throw new Error(`${bowlerName} max ${maxOversPerBowler} overs already. New bowler select karo.`);
    }
  }

  if(state.status!=="LIVE"){
    state.status="LIVE";
    docData.status="LIVE";
  }

  ball.seq = (state.balls?.length||0)+1;
  ball.at = Date.now();
  state.balls = state.balls || [];
  state.balls.push(ball);

  applyBall(state, ball);

  // ✅ If chase completed / overs finished / tie -> auto mark COMPLETED and compute awards + result
  let patch = {
    status: state.status,
    state,
    summary: state.summary,
    updatedAt: _f.serverTimestamp()
  };

  if(state.status === "COMPLETED"){
    // awards (persist)
    const awards = computeAwardsFromState(state);
    patch.awards = awards;

    // result text (persist)
    if(state.result?.text){
      patch.result = {
        ...(state.result||{}),
        computedAt: Date.now()
      };
      // keep doc-level convenience for renderers
      state.summary = state.summary || {};
      state.summary.resultText = state.result.text;
      patch.summary = state.summary;
    }
  }

  await _f.updateDoc(mRef, patch);
}

// -----------------------------
// Awards (MoM / Sixer King / Best Bowler)
// -----------------------------
function computeAwardsFromState(st){
  const innings = Array.isArray(st?.innings) ? st.innings : [];
  const playerMap = new Map(); // name -> {name, team, bat, bowl, field}

  const upsert = (name, team)=>{
    if(!name) return null;
    const key = name.toString();
    if(!playerMap.has(key)){
      playerMap.set(key, {
        name:key,
        team: team || "",
        bat:{r:0,b:0,f4:0,f6:0,outs:0},
        bowl:{balls:0,r:0,w:0,wd:0,nb:0},
        field:{catches:0,runouts:0,stumpings:0}
      });
    }
    const p = playerMap.get(key);
    if(team && !p.team) p.team = team;
    return p;
  };

  for(const inn of innings){
    const batTeam = inn?.batting || "";
    const bowlTeam = inn?.bowling || "";
    const batters = inn?.batters || {};
    const bowlers = inn?.bowlers || {};
    const fielding = inn?.fielding || {};

    for(const [n, b] of Object.entries(batters)){
      const p = upsert(n, batTeam);
      if(!p) continue;
      p.bat.r += Number(b?.r||0);
      p.bat.b += Number(b?.b||0);
      p.bat.f4 += Number(b?.f4||0);
      p.bat.f6 += Number(b?.f6||0);
      p.bat.outs += (b?.out ? 1 : 0);
    }
    for(const [n, b] of Object.entries(bowlers)){
      const p = upsert(n, bowlTeam);
      if(!p) continue;
      p.bowl.balls += Number(b?.oBalls||0);
      p.bowl.r += Number(b?.r||0);
      p.bowl.w += Number(b?.w||0);
      p.bowl.wd += Number(b?.wd||0);
      p.bowl.nb += Number(b?.nb||0);
    }
    for(const [n, f] of Object.entries(fielding)){
      const p = upsert(n, bowlTeam);
      if(!p) continue;
      p.field.catches += Number(f?.catches||0);
      p.field.runouts += Number(f?.runouts||0);
      p.field.stumpings += Number(f?.stumpings||0);
    }
  }

  const players = Array.from(playerMap.values());

  // Sixer King
  let sixerKing = null;
  for(const p of players){
    if(!sixerKing || p.bat.f6 > sixerKing.sixes){
      sixerKing = { name:p.name, team:p.team, sixes:p.bat.f6 };
    }
  }

  // Best Bowler: max wickets, then lower runs, then lower econ
  let bestBowler = null;
  for(const p of players){
    const w = p.bowl.w;
    if(w<=0) continue;
    const balls = p.bowl.balls;
    const overs = balls>0 ? (balls/6) : 0;
    const econ = overs>0 ? (p.bowl.r/overs) : 999;
    const cand = { name:p.name, team:p.team, wickets:w, runs:p.bowl.r, balls, econ: Math.round(econ*100)/100 };
    if(!bestBowler) bestBowler = cand;
    else {
      if(cand.wickets > bestBowler.wickets) bestBowler = cand;
      else if(cand.wickets === bestBowler.wickets){
        if(cand.runs < bestBowler.runs) bestBowler = cand;
        else if(cand.runs === bestBowler.runs && cand.econ < bestBowler.econ) bestBowler = cand;
      }
    }
  }

  // Man of the Match: simple weighted score
  let mom = null;
  for(const p of players){
    const batting = p.bat.r + (p.bat.f4*1) + (p.bat.f6*2);
    const bowling = (p.bowl.w*25) + (p.bowl.balls>0 ? Math.max(0, 20 - (p.bowl.r/Math.max(1,p.bowl.balls/6))*2) : 0);
    const field = (p.field.catches*10) + (p.field.runouts*12) + (p.field.stumpings*12);
    const score = Math.round((batting + bowling + field)*100)/100;
    const cand = { name:p.name, team:p.team, score };
    if(!mom || cand.score > mom.score) mom = cand;
  }

  return {
    mom,
    sixerKing,
    bestBowler,
    computedAt: Date.now()
  };
}

export async function finalizeMatchAndComputeAwards(FB, matchId){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found.");
  const docData = snap.data();
  const st = docData.state;
  if(!st) throw new Error("State missing.");
  const awards = computeAwardsFromState(st);
  await _f.updateDoc(mRef, { awards, updatedAt: _f.serverTimestamp() });
  return awards;
}

export async function undoBall(FB, matchId){
  const { _f } = FB;
  const mRef = matchRef(FB, matchId);
  const snap = await _f.getDoc(mRef);
  if(!snap.exists()) throw new Error("Match doc not found.");

  const docData = snap.data();
  const state = docData.state;
  if(!state?.balls || state.balls.length===0) return;

  // Keep toss + XI
  const toss = state.toss || null;
  const playingXI = state.playingXI || {};

  // Build fresh
  const tournamentSnap = await _f.getDoc(tournamentRef(FB));
  const tMeta = tournamentSnap.exists() ? (tournamentSnap.data()||{}) : {};
  const oversPerInnings = tMeta.oversPerInnings || 10;
  const powerplayOvers = tMeta.powerplayOvers ?? 3;
  const maxOversPerBowler = tMeta.maxOversPerBowler ?? 2;

  const fresh = newMatchState({ oversPerInnings, powerplayOvers, maxOversPerBowler }, { a: docData.a, b: docData.b, matchId });
  fresh.toss = toss;
  fresh.playingXI = playingXI;

  // replay except last
  const balls = state.balls.slice(0, -1);
  for(const b of balls){
    fresh.balls.push(b);
    applyBall(fresh, b);
  }

  await _f.updateDoc(mRef, { status: fresh.status, state: fresh, summary: fresh.summary, updatedAt: _f.serverTimestamp() });
}

export function watchAllMatches(FB, cb){
  const { _f } = FB;
  const q = _f.query(matchesCol(FB), _f.orderBy("matchId","asc"));
  return _f.onSnapshot(q, (snap)=>{
    const arr = [];
    snap.forEach(d=>arr.push({id:d.id, ...d.data()}));
    cb(arr);
  });
}

export function watchMatch(FB, matchId, cb){
  const { _f } = FB;
  return _f.onSnapshot(matchRef(FB, matchId), (snap)=>{
    cb(snap.exists()? {id:snap.id, ...snap.data()} : null);
  });
}

/** ✅ AUTH EXPORTS (Login fix) */
export async function signIn(FB, email, pass){
  const { _f, auth } = FB;
  return await _f.signInWithEmailAndPassword(auth, email, pass);
}
export async function signOutUser(FB){
  const { _f, auth } = FB;
  return await _f.signOut(auth);
}
export function watchAuth(FB, cb){
  const { _f, auth } = FB;
  return _f.onAuthStateChanged(auth, cb);
}
