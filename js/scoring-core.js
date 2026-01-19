// scoring-core.js
// 10-over tournament compatible scoring core (mutates state)

function normalizeInnings(inn){
  if(!inn) return inn;

  if(inn.balls == null && inn.ballsLegal != null) inn.balls = Number(inn.ballsLegal||0);
  if(inn.wkts == null && inn.wickets != null) inn.wkts = Number(inn.wickets||0);

  inn.runs = Number(inn.runs||0);
  inn.wkts = Number(inn.wkts||0);
  inn.balls = Number(inn.balls||0);
  inn.ballsTotal = Number(inn.ballsTotal||0);

  inn.batting = (inn.batting ?? inn.battingTeam ?? "").toString();
  inn.bowling = (inn.bowling ?? inn.bowlingTeam ?? "").toString();

  inn.extras = inn.extras || { wd:0, nb:0, b:0, lb:0 };
  inn.extras.wd = Number(inn.extras.wd||0);
  inn.extras.nb = Number(inn.extras.nb||0);
  inn.extras.b  = Number(inn.extras.b||0);
  inn.extras.lb = Number(inn.extras.lb||0);

  inn.batters = inn.batters || {};
  inn.bowlers = inn.bowlers || {};
  inn.fow = inn.fow || [];

  // v2 logs + partnerships
  inn.ballByBall = Array.isArray(inn.ballByBall) ? inn.ballByBall : [];
  inn.partnership = inn.partnership || { runs:0, balls:0, batsman1Id:"", batsman2Id:"" };
  inn.partnerships = Array.isArray(inn.partnerships) ? inn.partnerships : [];

  // ✅ NEW: fielding stats map
  inn.fielding = inn.fielding || {}; // name -> {catches, runouts, stumpings}

  inn.onField = inn.onField || {
    striker: "",
    nonStriker: "",
    bowler: "",
    freeHit: false,
    ballsThisOver: 0,
    needNewBowler: false,
    lastBowler: "",
    needNextBatter: false,
    vacantSlot: ""
  };
  inn.onField.ballsThisOver = Number(inn.onField.ballsThisOver||0);
  inn.onField.freeHit = !!inn.onField.freeHit;
  inn.onField.needNewBowler = !!inn.onField.needNewBowler;
  inn.onField.needNextBatter = !!inn.onField.needNextBatter;
  inn.onField.vacantSlot = (inn.onField.vacantSlot||"").toString();

  return inn;
}

export function emptyInnings(batting, bowling){
  return normalizeInnings({
    batting,
    bowling,
    runs:0,
    wkts:0,
    balls:0,
    ballsTotal:0,
    overs:"0.0",
    extras:{ wd:0, nb:0, b:0, lb:0 },
    batters:{},
    bowlers:{},
    fow:[],
    ballByBall:[],
    partnership:{ runs:0, balls:0, batsman1Id:"", batsman2Id:"" },
    partnerships:[],
    fielding:{}, // ✅ NEW
    onField:{
      striker:"",
      nonStriker:"",
      bowler:"",
      freeHit:false,
      ballsThisOver:0,
      needNewBowler:false,
      lastBowler:"",
      needNextBatter:false,
      vacantSlot:""
    }
  });
}

function ensureBatter(inn, name){
  if(!name) return null;
  if(!inn.batters[name]){
    inn.batters[name] = { r:0, b:0, f4:0, f6:0, out:false, how:"" };
  }

  inn.batters[name].name = name;
  return inn.batters[name];
}

function ensureBowler(inn, name){
  if(!name) return null;
  if(!inn.bowlers[name]){
    inn.bowlers[name] = { oBalls:0, r:0, w:0, wd:0, nb:0, maidens:0, _overRuns:0, _overLegal:0 };
  }
  inn.bowlers[name].name = name;
  return inn.bowlers[name];
}

// ✅ NEW: fielding stat
function ensureFielder(inn, name){
  if(!name) return null;
  inn.fielding = inn.fielding || {};
  if(!inn.fielding[name]){
    inn.fielding[name] = { catches:0, runouts:0, stumpings:0 };
  }
  inn.fielding[name].name = name;
  return inn.fielding[name];
}

function oversTextFromBalls(balls){
  const o = Math.floor(balls/6);
  const b = balls%6;
  return `${o}.${b}`;
}

function updateSummary(st){
  const idx = Number(st.inningsIndex||0);
  const inn = normalizeInnings(st.innings[idx] || emptyInnings("", ""));
  const inSuper = Number(st.inningsIndex||0) >= 2;
  const oversLimit = inSuper ? Number(st.superOverOvers||1) : Number(st.oversPerInnings||10);
  const oversText = `${oversTextFromBalls(inn.balls)}/${oversLimit}`;
  const rr = inn.balls > 0 ? ((inn.runs*6)/inn.balls) : 0;

  st.summary = st.summary || {};
  st.summary.status = st.status || "UPCOMING";
  st.summary.inningsIndex = idx;
  st.summary.scoreText = `${inn.runs}/${inn.wkts}`;
  st.summary.oversText = oversText;
  st.summary.rr = Math.round(rr*100)/100;
  // Powerplay info (default 3 overs)
  const pp = Number(st.powerplayOvers ?? 3);
  const overNo = Math.floor((Number(inn.balls||0))/6) + (Number(inn.balls||0)%6>0?1:0);
  st.summary.powerplayOvers = pp;
  st.summary.inPowerplay = pp>0 && overNo > 0 && overNo <= pp;
  if(!st.summary.batting) st.summary.batting = inn.batting || "";
  if(!st.summary.bowling) st.summary.bowling = inn.bowling || "";
}

// ball schema:
// { type:'RUN'|'WD'|'NB'|'BYE'|'WICKET', runs:number, batter, nonStriker, bowler, wicketKind?, outBatter?, nextBatter?, fielder? }
export function applyBall(state, ball){
  if(!state || !ball) return;
  state.innings = state.innings || [];
  state.inningsIndex = Number(state.inningsIndex||0);

  const inn = normalizeInnings(state.innings[state.inningsIndex] || emptyInnings("", ""));
  state.innings[state.inningsIndex] = inn;

  const batterName = (ball.batter || inn.onField.striker || "").toString();
  const nonStrikerName = (ball.nonStriker || inn.onField.nonStriker || "").toString();
  const bowlerName = (ball.bowler || inn.onField.bowler || "").toString();
  if(batterName) inn.onField.striker = batterName;
  if(nonStrikerName) inn.onField.nonStriker = nonStrikerName;
  if(bowlerName) inn.onField.bowler = bowlerName;

  const type = (ball.type || "RUN").toString().toUpperCase();
  const runsIn = Number(ball.runs||0);

  // Free hit (next delivery after NO-BALL)
  const freeHitAtStart = !!inn.onField.freeHit;
  let willSetFreeHit = false;

  // Track total deliveries (incl. illegal)
  inn.ballsTotal = Number(inn.ballsTotal||0) + 1;

  const bat = ensureBatter(inn, batterName);
  ensureBatter(inn, nonStrikerName);
  const bowl = ensureBowler(inn, bowlerName);

  let legal = true;
  let addRunsToTotal = 0;

  // Extras handling
  // Convention:
  //  - WD / NB: ball.runs means TOTAL runs to add for the delivery (minimum 1).
  //    Example: wide that goes for 3 total -> type:'WD', runs:3
  //    Example: no-ball + 4 off the bat -> type:'NB', runs:5, batRuns:4
  //  - BYE / LB / RUN: ball.runs are the runs added (legal delivery).

  let illegalRunningRuns = 0; // runs taken (excluding the 1-run penalty on WD/NB) used for strike swap

  if(type === "WD"){
    legal = false;
    const total = Math.max(1, Number(runsIn||0));
    illegalRunningRuns = Math.max(0, total - 1);
    inn.extras.wd += total;
    if(bowl) bowl.wd += total;
    addRunsToTotal = total;
  } else if(type === "NB"){
    legal = false;
    const total = Math.max(1, Number(runsIn||0));
    illegalRunningRuns = Math.max(0, total - 1);
    inn.extras.nb += 1;
    if(bowl) bowl.nb += 1;
    addRunsToTotal = total;

    // ✅ Free hit next ball (remains active if next ball is again WD/NB)
    willSetFreeHit = true;

    // Optional: credit bat runs on no-ball
    const batRuns = Math.max(0, Number(ball.batRuns||0));
    if(bat && batRuns>0){
      bat.r += batRuns;
      if(batRuns === 4) bat.f4 += 1;
      if(batRuns === 6) bat.f6 += 1;
    }
    // Remaining runs (other than batRuns) treat as byes for simplicity
    const other = Math.max(0, illegalRunningRuns - batRuns);
    if(other>0) inn.extras.b += other;
  } else if(type === "LB"){
    legal = true;
    inn.extras.lb += runsIn;
    addRunsToTotal = runsIn;
  } else if(type === "BYE"){

    legal = true;
    inn.extras.b += runsIn;
    addRunsToTotal = runsIn;
  } else if(type === "RUN"){
    legal = true;
    addRunsToTotal = runsIn;
  } else if(type === "WICKET"){
    // WICKET can be on LEGAL / WD / NB with optional runs
    const delivery = (ball.delivery || "LEGAL").toString().toUpperCase(); // LEGAL|WD|NB
    if(delivery === "WD"){
      legal = false;
      const total = Math.max(1, 1 + Math.max(0, runsIn)); // base 1 + additional
      illegalRunningRuns = Math.max(0, total - 1);
      inn.extras.wd += total;
      if(bowl) bowl.wd += total;
      addRunsToTotal = total;
    } else if(delivery === "NB"){
      legal = false;
      const total = Math.max(1, 1 + Math.max(0, runsIn));
      illegalRunningRuns = Math.max(0, total - 1);
      inn.extras.nb += 1;
      if(bowl) bowl.nb += 1;
      addRunsToTotal = total;

      // ✅ No-ball wicket delivery still gives free-hit next
      willSetFreeHit = true;
    } else {
      legal = true;
      addRunsToTotal = Math.max(0, runsIn);
    }
  }

  inn.runs += addRunsToTotal;
  if(bowl) bowl.r += addRunsToTotal;
  if(bowl){
    bowl._overRuns = Number(bowl._overRuns||0) + addRunsToTotal;
    if(legal) bowl._overLegal = Number(bowl._overLegal||0) + 1;
  }

  // partnership: runs always count; balls count only for legal deliveries
  inn.partnership = inn.partnership || { runs:0, balls:0, batsman1Id:"", batsman2Id:"" };
  if(!inn.partnership.batsman1Id || !inn.partnership.batsman2Id){
    inn.partnership.batsman1Id = inn.onField.striker || batterName || "";
    inn.partnership.batsman2Id = inn.onField.nonStriker || nonStrikerName || "";
  }
  inn.partnership.runs += addRunsToTotal;

  // Strike swap on illegal deliveries
  // - WD: optionally swap based on TOTAL runs parity (state.rules.wideStrikeOnTotal=true),
  //       else swap based on runs taken between wickets (excluding 1-run penalty).
  // - NB: swap based on runs taken between wickets (excluding 1-run penalty).
  const isIllegalWide = (!legal) && (type === "WD" || (type==="WICKET" && (ball.delivery||"").toString().toUpperCase()==="WD"));
  const isIllegalNB   = (!legal) && (type === "NB" || (type==="WICKET" && (ball.delivery||"").toString().toUpperCase()==="NB"));
  if(isIllegalWide || isIllegalNB){
    const wideOnTotal = !!state?.rules?.wideStrikeOnTotal;
    const parity = isIllegalWide && wideOnTotal ? (addRunsToTotal % 2) : (illegalRunningRuns % 2);
    if(parity === 1){
      const tmp = inn.onField.striker;
      inn.onField.striker = inn.onField.nonStriker;
      inn.onField.nonStriker = tmp;
    }
  }

  if(legal){
    inn.balls = Number(inn.balls||0) + 1;
    inn.overs = oversTextFromBalls(inn.balls);
    if(bowl) bowl.oBalls += 1;
    if(bat) bat.b += 1;

    inn.onField.ballsThisOver = Number(inn.onField.ballsThisOver||0) + 1;

    inn.partnership.balls += 1;

    if((type === "RUN" || type === "BYE" || type === "LB") && (addRunsToTotal % 2 === 1)){
      const tmp = inn.onField.striker;
      inn.onField.striker = inn.onField.nonStriker;
      inn.onField.nonStriker = tmp;
    }

    if(inn.onField.ballsThisOver >= 6){
      // maiden detection
      if(bowl && Number(bowl._overLegal||0) >= 6){
        if(Number(bowl._overRuns||0) === 0) bowl.maidens = Number(bowl.maidens||0) + 1;
        bowl._overRuns = 0;
        bowl._overLegal = 0;
      }
      inn.onField.ballsThisOver = 0;
      const tmp = inn.onField.striker;
      inn.onField.striker = inn.onField.nonStriker;
      inn.onField.nonStriker = tmp;

      inn.onField.needNewBowler = true;
      inn.onField.lastBowler = bowlerName;
      inn.onField.bowler = "";
    } else {
      inn.onField.needNewBowler = false;
    }
  }

  if(type === "RUN" && bat){
    bat.r += runsIn;
    if(runsIn === 4) bat.f4 += 1;
    if(runsIn === 6) bat.f6 += 1;
  }

  // -----------------------------
  // ✅ Wicket legality rules (Wide/No-ball + Free Hit)
  // - No-ball: only Run Out is allowed
  // - Wide: Run Out and Stumped allowed
  // - Free hit (next ball after NB): only Run Out allowed (if next delivery is WD/NB, free hit carries)
  // -----------------------------
  let wicketApplied = true;
  let wicketDisallowedReason = "";
  if(type === "WICKET"){
    const delivery = (ball.delivery || "LEGAL").toString().toUpperCase();
    const kind = (ball.wicketKind || "W").toString();
    const kindLc = kind.toLowerCase();
    const isRunOut = (kindLc === "run out");
    const isStumped = (kindLc === "stumped");

    // Disallow per delivery type
    const disallowOnNB = (delivery === "NB") && !isRunOut;
    const disallowOnWD = (delivery === "WD") && !(isRunOut || isStumped);

    // Disallow on free hit for legal deliveries
    const disallowOnFreeHit = freeHitAtStart && (delivery === "LEGAL") && !isRunOut;

    if(disallowOnNB || disallowOnWD || disallowOnFreeHit){
      wicketApplied = false;
      wicketDisallowedReason = disallowOnFreeHit ? "FREE_HIT" : (delivery === "NB" ? "NO_BALL" : "WIDE");
    }
  }

  // Wicket + fielder stats
  if(type === "WICKET" && wicketApplied){
    const outName = ball.outBatter || batterName;
    const outB = ensureBatter(inn, outName);
    const kind = (ball.wicketKind || "W").toString();
    const kindLc = kind.toLowerCase();
    const fielderName = (ball.fielder || "").toString().trim();

    if(outB && !outB.out){
      // Close partnership and record it
      if(inn.partnership){
        inn.partnerships = Array.isArray(inn.partnerships) ? inn.partnerships : [];
        inn.partnerships.push({
          batsman1Id: inn.partnership.batsman1Id,
          batsman2Id: inn.partnership.batsman2Id,
          runs: Number(inn.partnership.runs||0),
          balls: Number(inn.partnership.balls||0)
        });
      }

      outB.out = true;
      outB.how = kind;
      outB.outInfo = { kind, fielder: fielderName||null, bowler: bowlerName||null, crossed: !!ball.crossed, delivery: (ball.delivery||"LEGAL") };
      inn.wkts += 1;

      // bowler wicket credit unless run out
      if(kindLc !== "run out" && bowl) bowl.w += 1;

      // ✅ fielder credit
      if(fielderName){
        const f = ensureFielder(inn, fielderName);
        if(f){
          if(kindLc === "caught") f.catches += 1;
          else if(kindLc === "run out") f.runouts += 1;
          else if(kindLc === "stumped") f.stumpings += 1;
        }
      }

      inn.fow.push({ wkt: inn.wkts, runs: inn.runs, over: inn.overs, batter: outName, how: outB.how });

      // Reset partnership for new pair (after replacing batter)
      inn.partnership = { runs:0, balls:0, batsman1Id:"", batsman2Id:"" };

      // Simple crossed handling for run-out
      if(kindLc === "run out" && ball.crossed){
        const t = inn.onField.striker;
        inn.onField.striker = inn.onField.nonStriker;
        inn.onField.nonStriker = t;
      }

      if(outName === inn.onField.striker){
        inn.onField.striker = "";
        inn.onField.needNextBatter = true;
        inn.onField.vacantSlot = "striker";
      } else if(outName === inn.onField.nonStriker){
        inn.onField.nonStriker = "";
        inn.onField.needNextBatter = true;
        inn.onField.vacantSlot = "nonStriker";
      }

      if(inn.onField.needNextBatter && ball.nextBatter){
        if(inn.onField.vacantSlot === "nonStriker") inn.onField.nonStriker = ball.nextBatter;
        else inn.onField.striker = ball.nextBatter;
        inn.onField.needNextBatter = false;
        inn.onField.vacantSlot = "";
      }
    }
  }

  // -----------------------------
  // ✅ Free hit state update
  // - Consumed only on a LEGAL delivery (i.e., after the next legal ball)
  // - If the free-hit delivery is a WD/NB, it carries to the next delivery
  // -----------------------------
  if(legal && freeHitAtStart){
    inn.onField.freeHit = false;
  }
  if(willSetFreeHit){
    inn.onField.freeHit = true;
  }

  // ball-by-ball log (per innings)
  inn.ballByBall = Array.isArray(inn.ballByBall) ? inn.ballByBall : [];
  inn.ballByBall.push({
    seq: inn.ballByBall.length+1,
    over: inn.overs,
    ballsLegal: inn.balls,
    ballsTotal: inn.ballsTotal,
    type,
    legal,
    runsTotal: addRunsToTotal,
    runsInput: runsIn,
    extras: { wd: inn.extras.wd, nb: inn.extras.nb, bye: inn.extras.b, legbye: inn.extras.lb },
    strikerId: inn.onField.striker,
    nonStrikerId: inn.onField.nonStriker,
    bowlerId: bowlerName,
    freeHit: freeHitAtStart,
    wicketApplied: type==="WICKET" ? !!wicketApplied : null,
    wicketDisallowedReason: type==="WICKET" && !wicketApplied ? wicketDisallowedReason : null,
    wicket: (type==="WICKET" && wicketApplied) ? {
      kind: (ball.wicketKind||""),
      outBatterId: (ball.outBatter||""),
      fielderId: (ball.fielder||""),
      crossed: !!ball.crossed,
      delivery: (ball.delivery||"LEGAL"),
      nextBatterId: (ball.nextBatter||"")
    } : null,
    at: Number(ball.at||Date.now())
  });

  const inSuper = Number(state.inningsIndex||0) >= 2;
  const oversLimit = inSuper ? Number(state.superOverOvers||1) : Number(state.oversPerInnings||10);
  const maxBalls = oversLimit * 6;
  const inningsDone = inn.wkts >= 10 || inn.balls >= maxBalls;

  // -----------------------------
  // ✅ Automatic match completion logic
  // - Innings 1 ends (10 overs / all out) -> auto move to innings 2
  // - Innings 2 ends when:
  //    a) target achieved
  //    b) overs complete / all out
  //    c) tie at end
  // -----------------------------

  const i0 = normalizeInnings(state.innings?.[0] || emptyInnings("", ""));
  const i1 = normalizeInnings(state.innings?.[1] || emptyInnings("", ""));
  state.innings[0] = i0;
  state.innings[1] = i1;

  const computeResult = ()=>{
    // Only meaningful after innings 2 starts
    const target = Number(i0.runs || 0) + 1;
    const chasing = i1;
    const reached = Number(chasing.runs || 0) >= target;
    const byWkts = Math.max(0, 10 - Number(chasing.wkts || 0));
    const byRuns = Math.max(0, Number(i0.runs || 0) - Number(chasing.runs || 0));

    let text = "";
    let winner = "";
    let tie = false;

    if(reached){
      winner = chasing.batting || "";
      text = `${winner} won by ${byWkts} wicket${byWkts===1?"":"s"}`;
    } else {
      // innings 2 finished without reaching target
      if(Number(chasing.runs||0) === Number(i0.runs||0)){
        tie = true;
        text = "Match tied";
      } else {
        winner = i0.batting || "";
        text = `${winner} won by ${byRuns} run${byRuns===1?"":"s"}`;
      }
    }

    return {
      target,
      reached,
      tie,
      winner,
      byRuns: reached ? 0 : byRuns,
      byWkts: reached ? byWkts : 0,
      text
    };
  };

  if(inningsDone && state.inningsIndex === 0){
    // Move to innings 2
    state.inningsIndex = 1;
    if(!state.innings[1]){
      state.innings[1] = emptyInnings(state.innings[0]?.bowling || "", state.innings[0]?.batting || "");
    }
    state.status = "LIVE";
  } else if(state.inningsIndex === 1){
    const target = Number(i0.runs || 0) + 1;
    const reached = Number(inn.runs || 0) >= target;
    if(reached || inningsDone){
      const res = computeResult();
      // If tied and super-over enabled, start super over instead of completing
      const soEnabled = !!(state.rules?.superOverOnTie);
      if(res.tie && soEnabled){
        // init super over innings (2 and 3)
        if(!state.superOverOvers) state.superOverOvers = 1;
        state.innings[2] = emptyInnings(i0.batting || "", i0.bowling || "");
        state.innings[3] = emptyInnings(i0.bowling || "", i0.batting || "");
        state.inningsIndex = 2;
        state.status = "LIVE";
        state.result = { tie:true, superOver:true, text:"Match tied. Super Over." };
      } else {
        state.status = "COMPLETED";
        state.result = res;
      }
    } else {
      state.status = "LIVE";
    }
  } else if(state.inningsIndex === 2){
    // Super over - innings 1
    if(inningsDone){
      state.inningsIndex = 3;
      state.status = "LIVE";
    } else {
      state.status = "LIVE";
    }
  } else if(state.inningsIndex === 3){
    // Super over chase
    const so1 = normalizeInnings(state.innings?.[2] || emptyInnings("",""));
    const so2 = normalizeInnings(state.innings?.[3] || emptyInnings("",""));
    state.innings[2] = so1;
    state.innings[3] = so2;
    const target = Number(so1.runs||0) + 1;
    const reached = Number(inn.runs||0) >= target;
    if(reached || inningsDone){
      let winner = "";
      let text = "";
      if(reached){
        winner = so2.batting || "";
        const byWkts = Math.max(0, 10 - Number(so2.wkts||0));
        text = `Super Over: ${winner} won by ${byWkts} wicket${byWkts===1?"":"s"}`;
      } else {
        if(Number(so2.runs||0) === Number(so1.runs||0)){
          text = "Super Over tied";
        } else {
          winner = so1.batting || "";
          const byRuns = Math.max(0, Number(so1.runs||0) - Number(so2.runs||0));
          text = `Super Over: ${winner} won by ${byRuns} run${byRuns===1?"":"s"}`;
        }
      }
      state.status = "COMPLETED";
      state.result = { superOver:true, winner, text, target };
    } else {
      state.status = "LIVE";
    }
  } else {
    state.status = "LIVE";
  }

  updateSummary(state);
}
