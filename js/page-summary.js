import { setActiveNav, preferredMatchId, persistLastMatchId, wireBottomNav, esc } from "./util.js";
import { getFB, watchMatch } from "./store-fb.js";
import { renderScoreLine, renderBestPerformers, renderMatchDetailsCard } from "./renderers.js";

setActiveNav("summary");

const FB = getFB();
const matchId = preferredMatchId("A1");
persistLastMatchId(matchId);
wireBottomNav(matchId);

// Wire nav tabs / buttons
const scorecardUrl = `scorecard.html?match=${encodeURIComponent(matchId)}`;
const commentaryUrl = `live.html?match=${encodeURIComponent(matchId)}`;

document.getElementById("btnScorecard").href = scorecardUrl;
document.getElementById("btnCommentary").href = commentaryUrl;
document.getElementById("tabSummary").href = `summary.html?match=${encodeURIComponent(matchId)}`;
document.getElementById("tabScorecard").href = scorecardUrl;
document.getElementById("tabCommentary").href = commentaryUrl;

if (!FB) {
  document.getElementById("sumTitle").textContent = "Firebase not configured";
  document.getElementById("sumMeta").textContent = "Please set Firebase config in js/firebase-config.js";
} else {
  watchMatch(FB, matchId, (doc) => {
    if (!doc) {
      document.getElementById("sumTitle").textContent = "Match not found";
      document.getElementById("sumMeta").textContent = `Match ${esc(matchId)} not available in database.`;
      return;
    }

    document.getElementById("sumTitle").textContent = `${doc.a} vs ${doc.b}`;
    document.getElementById("sumMeta").textContent = `Match ${doc.matchId} • ${doc.group ? `Group ${doc.group}` : ""}${doc.time ? ` • ${doc.time}` : ""} • Status: ${doc.status}`;

    document.getElementById("scoreLine").innerHTML = renderScoreLine(doc);
    document.getElementById("bestWrap").innerHTML = renderBestPerformers(doc);
    document.getElementById("details").innerHTML = renderMatchDetailsCard(doc);

    // Views / live viewers (best effort; doesn't require backend changes)
    document.getElementById("totalViews").textContent = String(doc.views || 0);
    document.getElementById("liveViewers").textContent = String(doc.liveViewers || 0);

    // Player of match
    const mom = doc?.awards?.mom;
    document.getElementById("pom").innerHTML = mom?.name
      ? `<b>${esc(mom.name)}</b> <span class="muted small">(${esc(mom.team || "")})</span>`
      : `<span class="muted small">—</span>`;

    // Officials / scorer
    const off = doc.officials || {};
    const parts = [];
    if (off.umpire1) parts.push(`Umpire: <b>${esc(off.umpire1)}</b>`);
    if (off.umpire2) parts.push(`Umpire: <b>${esc(off.umpire2)}</b>`);
    if (off.scorer) parts.push(`Scorer: <b>${esc(off.scorer)}</b>`);
    document.getElementById("officials").innerHTML = parts.length ? parts.join("<br>") : `<span class="muted small">—</span>`;

    // Notes
    const notes = doc.notes || doc.note || doc.matchNotes || "";
    document.getElementById("notesWrap").innerHTML = notes ? esc(notes) : "—";
  });
}
