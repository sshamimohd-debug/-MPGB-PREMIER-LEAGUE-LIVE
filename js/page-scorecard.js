import { setActiveNav, preferredMatchId, persistLastMatchId, wireBottomNav } from "./util.js";
import { getFB, watchMatch } from "./store-fb.js";
import { renderScorecard, renderScoreLine } from "./renderers.js";

setActiveNav("scorecard");
const FB = getFB();
const matchId = preferredMatchId("A1");
persistLastMatchId(matchId);
wireBottomNav(matchId);

document.getElementById("btnLive").href = `live.html?match=${encodeURIComponent(matchId)}`;
document.getElementById("btnSummary").href = `summary.html?match=${encodeURIComponent(matchId)}`;
document.getElementById("tabSummary").href = `summary.html?match=${encodeURIComponent(matchId)}`;
document.getElementById("tabScorecard").href = `scorecard.html?match=${encodeURIComponent(matchId)}`;
document.getElementById("tabCommentary").href = `live.html?match=${encodeURIComponent(matchId)}`;

if(!FB){
  document.getElementById("scTitle").textContent = "Firebase not configured";
} else {
  watchMatch(FB, matchId, (doc)=>{
    if(!doc){
      document.getElementById("scTitle").textContent = "Match not found";
      return;
    }
    document.getElementById("scTitle").textContent = `Scorecard • ${doc.a} vs ${doc.b}`;
    document.getElementById("scMeta").textContent = `Match ${doc.matchId} • Group ${doc.group} • ${doc.time} • Status: ${doc.status}`;
    const wrap = document.getElementById("inningsWrap");
    wrap.innerHTML = renderScoreLine(doc) + renderScorecard(doc);

    // Wire innings tabs (Cricbuzz style): only one innings visible at a time.
    const blocks = Array.from(wrap.querySelectorAll("[data-inn-block]"));
    const tabs = Array.from(wrap.querySelectorAll("[data-inn-tab]"));
    if(tabs.length){
      const show = (idx)=>{
        blocks.forEach(b=>{ b.style.display = (b.getAttribute("data-inn-block")===String(idx)) ? "block" : "none"; });
        tabs.forEach(t=>{
          const on = t.getAttribute("data-inn-tab")===String(idx);
          t.classList.toggle("on", on);
        });
      };
      tabs.forEach(t=>t.addEventListener("click", ()=> show(t.getAttribute("data-inn-tab"))));
    }
  });
}
