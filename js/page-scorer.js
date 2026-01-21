import { initScorerWizard } from "./scorer-wizard.js";
import { setActiveNav, qs, loadTournament } from "./util.js";
import { getFB, watchMatch, addBall, undoBall, setMatchStatus, resetMatch, watchAuth, setToss, setPlayingXI, setOpeningSetup, finalizeMatchAndComputeAwards } from "./store-fb.js";
import { renderScoreLine, renderCommentary, renderScorecard } from "./renderers.js";

setActiveNav("scorer");
const FB = getFB();
const USE_SETUP_WIZARD = true; // Use full-screen setup wizard; hide legacy setup cards
let WIZARD = null;

const $ = (id)=>document.getElementById(id);
const esc = (s)=> (s??"").toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const params = qs();
const matchId = params.get("matchId") || params.get("match") || "A1";

let TOURNAMENT = null;
let SQUADS = {}; // team -> [15]
let CURRENT_DOC = null;
let LAST_STATUS = null;
let _tossMounted = false;
let _xiMounted = false;
let _openingMounted = false;
let _breakMounted = false;

let _wizardBound = false;

// -----------------------------
// Helpers
// -----------------------------

function ensureWizard(){
  if(WIZARD || !document.getElementById("setupWizard")) return;
  WIZARD = initScorerWizard({
    FB,
    matchId,
    getDoc: ()=>CURRENT_DOC,
    getTournament: ()=>TOURNAMENT,
    getSquads: ()=>SQUADS,
    setToss,
    setPlayingXI,
    setOpeningSetup,
    setMatchStatus,
    onDone: ()=>{
      // after wizard done, we keep normal scorer UI as-is
      showState("Setup complete. Ab scoring start kar sakte ho.", true);
    }
  });
}


function showState(msg, ok=true){
  const el = $("sMeta");
  if(!el) return;
  el.textContent = msg;
  el.style.color = ok ? "var(--muted)" : "#ff9a9a";
}

// -----------------------------
// 1st Innings Complete Overlay (UI-only)
// Shows full-screen scorecard for Innings 1 and then lets user start Innings 2 by choosing openers + bowler.
// STRICT: does NOT change scoring logic / Firebase schema.
// -----------------------------
let _i1Overlay = null;
let _i1ShownSig = null;

function _safeClone(obj){
  try{ return JSON.parse(JSON.stringify(obj)); }catch(e){ return obj; }
}

function _removeI1Overlay(){
  try{ _i1Overlay?.remove(); }catch(e){}
  _i1Overlay = null;
}

function _isI1Done(st, i0){
  const overs = Number(st?.oversPerInnings || 10);
  const totalBalls = Math.max(0, overs * 6);
  return (
    Number(i0?.balls||0) >= totalBalls ||
    Number(i0?.wkts||0) >= 10 ||
    Number(st?.inningsIndex||0) >= 1
  );
}

function _needsOpening(inn){
  const on = inn?.onField || {};
  const has = !!(on.striker && on.nonStriker && on.bowler);
  return !(inn?.openingDone) && !has;
}

function _buildSelectOptions(list, selected=""){
  const arr = Array.isArray(list) ? list : [];
  return arr.map(name=>{
    const sel = (selected && name===selected) ? "selected" : "";
    return `<option value="${esc(name)}" ${sel}>${esc(name)}</option>`;
  }).join("");
}

function _defaultTwoDifferent(arr){
  const a = Array.isArray(arr) ? arr : [];
  const s = a[0] || "";
  const ns = (a.find(x=>x && x!==s) || a[1] || "");
  return { s, ns };
}

function showInnings1CompleteOverlay(doc){
  const st = doc?.state || {};
  const innings = Array.isArray(st.innings) ? st.innings : [];
  const i0 = innings[0];
  const i1 = innings[1];
  if(!i0 || !i1) return;

  // Only show if currently moved to innings 2 AND opening not set yet
  if(Number(st.inningsIndex||0) !== 1) return;
  if(!_isI1Done(st, i0)) return;
  if(!_needsOpening(i1)) return;

  const sig = `${matchId}:${Number(i0.runs||0)}:${Number(i0.wkts||0)}:${Number(i0.balls||0)}`;
  if(_i1ShownSig === sig && _i1Overlay) return;
  _i1ShownSig = sig;

  // If overlay already exists, refresh content safely
  _removeI1Overlay();

  // Toast
  showState("✅ 1st Innings complete. Scorecard dekho, phir 2nd innings start karo.", true);

  const overlay = document.createElement("div");
  overlay.className = "overlay fullscreen";
  overlay.id = "i1CompleteOverlay";

  // Render scorecard with inningsIndex forced to 0 (so it shows Innings 1 block by default)
  const tmp = _safeClone(doc);
  if(tmp?.state) tmp.state.inningsIndex = 0;
  const scorecardHTML = renderScorecard(tmp);

  const battingTeam = i0.batting || doc.a || "Team A";
  const oversLimit = Number(st.oversPerInnings || 10);
  const target = Number(i0.runs||0) + 1;

  overlay.innerHTML = `
    <div class="popup fullscreen">
      <div class="scTop">
        <div>
          <div class="h1" style="font-size:18px">🏏 End of 1st Innings</div>
          <div class="muted small" style="margin-top:2px">
            <b>${esc(battingTeam)}</b> • ${Number(i0.runs||0)}/${Number(i0.wkts||0)} (${esc(i0.overs||"0.0")}/${esc(oversLimit)})
            <span class="muted">&nbsp;•&nbsp;</span> Target: <b>${esc(target)}</b>
          </div>
        </div>
        <button class="btn ghost" id="i1Close" title="Close">✕</button>
      </div>

      <div class="scBody">
        ${scorecardHTML}
      </div>

      <div class="scBottom">
        <div class="muted small">
          Target <b>${esc(target)}</b> • Overs <b>${esc(oversLimit)}</b>
        </div>
        <div class="row" style="gap:10px; justify-content:flex-end; margin-top:10px">
          <button class="btn" id="i1Start2">Start 2nd Innings</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _i1Overlay = overlay;

  overlay.querySelector("#i1Close")?.addEventListener("click", ()=>{
    // Allow closing if user wants to undo last ball etc.
    _removeI1Overlay();
  });

  overlay.querySelector("#i1Start2")?.addEventListener("click", ()=>{
    renderInnings2Setup(overlay, doc);
  });
}

function renderInnings2Setup(overlay, doc){
  const st = doc?.state || {};
  const innings = Array.isArray(st.innings) ? st.innings : [];
  const i1 = innings[1];
  if(!i1){
    showState("2nd innings data missing.", false);
    return;
  }

  const batTeam = i1.batting || (doc.b||"");
  const bowlTeam = i1.bowling || (doc.a||"");
  const batXI = st.playingXI?.[batTeam] || [];
  const bowlXI = st.playingXI?.[bowlTeam] || [];

  const def = _defaultTwoDifferent(batXI);
  const striker = def.s;
  const nonStriker = def.ns;
  const bowler = bowlXI?.[0] || "";

  const wkId = st.playingXIMeta?.[bowlTeam]?.wicketKeeperId || "";
  const bowlFiltered = bowlXI.filter(x=>x && x!==wkId);

  overlay.querySelector(".popup")?.classList.add("setupMode");
  overlay.querySelector(".popup").innerHTML = `
      <div class="scTop">
        <div>
          <div class="h1" style="font-size:18px">🏏 Start 2nd Innings</div>
          <div class="muted small" style="margin-top:2px">${esc(batTeam)} batting • ${esc(bowlTeam)} bowling</div>
        </div>
        <button class="btn ghost" id="i2Back" title="Back">←</button>
      </div>

      <div class="scBody">
        <div class="card" style="padding:12px">
          <div class="muted small">Select opening batsmen and bowler</div>

          <div class="row wrap" style="gap:10px; margin-top:10px">
            <div style="flex:1; min-width:220px">
              <div class="muted small">Striker</div>
              <select class="input" id="i2Striker">${_buildSelectOptions(batXI, striker)}</select>
            </div>

            <div style="flex:1; min-width:220px">
              <div class="muted small">Non-striker</div>
              <select class="input" id="i2Non">${_buildSelectOptions(batXI, nonStriker)}</select>
            </div>

            <div style="flex:1; min-width:220px">
              <div class="muted small">Opening Bowler</div>
              <select class="input" id="i2Bowler">${_buildSelectOptions(bowlFiltered, bowler)}</select>
              ${wkId ? `<div class="muted small" style="margin-top:6px">Note: Wicket-keeper cannot bowl (auto excluded).</div>`:""}
            </div>
          </div>

          <div class="row" style="justify-content:flex-end; gap:10px; margin-top:14px">
            <button class="btn" id="i2StartNow">Start Scoring</button>
          </div>
        </div>
      </div>

      <div class="scBottom">
        <div class="muted small">Tip: Setup ke baad scoring turant start ho jayegi.</div>
      </div>
  `;

  overlay.querySelector("#i2Back")?.addEventListener("click", ()=>{
    // Re-render scorecard view
    showInnings1CompleteOverlay(doc);
  });

  overlay.querySelector("#i2StartNow")?.addEventListener("click", async ()=>{
    const s = overlay.querySelector("#i2Striker")?.value?.trim();
    const ns = overlay.querySelector("#i2Non")?.value?.trim();
    const bo = overlay.querySelector("#i2Bowler")?.value?.trim();
    if(!s || !ns || !bo){
      showState("2nd innings setup: striker, non-striker aur bowler select karo.", false);
      return;
    }
    if(s===ns){
      showState("Striker aur Non-striker same nahi ho sakte.", false);
      return;
    }
    try{
      await setOpeningSetup(FB, matchId, s, ns, bo);
      _removeI1Overlay();
      showState("✅ 2nd innings started. Scoring shuru karo.", true);
    }catch(err){
      showState(err?.message || "2nd innings setup failed", false);
    }
  });
}

function maybeHandleInningsBreakUI(doc){
  const st = doc?.state;
  if(!st) return;

  const idx = Number(st.inningsIndex||0);
  const innings = Array.isArray(st.innings) ? st.innings : [];

  // If user undoes back to innings 1, close overlay and reset signature.
  if(idx !== 1){
    _removeI1Overlay();
    _i1ShownSig = null;
    return;
  }

  const i0 = innings[0];
  const i1 = innings[1];
  if(!i0 || !i1) return;

  // Show only when needed
  if(_needsOpening(i1) && _isI1Done(st, i0)){
    showInnings1CompleteOverlay(doc);
  } else {
    // If opening already done, ensure overlay is not blocking
    _removeI1Overlay();
  }
}

function renderFreeHitBadge(doc){
  const badge = document.getElementById("freeHitBadge");
  if(!badge) return;
  const inn = currentInnings(doc);
  const of = inn?.onField || {};
  badge.style.display = of.freeHit ? "inline-flex" : "none";
}


function _oversTextFromBalls(balls){
  const o = Math.floor((Number(balls||0))/6);
  const b = Math.floor((Number(balls||0))%6);
  return `${o}.${b}`;
}

function _innings2Started(doc){
  const st = doc?.state || {};
  const i1 = st?.innings?.[1];
  return !!(i1 && (Number(i1.balls||0)>0 || (Array.isArray(i1.ballByBall) && i1.ballByBall.length>0)));
}

function maybeShowInningsBreak(doc){
  try{
    const st = doc?.state || {};
    if(Number(st.inningsIndex||0) !== 1) return;
    if(_innings2Started(doc)) return;

    const i0 = st?.innings?.[0];
    const i1 = st?.innings?.[1] || {};
    if(!i0) return;

    // Only show if innings 1 has actually finished (overs/all out)
    const oversLimit = Number(st.oversPerInnings||10);
    const maxBalls = oversLimit * 6;
    const innings1Done = Number(i0.wkts||0) >= 10 || Number(i0.balls||0) >= maxBalls;
    if(!innings1Done) return;

    // If modal already open, keep it
    if(document.getElementById("inningsBreakOverlay")) return;

    const target = Number(i0.runs||0) + 1;
    const bat2 = i1.batting || st.summary?.batting || doc?.b;
    const bowl2 = i1.bowling || st.summary?.bowling || doc?.a;
    const batXI = st.playingXI?.[bat2] || [];
    const bowlXI = st.playingXI?.[bowl2] || [];

    const overlay = document.createElement("div");
    overlay.id = "inningsBreakOverlay";
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="popup" style="max-width:640px">
        <div class="row" style="justify-content:space-between; gap:12px; align-items:center">
          <div>
            <div class="h1" style="font-size:18px">Innings Break</div>
            <div class="muted small" style="margin-top:2px">
              1st Innings: <b>${esc(i0.batting||doc?.a)}</b> ${esc(Number(i0.runs||0))}/${esc(Number(i0.wkts||0))} (${esc(_oversTextFromBalls(i0.balls))}/${esc(oversLimit)})
              • Target: <b>${esc(target)}</b>
            </div>
          </div>
          <span class="badge live">LIVE</span>
        </div>

        <hr class="sep"/>

        <div class="muted small" style="margin-bottom:8px">2nd Innings setup: <b>${esc(bat2)}</b> chasing • <b>${esc(bowl2)}</b> bowling</div>

        <div class="grid" style="grid-template-columns: 1fr; gap:10px">
          <div>
            <div class="muted small" style="margin:0 0 4px">Striker</div>
            <select class="input" id="ibStriker">
              ${batXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}
            </select>
          </div>
          <div>
            <div class="muted small" style="margin:0 0 4px">Non-Striker</div>
            <select class="input" id="ibNonStriker">
              ${batXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}
            </select>
          </div>
          <div>
            <div class="muted small" style="margin:0 0 4px">Opening Bowler</div>
            <select class="input" id="ibBowler">
              ${bowlXI.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="row" style="justify-content:flex-end; gap:10px; margin-top:12px">
          <button class="btn" id="ibStart">Start 2nd Innings</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const $s = (id)=>overlay.querySelector(id);
    const strikerEl = overlay.querySelector("#ibStriker");
    const nonEl = overlay.querySelector("#ibNonStriker");
    const bowlEl = overlay.querySelector("#ibBowler");

    // Make default non-striker different if possible
    if(nonEl && strikerEl && nonEl.value === strikerEl.value && nonEl.options.length>1){
      nonEl.selectedIndex = 1;
    }

    overlay.querySelector("#ibStart")?.addEventListener("click", async ()=>{
      const s = (strikerEl?.value||"").trim();
      const ns = (nonEl?.value||"").trim();
      const bo = (bowlEl?.value||"").trim();
      if(!s || !ns || !bo){
        showState("2nd innings setup: select striker, non-striker aur bowler.", false);
        return;
      }
      if(s===ns){
        showState("Striker aur Non-striker same nahi ho sakte.", false);
        return;
      }
      try{
        await setOpeningSetup(FB, matchId, s, ns, bo);
        overlay.remove();
        showState("2nd innings started. Scoring shuru karo.", true);
      } catch(err){
        showState(err?.message || "2nd innings setup failed", false);
      }
    });
  } catch(e){
    // no-op
  }
}

function showAwardsPopup(awards){
  if(!awards) return;
  const mom = awards.mom;
  const six = awards.sixerKing;
  const bb = awards.bestBowler;

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="popup">
      <div class="row" style="justify-content:space-between; gap:12px; align-items:center">
        <div>
          <div class="h1" style="font-size:18px">Match Awards</div>
          <div class="muted small" style="margin-top:2px">Auto calculated (rules-based)</div>
        </div>
        <button class="btn" id="awClose">Close</button>
      </div>

      <div class="awardsGrid" style="margin-top:12px">
        <div class="awardCard awardMom">
          <div class="awardTitle">🏅 Man of the Match</div>
          <div class="awardName">${esc(mom?.name||"-")}</div>
          <div class="awardMeta">${esc(mom?.team||"")} ${mom?.score!=null?` • Score ${esc(mom.score)}`:""}</div>
        </div>

        <div class="awardCard awardSix">
          <div class="awardTitle">💥 Sixer King Award</div>
          <div class="awardName">${esc(six?.name||"-")}</div>
          <div class="awardMeta">${esc(six?.team||"")} ${six?.sixes!=null?` • 6s ${esc(six.sixes)}`:""}</div>
        </div>

        <div class="awardCard awardBowl">
          <div class="awardTitle">🎯 Best Bowler Award</div>
          <div class="awardName">${esc(bb?.name||"-")}</div>
          <div class="awardMeta">${esc(bb?.team||"")} ${bb?.wickets!=null?` • ${esc(bb.wickets)}W`:""}${bb?.econ!=null?` • Eco ${esc(bb.econ)}`:""}</div>
        </div>
      </div>

      <div class="muted small" style="margin-top:12px">Tip: Awards edit karne ho to Admin panel me manual override future me add kar sakte hain.</div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector("#awClose")?.addEventListener("click", ()=>overlay.remove());
  overlay.addEventListener("click", (e)=>{ if(e.target===overlay) overlay.remove(); });
}

function squadOf(team){
  const list = SQUADS?.[team];
  if(Array.isArray(list) && list.length) return list;
  const base = (team||"Team").toString().trim() || "Team";
  return Array.from({length:15}, (_,i)=>`${base} Player ${i+1}`);
}

function playingXIOf(state, team){
  const xi = state?.playingXI?.[team];
  if(Array.isArray(xi) && xi.length===11) return xi;
  return null;
}

function playingXIMetaOf(state, team){
  return state?.playingXIMeta?.[team] || null;
}

function fillSelect(sel, list, placeholder){
  if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = placeholder || "Select...";
  sel.appendChild(o0);
  for(const n of list){
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  }
  if(keep && list.includes(keep)) sel.value = keep;
}

function currentInnings(doc){
  const st = doc?.state;
  const idx = Number(st?.inningsIndex||0);
  return st?.innings?.[idx] || null;
}

function battingBowlingTeams(doc){
  const st = doc?.state || {};
  const inn = currentInnings(doc);
  const summary = doc?.summary || st.summary || {};
  return {
    batting: inn?.batting || summary.batting || doc?.a,
    bowling: inn?.bowling || summary.bowling || doc?.b
  };
}

function ensureDropdowns(doc){
  const st = doc?.state || {};
  const { batting, bowling } = battingBowlingTeams(doc);

  const batXI = playingXIOf(st, batting);
  const bowlXI = playingXIOf(st, bowling);

  const batList = batXI || squadOf(batting);
  const bowlList = bowlXI || squadOf(bowling);

  fillSelect($("batter"), batList, `Select striker (${batting})...`);
  fillSelect($("nonStriker"), batList, `Select non-striker (${batting})...`);
  fillSelect($("bowler"), bowlList, `Select bowler (${bowling})...`);
}

function fmtOversFromBalls(balls){
  const o = Math.floor((Number(balls||0))/6);
  const b = (Number(balls||0))%6;
  return `${o}.${b}`;
}

function renderScorerLiveChip(doc){
  const box = $("scorerLiveChip");
  if(!box) return;
  const st = doc?.state || {};
  const inn = currentInnings(doc);
  if(!inn){
    box.innerHTML = `<div class="muted small">Live chip</div><div class="muted small">No innings.</div>`;
    return;
  }
  const of = inn.onField || {};
  const striker = (of.striker||"").trim();
  const nonStriker = (of.nonStriker||"").trim();
  const bowler = (of.bowler||"").trim();

  const sb = striker ? (inn.batters?.[striker] || {}) : {};
  const ns = nonStriker ? (inn.batters?.[nonStriker] || {}) : {};
  const bo = bowler ? (inn.bowlers?.[bowler] || {}) : {};

  const score = `${inn.runs||0}/${inn.wkts||0}`;
  const overs = `${inn.overs||"0.0"}`;
  const pp = Number(st.powerplayOvers ?? doc?.powerplayOvers ?? 3);
  const inPP = !!(st.summary?.inPowerplay);

  // Chase metrics (innings 2)
  const totalOvers = Number(st.oversPerInnings || doc?.oversPerInnings || 10);
  const totalBalls = Math.max(0, totalOvers * 6);
  const i1 = st?.innings?.[0];
  const isChase = (Number(st.inningsIndex||0) === 1 && !!i1);
  const i1Complete = isChase && (
    Number(i1.balls||0) >= totalBalls ||
    Number(i1.wkts||0) >= 10 ||
    Number(st.inningsIndex||0) >= 1
  );
  let chaseLine = "";
  if(isChase && i1Complete){
    const target = Number(i1.runs||0) + 1;
    const ballsUsed = Number(inn.balls||0);
    const ballsLeft = Math.max(0, totalBalls - ballsUsed);
    const runs = Number(inn.runs||0);
    const runsNeeded = Math.max(0, target - runs);
    const reqRR = ballsLeft > 0 ? Math.round(((runsNeeded*6)/ballsLeft)*100)/100 : 0;
    chaseLine = `
      <div class="muted small" style="margin-top:4px">
        <b>Target</b> ${esc(target)} <span class="muted">•</span>
        ${runsNeeded<=0 ? `<b>Target achieved</b>` : `<b>Need</b> ${esc(runsNeeded)} in ${esc(ballsLeft)} balls`}
        <span class="muted">•</span> <b>Req RR</b> ${esc(reqRR)}
      </div>
    `;
  }

  const ppLine = inPP ? `
      <div class="muted small" style="margin-top:4px">
        <b>Powerplay</b> • Overs 1-${esc(pp)}
      </div>
    ` : "";

  const fhLine = of.freeHit ? `
      <div class="muted small" style="margin-top:4px">
        <b>FREE HIT</b>
      </div>
    ` : "";

  const bowOvers = bowler ? fmtOversFromBalls(bo.oBalls||0) : "-";

  box.innerHTML = `
    <div class="row wrap" style="justify-content:space-between; gap:10px; align-items:flex-start">
      <div>
        <div class="muted small">LIVE • ${esc(inn.batting||"")}</div>
        <div style="margin-top:4px"><b>${esc(score)}</b> <span class="muted">(${esc(overs)})</span></div>
        ${ppLine}
        ${fhLine}
        ${chaseLine}
      </div>
      <a class="chip" href="scorecard.html?match=${encodeURIComponent(doc.matchId||matchId)}" style="text-decoration:none">Scorecard</a>
    </div>

    <div class="sep" style="margin:10px 0"></div>

    <div class="grid cols2" style="gap:8px">
      <div>
        <div class="muted small">Batters</div>
        <div style="margin-top:4px">
          <div><b>${esc(striker||"-")}</b>${striker?" *":""} <span class="muted">${striker?` ${sb.r||0}(${sb.b||0})`:""}</span></div>
          <div><b>${esc(nonStriker||"-")}</b> <span class="muted">${nonStriker?` ${ns.r||0}(${ns.b||0})`:""}</span></div>
        </div>
      </div>
      <div>
        <div class="muted small">Bowler</div>
        <div style="margin-top:4px">
          <div><b>${esc(bowler||"-")}</b></div>
          <div class="muted small">O ${esc(bowOvers)} • R ${esc(bo.r||0)} • W ${esc(bo.w||0)}</div>
        </div>
      </div>
    </div>
  `;
}

function requireNames(){
  const batter = $("batter")?.value?.trim();
  const nonStriker = $("nonStriker")?.value?.trim();
  const bowler = $("bowler")?.value?.trim();
  if(!batter || !nonStriker){
    showState("Striker & non-striker select karo.", false);
    return null;
  }
  if(batter===nonStriker){
    showState("Striker aur non-striker same nahi ho sakte.", false);
    return null;
  }
  if(!bowler){
    showState("Bowler select karo.", false);
    return null;
  }

  // Wicket flow enforcement: next batter must be assigned before any next delivery.
  const inn = currentInnings(CURRENT_DOC);
  const of = inn?.onField;
  if(of?.needNextBatter){
    showState("Wicket hua hai. Pehele Wicket flow me next batsman select karo.", false);
    return null;
  }

  // Over-end enforcement
  // (separate from wicket enforcement)
  if(of?.needNewBowler){
    if(of?.lastBowler && bowler === of.lastBowler){
      showState("Same bowler next over nahi dal sakta. New bowler select karo.", false);
      return null;
    }
  }

  // Max 2-over (or configured) restriction
  const st = CURRENT_DOC?.state || {};
  const maxO = Number(st.maxOversPerBowler ?? 2);
  const maxBalls = Math.max(0, maxO*6);
  if(maxBalls>0){
    const inn = currentInnings(CURRENT_DOC);
    const oBalls = Number(inn?.bowlers?.[bowler]?.oBalls || 0);
    if(oBalls >= maxBalls){
      showState(`${bowler} max ${maxO} overs complete. New bowler select karo.`, false);
      return null;
    }
  }

  return { batter, nonStriker, bowler };
}

async function safeAddBall(ball){
  try{
    await addBall(FB, matchId, ball);
  }catch(e){
    const msg = e?.message || String(e);
    // ✅ UX fix:
    // Sometimes the match doc can be missing opening setup (striker/non-striker) even when
    // scorer has already selected them in the Ball input dropdowns.
    // In that case, auto-save opening once (UI convenience only) and retry the ball.
    if(/Opening setup pending/i.test(msg)){
      const n = requireNames();
      if(n){
        try{
          // Save opening (only sets onField striker/nonStriker/bowler + openingDone)
          await setOpeningSetup(FB, matchId, n.batter, n.nonStriker, n.bowler);
          showState("Opening auto-saved ✅ Ab scoring continue karo.", true);
          await addBall(FB, matchId, ball);
          return;
        }catch(e2){
          // fallthrough to normal error reporting
        }
      }
    }

    showState(msg, false);
    alert(msg);
  }
}

// -----------------------------
// Toss Card (inject)
// -----------------------------
function mountTossCard(){
  if(USE_SETUP_WIZARD) return;

  if(_tossMounted) return;
  const batterSel = $("batter");
  if(!batterSel) return;

  const ballCard = batterSel.closest(".card");
  const parent = ballCard ? ballCard.parentElement : null;
  if(!ballCard || !parent) return;

  const tossCard = document.createElement("div");
  tossCard.className = "card";
  tossCard.id = "tossCard";
  tossCard.innerHTML = `
    <div class="h1" style="font-size:16px">Toss & Match Setup</div>
    <div class="muted small" style="margin-top:4px">Pehele toss set karo. Phir Playing XI select karo. Phir Start Match (LIVE).</div>
    <hr class="sep"/>

    <div class="grid cols2">
      <div>
        <div class="muted small">Toss winner</div>
        <select id="tossWinner" class="input">
          <option value="">Select team…</option>
        </select>
      </div>
      <div>
        <div class="muted small">Decision</div>
        <select id="tossDecision" class="input">
          <option value="BAT">Bat</option>
          <option value="BOWL">Bowl</option>
        </select>
      </div>
    </div>

    <div style="margin-top:10px" class="row wrap">
      <button class="btn ok" id="btnSaveToss" type="button">Save Toss</button>
      <div class="muted small" id="tossMsg"></div>
    </div>
  `;

  parent.insertBefore(tossCard, ballCard);
  _tossMounted = true;

  $("btnSaveToss")?.addEventListener("click", async ()=>{
    const winner = $("tossWinner")?.value?.trim();
    const decision = $("tossDecision")?.value?.trim() || "BAT";
    if(!winner) return alert("Toss winner select karo");
    try{
      await setToss(FB, matchId, winner, decision);
      $("tossMsg").textContent = "Toss saved ✅ Ab Playing XI select karo.";
    }catch(e){
      alert(e?.message || String(e));
    }
  });
}

function updateTossUI(doc){
  if(USE_SETUP_WIZARD) return;

  if(!_tossMounted) mountTossCard();
  const winnerSel = $("tossWinner");
  if(!winnerSel) return;

  const teams = [doc?.a, doc?.b].filter(Boolean);
  fillSelect(winnerSel, teams, "Select team…");

  const st = doc?.state || {};
  const hasToss = !!(st.toss || doc?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[doc.a]?.length===11 && st.playingXI[doc.b]?.length===11);
  const idx = Number(st?.inningsIndex||0);
  const card = $("tossCard");
  const msg = $("tossMsg");

  // ✅ UX: 2nd innings me toss repeat nahi dikhana
  if(idx>=1 && hasToss && hasXI){
    if(card) card.style.display = "none";
    return;
  }

  if(card){
    // Show whenever toss not set (even if match accidentally flipped to LIVE)
    card.style.display = (!hasToss) ? "block" : (doc?.status==="UPCOMING" ? "block" : "none");
  }
  if(msg){
    if(hasToss){
      const t = st.toss || { winner: doc.tossWinner, decision: doc.tossDecision };
      msg.textContent = `Saved: ${t.winner} won, chose ${t.decision}.`;
    } else {
      msg.textContent = "Toss pending.";
    }
  }
}

// -----------------------------
// Playing XI Card (inject)
// -----------------------------
function mountPlayingXICard(){
  if(USE_SETUP_WIZARD) return;

  if(_xiMounted) return;

  const batterSel = $("batter");
  const ballCard = batterSel ? batterSel.closest(".card") : null;
  const parent = ballCard ? ballCard.parentElement : null;
  if(!parent || !ballCard) return;

  const xiCard = document.createElement("div");
  xiCard.className = "card";
  xiCard.id = "xiCard";
  xiCard.innerHTML = `
    <div class="h1" style="font-size:16px">Playing XI (11 out of 15)</div>
    <div class="muted small" style="margin-top:4px">Dono teams ke 11-11 players select karo. Saath me <b>Captain</b>, <b>Vice-Captain</b> aur <b>Wicket Keeper</b> mandatory select karo.</div>
    <hr class="sep"/>

    <div class="grid cols2">
      <div>
        <div class="muted small" id="xiLabelA">Team A XI</div>
        <div id="xiListA" class="grid" style="gap:6px"></div>
        <div class="muted small" id="xiCountA" style="margin-top:6px">Selected: 0/11</div>

        <div class="grid cols3" style="gap:8px; margin-top:10px">
          <div>
            <div class="muted small">Captain</div>
            <select id="capA" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Vice-Captain</div>
            <select id="vcA" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Wicket-Keeper</div>
            <select id="wkA" class="input"><option value="">Select…</option></select>
          </div>
        </div>
      </div>
      <div>
        <div class="muted small" id="xiLabelB">Team B XI</div>
        <div id="xiListB" class="grid" style="gap:6px"></div>
        <div class="muted small" id="xiCountB" style="margin-top:6px">Selected: 0/11</div>

        <div class="grid cols3" style="gap:8px; margin-top:10px">
          <div>
            <div class="muted small">Captain</div>
            <select id="capB" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Vice-Captain</div>
            <select id="vcB" class="input"><option value="">Select…</option></select>
          </div>
          <div>
            <div class="muted small">Wicket-Keeper</div>
            <select id="wkB" class="input"><option value="">Select…</option></select>
          </div>
        </div>
      </div>
    </div>

    <div class="row wrap" style="margin-top:10px">
      <button class="btn ok" id="btnSaveXI" type="button">Save Playing XI</button>
      <div class="muted small" id="xiMsg"></div>
    </div>
  `;

  // Toss card already above Ball card, so this goes under Toss automatically
  parent.insertBefore(xiCard, ballCard);
  _xiMounted = true;

  $("btnSaveXI")?.addEventListener("click", async ()=>{
    if(!CURRENT_DOC) return;
    const xiA = Array.from(document.querySelectorAll("#xiListA input[type=checkbox]:checked")).map(i=>i.value);
    const xiB = Array.from(document.querySelectorAll("#xiListB input[type=checkbox]:checked")).map(i=>i.value);
    const metaA = { captainId: $("capA")?.value||"", viceCaptainId: $("vcA")?.value||"", wicketKeeperId: $("wkA")?.value||"" };
    const metaB = { captainId: $("capB")?.value||"", viceCaptainId: $("vcB")?.value||"", wicketKeeperId: $("wkB")?.value||"" };
    try{
      await setPlayingXI(FB, matchId, xiA, xiB, metaA, metaB);
      $("xiMsg").textContent = "Playing XI saved ✅";
      showState("Playing XI saved ✅ Ab scoring start kar sakte ho.", true);
    }catch(e){
      alert(e?.message || String(e));
    }
  });
}

function selectedXIFrom(containerId){
  const box = $(containerId);
  if(!box) return [];
  return Array.from(box.querySelectorAll("input[type=checkbox]:checked")).map(i=>i.value).filter(Boolean);
}

function updateXIMetaOptions(side){
  const list = side === "A" ? selectedXIFrom("xiListA") : selectedXIFrom("xiListB");
  const cap = $(side === "A" ? "capA" : "capB");
  const vc  = $(side === "A" ? "vcA"  : "vcB");
  const wk  = $(side === "A" ? "wkA"  : "wkB");
  if(!cap || !vc || !wk) return;
  fillSelect(cap, list, "Select…");
  fillSelect(vc, list, "Select…");
  fillSelect(wk, list, "Select…");
}

function renderXIList(containerId, players, selectedSet, countId){
  const box = $(containerId);
  if(!box) return;

  box.innerHTML = "";
  for(const p of players){
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.cursor = "pointer";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p;
    cb.checked = selectedSet.has(p);

    cb.addEventListener("change", ()=>{
      const checked = Array.from(box.querySelectorAll("input[type=checkbox]:checked")).length;
      if(checked > 11){
        cb.checked = false;
        alert("Sirf 11 players select kar sakte ho.");
      }
      const finalCount = Array.from(box.querySelectorAll("input[type=checkbox]:checked")).length;
      const cEl = $(countId);
      if(cEl) cEl.textContent = `Selected: ${finalCount}/11`;

      // refresh Captain/VC/WK options based on selected XI
      if(containerId === "xiListA") updateXIMetaOptions("A");
      if(containerId === "xiListB") updateXIMetaOptions("B");
    });

    const sp = document.createElement("span");
    sp.textContent = p;

    row.appendChild(cb);
    row.appendChild(sp);
    box.appendChild(row);
  }

  const cnt = Array.from(box.querySelectorAll("input[type=checkbox]:checked")).length;
  const cEl = $(countId);
  if(cEl) cEl.textContent = `Selected: ${cnt}/11`;
}

function updateXIUI(doc){
  if(USE_SETUP_WIZARD) return;

  if(!_xiMounted) mountPlayingXICard();
  const card = $("xiCard");
  if(!card) return;

  const st = doc?.state || {};
  const idx = Number(st?.inningsIndex||0);
  const hasToss = !!(st.toss || doc?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[doc.a]?.length===11 && st.playingXI[doc.b]?.length===11);

  // ✅ UX: 2nd innings me XI/Leaders repeat nahi dikhana
  if(idx>=1 && hasToss && hasXI){
    card.style.display = "none";
    return;
  }

  // Show whenever XI not set but toss is available (even if match accidentally flipped to LIVE)
  card.style.display = (hasToss && !hasXI) ? "block" : (doc?.status==="UPCOMING" && hasToss ? "block" : "none");

  $("xiLabelA").textContent = `${doc.a} XI`;
  $("xiLabelB").textContent = `${doc.b} XI`;

  const squadA = squadOf(doc.a);
  const squadB = squadOf(doc.b);

  const selA = new Set((st.playingXI?.[doc.a] || []).filter(Boolean));
  const selB = new Set((st.playingXI?.[doc.b] || []).filter(Boolean));

  renderXIList("xiListA", squadA, selA, "xiCountA");
  renderXIList("xiListB", squadB, selB, "xiCountB");

  // Populate Captain/VC/WK dropdowns from selected XI
  updateXIMetaOptions("A");
  updateXIMetaOptions("B");
  const metaA = playingXIMetaOf(st, doc.a);
  const metaB = playingXIMetaOf(st, doc.b);
  if(metaA){ if($("capA")) $("capA").value = metaA.captainId || ""; if($("vcA")) $("vcA").value = metaA.viceCaptainId || ""; if($("wkA")) $("wkA").value = metaA.wicketKeeperId || ""; }
  if(metaB){ if($("capB")) $("capB").value = metaB.captainId || ""; if($("vcB")) $("vcB").value = metaB.viceCaptainId || ""; if($("wkB")) $("wkB").value = metaB.wicketKeeperId || ""; }

  $("xiMsg").textContent = hasXI ? "Saved ✅ (You can re-save if needed)" : "Pending: select 11-11 players.";
}

// -----------------------------
// Innings Break Overlay (UI only)
// -----------------------------
let _ibMounted = false;
let _ibVisible = false;
let _ibPoppedKey = ""; // per match once

function mountInningsBreakCard(){
  // legacy name kept (called from render loop)
  if(USE_SETUP_WIZARD) return;
  if(_ibMounted) return;

  const overlay = document.createElement("div");
  overlay.id = "inningsBreakOverlay";
  overlay.className = "ibOverlay";
  overlay.style.display = "none";
  overlay.innerHTML = `
    <div class="ibSheet">
      <div class="ibHeader">
        <div>
          <div class="ibTitle">1st Innings Complete</div>
          <div class="ibSub muted small" id="ibHdrLine">-</div>
        </div>
        <button class="btn ghost" type="button" id="ibClose">✕</button>
      </div>

      <div class="ibBody" id="ibBody">
        <div class="card ibCard">
          <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px">
            <div>
              <div class="muted small">1st Innings</div>
              <div class="h1" style="font-size:22px; margin-top:2px" id="ibScore">-</div>
              <div class="muted small" style="margin-top:4px" id="ibRR">-</div>
            </div>
            <div class="ibBadges">
              <span class="chip on" id="ibTargetChip">Target: -</span>
              <span class="chip" id="ibExtrasChip">Extras: -</span>
            </div>
          </div>
        </div>

        <div class="card ibCard">
          <div class="h1" style="font-size:16px">Batting</div>
          <div class="tableWrap" style="margin-top:8px">
            <table class="tbl">
              <thead>
                <tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
              </thead>
              <tbody id="ibBatRows"><tr><td colspan="6" class="muted small">No data.</td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="card ibCard">
          <div class="h1" style="font-size:16px">Bowling</div>
          <div class="tableWrap" style="margin-top:8px">
            <table class="tbl">
              <thead>
                <tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr>
              </thead>
              <tbody id="ibBowlRows"><tr><td colspan="5" class="muted small">No data.</td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="card ibCard">
          <div class="h1" style="font-size:16px">Fall of Wickets</div>
          <div class="muted small" style="margin-top:8px" id="ibFow">-</div>
        </div>
      </div>

      <div class="ibBottom">
        <div class="ibBottomLeft">
          <div class="muted small" id="ibChaseLine">Chase target will be shown here.</div>
        </div>
        <button class="btn ok" id="btnStart2nd" type="button">Start 2nd Innings</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#ibClose")?.addEventListener("click", ()=>{
    hideInningsBreakOverlay();
  });

  overlay.querySelector("#btnStart2nd")?.addEventListener("click", ()=>{
    // Open the short wizard (Break -> Opening -> Ready)
    if(!CURRENT_DOC) return;
    // Always close overlay before opening wizard
    hideInningsBreakOverlay();
    ensureWizard();
    if(WIZARD) WIZARD.open(CURRENT_DOC);
  });

  // click outside sheet closes
  overlay.addEventListener("click", (e)=>{
    const sheet = overlay.querySelector(".ibSheet");
    if(sheet && !sheet.contains(e.target)) hideInningsBreakOverlay();
  });

  _ibMounted = true;
}

function showInningsBreakOverlay(){
  const el = document.getElementById("inningsBreakOverlay");
  if(!el) return;
  el.style.display = "flex";
  _ibVisible = true;
}
function hideInningsBreakOverlay(){
  const el = document.getElementById("inningsBreakOverlay");
  if(!el) return;
  el.style.display = "none";
  _ibVisible = false;
}

function popInningsCompleteOnce(doc){
  try{
    const matchId = (doc?.id || doc?.matchId || doc?._id || "");
    const key = `ibpop_${matchId || "match"}`;
    if(_ibPoppedKey === key) return;
    _ibPoppedKey = key;

    const toast = document.createElement("div");
    toast.className = "toast ibToast";
    toast.innerHTML = `<b>1st Innings Complete</b><div class="muted small" style="margin-top:2px">Scorecard ready • Start 2nd innings</div>`;
    document.body.appendChild(toast);
    setTimeout(()=>toast.classList.add("show"), 20);
    setTimeout(()=>{
      toast.classList.remove("show");
      setTimeout(()=>toast.remove(), 250);
    }, 1400);
  } catch(e){}
}

function updateInningsBreakUI(doc){
  if(USE_SETUP_WIZARD) return;
  mountInningsBreakCard();

  const st = doc?.state || {};
  const innArr = Array.isArray(st.innings) ? st.innings : [];
  const i0 = normalizeInnings(innArr?.[0] || {});
  const i1 = normalizeInnings(innArr?.[1] || {});
  const idx = Number(st?.inningsIndex||0);

  const totalOvers = Number(st.oversPerInnings || doc?.oversPerInnings || 10);
  const maxBalls = Math.max(0, totalOvers * 6);
  const i0Done = (Number(i0.wkts||0) >= 10) || (Number(i0.balls||0) >= maxBalls);

  // 2nd innings has started if any ball logged or opening marked
  const i1Started = !!(
    (Number(i1.ballsTotal||0) > 0) ||
    (Number(i1.balls||0) > 0) ||
    ((i1.ballByBall?.length||0) > 0) ||
    (i1.openingDone === true) ||
    (i1?.onField?.striker && i1?.onField?.nonStriker && i1?.onField?.bowler)
  );

  // Show overlay only when we are at innings 2 but NOT started yet
  const shouldShow = (idx === 1) && i0Done && !i1Started;

  if(shouldShow){
    // toast once, then show overlay
    popInningsCompleteOnce(doc);
    showInningsBreakOverlay();
  } else {
    if(_ibVisible) hideInningsBreakOverlay();
    return;
  }

  // --- Fill UI ---
  const runs = Number(i0.runs||0);
  const wk = Number(i0.wkts||0);
  const lb = Number(i0.balls||0);
  const ov = fmtOversFromBalls(lb);
  const rr = lb > 0 ? (runs * 6) / lb : 0;
  const target = runs + 1;

  const hdr = document.getElementById("ibHdrLine");
  if(hdr) hdr.textContent = `${i0.batting || "Team"} • ${runs}/${wk} (${ov} ov)`;

  const scoreEl = document.getElementById("ibScore");
  const rrEl = document.getElementById("ibRR");
  if(scoreEl) scoreEl.textContent = `${runs}/${wk} (${ov} ov)`;
  if(rrEl) rrEl.textContent = `Run Rate: ${Math.round(rr*100)/100}`;

  const tChip = document.getElementById("ibTargetChip");
  if(tChip) tChip.textContent = `Target: ${target}`;

  const ex = i0.extras || {wd:0, nb:0, lb:0, b:0};
  const exTotal = (Number(ex.wd||0)+Number(ex.nb||0)+Number(ex.lb||0)+Number(ex.b||0));
  const exChip = document.getElementById("ibExtrasChip");
  if(exChip) exChip.textContent = `Extras: ${exTotal} (wd ${ex.wd||0}, nb ${ex.nb||0}, lb ${ex.lb||0}, b ${ex.b||0})`;

  const chaseLine = document.getElementById("ibChaseLine");
  if(chaseLine) chaseLine.textContent = `Target: ${target} in ${totalOvers} overs`;

  // Batting rows
  const batBody = document.getElementById("ibBatRows");
  if(batBody){
    const bats = Object.entries(i0.batters||{}).map(([name, b])=>[name, b||{}]);
    bats.sort((a,b)=> (Number(b[1].r||0) - Number(a[1].r||0)) || (Number(a[1].at||0)-Number(b[1].at||0)));
    if(!bats.length){
      batBody.innerHTML = `<tr><td colspan="6" class="muted small">No batting entries yet.</td></tr>`;
    } else {
      batBody.innerHTML = bats.map(([name, b])=>{
        const r = Number(b.r||0), bl = Number(b.b||0), f4 = Number(b.f4||0), f6 = Number(b.f6||0);
        const sr = bl>0 ? Math.round((r*10000)/bl)/100 : 0;
        const how = (b.out && b.how) ? `<div class="muted small">${esc(b.how)}</div>` : ``;
        return `<tr>
          <td><b>${esc(name)}</b>${how}</td>
          <td>${r}</td><td>${bl}</td><td>${f4}</td><td>${f6}</td><td>${sr}</td>
        </tr>`;
      }).join("");
    }
  }

  // Bowling rows (opposition bowlers in innings 1)
  const bowlBody = document.getElementById("ibBowlRows");
  if(bowlBody){
    const bowls = Object.entries(i0.bowlers||{}).map(([name, b])=>[name, b||{}]);
    // Sort by wickets desc, then runs asc
    bowls.sort((a,b)=> (Number(b[1].w||0) - Number(a[1].w||0)) || (Number(a[1].r||0)-Number(b[1].r||0)));
    if(!bowls.length){
      bowlBody.innerHTML = `<tr><td colspan="5" class="muted small">No bowling entries yet.</td></tr>`;
    } else {
      bowlBody.innerHTML = bowls.map(([name, b])=>{
        const balls = Number(b.b||0);
        const ov = fmtOversFromBalls(balls);
        const r = Number(b.r||0);
        const w = Number(b.w||0);
        const econ = balls>0 ? Math.round((r*6*100)/balls)/100 : 0;
        return `<tr>
          <td><b>${esc(name)}</b></td>
          <td>${ov}</td><td>${r}</td><td>${w}</td><td>${econ}</td>
        </tr>`;
      }).join("");
    }
  }

  // FOW
  const fowEl = document.getElementById("ibFow");
  if(fowEl){
    const fow = Array.isArray(i0.fow) ? i0.fow : [];
    if(!fow.length){
      fowEl.textContent = "—";
    } else {
      const parts = fow.map((x)=>{
        if(typeof x === "string") return x;
        const sc = x?.score ?? x?.at ?? "";
        const w = x?.wkt ?? x?.w ?? "";
        const o = x?.over ?? x?.ov ?? "";
        const left = (sc!=="" && w!=="") ? `${sc}/${w}` : (sc||"");
        return `${left}${o!==""?` (${o} ov)`:``}`;
      }).filter(Boolean);
      fowEl.textContent = parts.join(", ");
    }
  }
}

// -----------------------------
// Opening Setup Card (2 openers + opening bowler)
// -----------------------------
function mountOpeningCard(){
  if(USE_SETUP_WIZARD) return;

  if(_openingMounted) return;
  const batterSel = $("batter");
  const ballCard = batterSel ? batterSel.closest(".card") : null;
  const parent = ballCard ? ballCard.parentElement : null;
  if(!parent || !ballCard) return;

  const openCard = document.createElement("div");
  openCard.className = "card";
  openCard.id = "openingCard";
  openCard.innerHTML = `
    <div class="h1" style="font-size:16px">Opening Setup</div>
    <div class="muted small" style="margin-top:4px">Toss + Playing XI ke baad 2 openers aur opening bowler select karo. Iske bina scoring lock rahegi.</div>
    <hr class="sep"/>

    <div class="grid cols3" style="gap:10px">
      <div>
        <div class="muted small">Opener 1 (Striker)</div>
        <select id="opStriker" class="input"><option value="">Select…</option></select>
      </div>
      <div>
        <div class="muted small">Opener 2 (Non-striker)</div>
        <select id="opNonStriker" class="input"><option value="">Select…</option></select>
      </div>
      <div>
        <div class="muted small">Opening Bowler</div>
        <select id="opBowler" class="input"><option value="">Select…</option></select>
        <div class="muted small" style="margin-top:4px">(Bowler wicket-keeper nahi ho sakta)</div>
      </div>
    </div>

    <div class="row wrap" style="margin-top:10px">
      <button class="btn ok" id="btnSaveOpening" type="button">Save Opening</button>
      <div class="muted small" id="openingMsg"></div>
    </div>
  `;

  parent.insertBefore(openCard, ballCard);
  _openingMounted = true;

  $("btnSaveOpening")?.addEventListener("click", async ()=>{
    if(!CURRENT_DOC) return;
    const s = $("opStriker")?.value?.trim();
    const ns = $("opNonStriker")?.value?.trim();
    const bo = $("opBowler")?.value?.trim();
    try{
      await setOpeningSetup(FB, matchId, s, ns, bo);
      $("openingMsg").textContent = "Opening saved ✅ Ab scoring start kar sakte ho.";
      showState("Opening saved ✅", true);
    }catch(e){
      alert(e?.message || String(e));
    }
  });
}

function updateOpeningUI(doc){
  if(USE_SETUP_WIZARD) return;

  if(!_openingMounted) mountOpeningCard();
  const card = $("openingCard");
  if(!card) return;
  const st = doc?.state || {};
  const idx = Number(st?.inningsIndex||0);
  const hasToss = !!(st.toss || doc?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[doc.a]?.length===11 && st.playingXI[doc.b]?.length===11);

  // ✅ UX: 2nd innings me opening selection wizard se hoga (Break -> Opening). Is page par opening card hide.
  if(idx>=1 && hasToss && hasXI){
    card.style.display = "none";
    return;
  }

  const inn = currentInnings(doc);
  const of = inn?.onField || {};
  // Once innings has started (any ball logged), opening setup should never re-appear
  // even if bowler gets cleared for a new over.
  const inningsStarted = !!(
    inn && (
      (Number(inn.ballsTotal||0) > 0) ||
      (Number(inn.balls||0) > 0) ||
      ((inn.ballByBall?.length||0) > 0) ||
      ((inn.openingDone === true)) ||
      (inn.batters && Object.keys(inn.batters).length > 0)
    )
  );

  const hasOpening = inningsStarted || !!(of.striker && of.nonStriker && of.bowler);

  // show only when toss+XI done and opening missing (and innings not started)
  card.style.display = (hasToss && hasXI && !hasOpening) ? "block" : "none";

  if(!(hasToss && hasXI)) return;
  const { batting, bowling } = battingBowlingTeams(doc);
  const batXI = playingXIOf(st, batting) || squadOf(batting);
  const bowlXI = playingXIOf(st, bowling) || squadOf(bowling);

  fillSelect($("opStriker"), batXI, `Select opener (${batting})…`);
  fillSelect($("opNonStriker"), batXI, `Select opener (${batting})…`);

  // remove wicket-keeper from bowler options if known
  const wk = playingXIMetaOf(st, bowling)?.wicketKeeperId;
  const bowlList = wk ? bowlXI.filter(n=>n!==wk) : bowlXI;
  fillSelect($("opBowler"), bowlList, `Select bowler (${bowling})…`);

  if(of.striker) $("opStriker").value = of.striker;
  if(of.nonStriker) $("opNonStriker").value = of.nonStriker;
  if(of.bowler) $("opBowler").value = of.bowler;

  const msg = $("openingMsg");
  if(msg){
    msg.textContent = hasOpening ? `Saved: ${of.striker} & ${of.nonStriker}, Bowler ${of.bowler}` : "Pending.";
  }
}

// -----------------------------
// Wicket Modal (dropdown based + fielder)
// -----------------------------
const WICKET_TYPES = ["Bowled","Caught","Run Out","Stumped","Hit Wicket","Retired Hurt","Retired Out"];

function allowedWicketTypes(freeHit, delivery){
  const d = (delivery||"LEGAL").toString().toUpperCase();
  if(freeHit && d === "LEGAL") return ["Run Out","Retired Hurt","Retired Out"];
  if(d === "NB") return ["Run Out","Retired Hurt","Retired Out"];
  if(d === "WD") return ["Run Out","Stumped","Retired Hurt","Retired Out"];
  return WICKET_TYPES;
}

function setWicketTypeOptions(list, selected){
  const sel = $("outType");
  if(!sel) return;
  sel.innerHTML = list.map(t=>`<option value="${t}">${t}</option>`).join("");
  if(selected && list.includes(selected)) sel.value = selected;
}

function openWicketModal(doc){
  const modal = $("wicketModal");
  if(!modal) return alert("wicketModal missing in scorer.html");
  modal.style.display = "block";
  $("wicketMsg").textContent = "";

  const st = doc.state || {};
  const inn = currentInnings(doc) || st.innings?.[0] || {};
  const of = inn.onField || {};
  const { batting, bowling } = battingBowlingTeams(doc);

  const freeHit = !!of.freeHit;
  const deliveryNow = $("wDelivery")?.value || "LEGAL";
  setWicketTypeOptions(allowedWicketTypes(freeHit, deliveryNow), $("outType")?.value||"");

  // Update wicket types live when delivery type changes
  const wDel = $("wDelivery");
  if(wDel && !wDel.__wktBound){
    wDel.__wktBound = true;
    wDel.addEventListener("change", ()=>{
      const d = wDel.value || "LEGAL";
      const list = allowedWicketTypes(!!window.__WKT_FREE_HIT, d);
      setWicketTypeOptions(list, $("outType")?.value||"");
    });
  }
  window.__WKT_FREE_HIT = freeHit;

  // hint
  if($("wicketMsg")){
    if(freeHit){
      $("wicketMsg").textContent = "FREE HIT: Legal ball par sirf Run Out allowed.";
    } else {
      $("wicketMsg").textContent = "";
    }
  }

  const outs = [of.striker, of.nonStriker].filter(Boolean);
  $("outBatter").innerHTML = outs.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");

  const xiBat = playingXIOf(st, batting) || squadOf(batting);

  const outSet = new Set();
  Object.entries(inn.batters||{}).forEach(([name, b])=>{ if(b?.out) outSet.add(name); });

  const eligible = xiBat.filter(n=>{
    if(!n) return false;
    if(n===of.striker || n===of.nonStriker) return false;
    if(outSet.has(n)) return false;
    return true;
  });

  $("nextBatter").innerHTML = `<option value="">Select next batter…</option>` +
    eligible.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("");

  const xiField = playingXIOf(st, bowling) || squadOf(bowling);
  fillSelect($("outFielder"), xiField, `Select fielder (${bowling})…`);
}

function closeWicketModal(){
  const modal = $("wicketModal");
  if(modal) modal.style.display = "none";
}

$("wicketCancel")?.addEventListener("click", closeWicketModal);
$("wicketX")?.addEventListener("click", closeWicketModal);

$("wicketSave")?.addEventListener("click", async ()=>{
  if(!CURRENT_DOC) return;

  const names = requireNames();
  if(!names) return;

  const outType = ($("outType")?.value || "Bowled").trim();
  const delivery = ($("wDelivery")?.value || "LEGAL").trim();
  const wRuns = Number($("wRuns")?.value || 0);
  const crossed = !!$("wCrossed")?.checked;
  const outBatter = ($("outBatter")?.value || "").trim();
  const nextBatter = ($("nextBatter")?.value || "").trim();
  const fielder = ($("outFielder")?.value || "").trim();

  const kindLc = outType.toLowerCase();
  const stFH = CURRENT_DOC?.state || {};
  const innFH = currentInnings(CURRENT_DOC) || stFH.innings?.[Number(stFH.inningsIndex||0)] || {};
  const freeHit = !!innFH?.onField?.freeHit;
  // Enforce rules on UI as well (core also validates)
  if(freeHit && delivery.toUpperCase()==="LEGAL" && kindLc!=="run out"){
    $("wicketMsg").textContent = "FREE HIT: Legal ball par sirf Run Out allowed.";
    return;
  }
  if(delivery.toUpperCase()==="NB" && kindLc!=="run out"){
    $("wicketMsg").textContent = "NO-BALL par wicket (Bowled/Caught/LBW/Stumped...) allowed nahi. Sirf Run Out.";
    return;
  }
  if(delivery.toUpperCase()==="WD" && !(kindLc==="run out" || kindLc==="stumped")){
    $("wicketMsg").textContent = "WIDE par sirf Run Out ya Stumped allowed.";
    return;
  }
  const needsFielder = (kindLc==="caught" || kindLc==="run out" || kindLc==="stumped");
  const isRetHurt = (kindLc==="retired hurt");

  if(!outBatter){
    $("wicketMsg").textContent = "Out batsman select karo.";
    return;
  }
  if(needsFielder && !fielder){
    $("wicketMsg").textContent = "Fielder select karo (fielding XI).";
    return;
  }

  const inn = currentInnings(CURRENT_DOC) || {};
  const wktsNow = Number(inn.wkts||0);
  const lastWicket = wktsNow >= 9;
  if(!isRetHurt && !lastWicket && !nextBatter){
    $("wicketMsg").textContent = "Next batsman select karo.";
    return;
  }

  closeWicketModal();

  await safeAddBall({
    type: "WICKET",
    runs: wRuns,
    batter: names.batter,
    nonStriker: names.nonStriker,
    bowler: names.bowler,
    delivery, // LEGAL|WD|NB
    wicketKind: outType,
    outBatter,
    nextBatter: nextBatter || null,
    fielder: fielder || null,
    crossed
  });
});

// -----------------------------
// Bowler Modal (Over-end UX)
// -----------------------------
let LAST_BOWLER_MODAL_KEY = "";

function openBowlerModal(doc){
  const modal = $("bowlerModal");
  if(!modal) return;
  const st = doc?.state || {};
  const inn = currentInnings(doc) || st.innings?.[Number(st.inningsIndex||0)] || {};
  const of = inn.onField || {};
  if(!of.needNewBowler) return;

  const key = `${Number(st.inningsIndex||0)}-${Number(inn.balls||0)}`;
  if(LAST_BOWLER_MODAL_KEY === key) return;

  const { bowling } = battingBowlingTeams(doc);
  const xiBowl = playingXIOf(st, bowling) || squadOf(bowling);
  const wk = playingXIMetaOf(st, bowling)?.wicketKeeperId;
  const last = (of.lastBowler||"").trim();
  const list = xiBowl.filter(n=>n && n!==wk && n!==last);

  fillSelect($("nextBowlerSel"), list, `Select bowler (${bowling})…`);
  $("bowlerModalMsg").textContent = "";
  modal.style.display = "block";
  LAST_BOWLER_MODAL_KEY = key;

  setTimeout(()=>{ try{ $("nextBowlerSel")?.focus(); }catch(e){} }, 0);
}

function closeBowlerModal(){
  const modal = $("bowlerModal");
  if(modal) modal.style.display = "none";
}

$("bowlerCancel")?.addEventListener("click", closeBowlerModal);
$("bowlerX")?.addEventListener("click", closeBowlerModal);
$("bowlerSave")?.addEventListener("click", ()=>{
  const sel = ($("nextBowlerSel")?.value || "").trim();
  if(!sel){
    $("bowlerModalMsg").textContent = "Bowler select karo.";
    return;
  }
  // set main bowler dropdown; will be persisted on next ball
  const main = $("bowler");
  if(main) main.value = sel;
  closeBowlerModal();
  showState(`Bowler set: ${sel}`, true);
});

// -----------------------------
// Buttons
// -----------------------------
$("btnStart")?.addEventListener("click", async ()=>{
  const st = CURRENT_DOC?.state || {};
  const hasToss = !!(st.toss || CURRENT_DOC?.tossWinner);
  const hasXI = !!(st.playingXI && st.playingXI[CURRENT_DOC.a]?.length===11 && st.playingXI[CURRENT_DOC.b]?.length===11);
  const inn = currentInnings(CURRENT_DOC);
  const of = inn?.onField || {};
  const hasOpening = !!(of.striker && of.nonStriker && of.bowler);
  if(!hasToss) return alert("Pehele Toss set karo.");
  if(!hasXI) return alert("Pehele Playing XI (11-11) select karo.");
  if(!hasOpening) return alert("Pehele Opening setup (2 openers + opening bowler) save karo.");
  await setMatchStatus(FB, matchId, "LIVE");
});

$("btnEnd")?.addEventListener("click", async ()=>{
  await setMatchStatus(FB, matchId, "COMPLETED");
  try{
    const awards = await finalizeMatchAndComputeAwards(FB, matchId);
    showAwardsPopup(awards);
  }catch(e){
    console.warn("Awards compute failed", e);
  }
});
$("btnReset")?.addEventListener("click", async ()=>{
  if(!confirm("Reset match? (All balls delete)")) return;
  await resetMatch(FB, matchId);
  alert("Reset done ✅");
});

$("undoBall")?.addEventListener("click", ()=>undoBall(FB, matchId));

document.querySelectorAll("[data-run]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const names = requireNames();
    if(!names) return;
    const runs = Number(btn.getAttribute("data-run")||0);
    await safeAddBall({ type:"RUN", runs, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
  });
});

document.querySelectorAll("[data-extra]").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const names = requireNames();
    if(!names) return;
    const x = btn.getAttribute("data-extra");
    if(x==="wd"){
      const total = Math.max(1, Number(prompt("Wide total runs? (min 1)", "1") || 1));
      await safeAddBall({ type:"WD", runs:total, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
    if(x==="nb"){
      const total = Math.max(1, Number(prompt("No-ball total runs? (min 1)\nExample: NB+4 = 5", "1") || 1));
      let batRuns = 0;
      if(total>1 && confirm("NB par bat se runs hue the? (OK=yes / Cancel=no)")){
        batRuns = Math.max(0, Math.min(total-1, Number(prompt("Bat runs on NB? (0-"+(total-1)+")", String(total-1)) || (total-1))));
      }
      await safeAddBall({ type:"NB", runs:total, batRuns, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
    if(x==="bye"){
      const r = Math.max(0, Number(prompt("Bye runs?", "1") || 1));
      await safeAddBall({ type:"BYE", runs:r, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
    if(x==="lb"){
      const r = Math.max(0, Number(prompt("Leg-bye runs?", "1") || 1));
      await safeAddBall({ type:"LB", runs:r, batter:names.batter, nonStriker:names.nonStriker, bowler:names.bowler });
    }
  });
});

document.querySelectorAll("[data-wicket]").forEach(btn=>{
  btn.addEventListener("click", ()=> openWicketModal(CURRENT_DOC));
});

// -----------------------------
// Auth
// -----------------------------
watchAuth(FB, (user)=>{
  if(!user){
    showState("Login required. Admin page se login karke aao.", false);
  }else{
    showState(`Logged in: ${user.email}`, true);
  }
});

// -----------------------------
// Render
// -----------------------------
function render(doc){
  CURRENT_DOC = doc;
  ensureWizard();
  window.__MATCH__ = doc;// exposed for UI debug

  if(!doc){
    showState("Match not found.", false);
    return;
  }

  if(!TOURNAMENT){
    loadTournament(FB).then(t=>{
      TOURNAMENT = t;
      SQUADS = t?.squads || {};
    }).catch(()=>{});
  }

  $("sTitle").textContent = `Scorer • Match ${doc.matchId || matchId}`;
  $("sMeta").textContent = `${doc.a} vs ${doc.b} • Group ${doc.group||"-"} • Time ${doc.time||"-"} • Status ${doc.status||"UPCOMING"}`;

  // ✅ Auto completion popup (chase achieved / overs complete / tie)
  if(LAST_STATUS && LAST_STATUS !== "COMPLETED" && doc.status === "COMPLETED"){
    const key = `awardsShown:${matchId}:${doc.updatedAt?.seconds||""}`;
    if(!localStorage.getItem(key)){
      if(doc.awards) showAwardsPopup(doc.awards);
      localStorage.setItem(key, "1");
    }
  }
  LAST_STATUS = doc.status;

  mountTossCard();
  updateTossUI(doc);

  mountPlayingXICard();
  updateXIUI(doc);

  mountInningsBreakCard();
  updateInningsBreakUI(doc);

  mountOpeningCard();
  updateOpeningUI(doc);

  if(WIZARD) WIZARD.sync(doc);

  ensureDropdowns(doc);

  // Cricbuzz-style live chip for scorer
  renderScorerLiveChip(doc);
  renderFreeHitBadge(doc);
  maybeShowInningsBreak(doc);

  const inn = currentInnings(doc);
  const of = inn?.onField;
  if(of){
    if(of.striker) $("batter").value = of.striker;
    if(of.nonStriker) $("nonStriker").value = of.nonStriker;

    if(of.needNewBowler){
      $("bowler").value = "";
      showState("Over complete. New bowler select karo.", false);
      openBowlerModal(doc);
    }else if(of.bowler){
      $("bowler").value = of.bowler;
    }

    if(of.needNextBatter){
      showState("Wicket hua hai. Wicket button se next batsman select karo.", false);
    }
  }

  const preview = $("preview");
  if(preview){
    const st = doc.state || {};
    const summary = doc.summary || st.summary || {};
    preview.innerHTML =
      renderScoreLine({ matchId: doc.matchId, a: doc.a, b: doc.b, group: doc.group, time: doc.time, status: doc.status, summary }, st)
      + renderCommentary(st, 8);
  }
  // ✅ Innings Break UI (Scorecard + Start 2nd Innings)
  maybeHandleInningsBreakUI(doc);

}

watchMatch(FB, matchId, render);
