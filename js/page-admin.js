import { setActiveNav, loadTournament, esc } from "./util.js";
import { getFB, ensureTournamentDocs, watchAuth, signIn, signOutUser } from "./store-fb.js";
import { firebaseReady } from "./firebase.js";

setActiveNav("admin");
const FB = getFB();

const $ = (id)=>document.getElementById(id);

function showState(msg, ok=true){
  $("initState").textContent = msg;
  $("initState").style.color = ok ? "var(--muted)" : "#ff9a9a";
}

(async function(){
  if(!firebaseReady() || !FB){
    showState("Firebase not configured. Fill js/firebase-config.js and reload.", false);
    $("btnInit").disabled = true;
    $("btnLogin").disabled = true;
    return;
  }

  const t = await loadTournament();

  const scorerLinks = $("scorerLinks");
  scorerLinks.innerHTML = t.matches.slice(0,8).map(m=>`<a class="pill" href="scorer.html?match=${encodeURIComponent(m.matchId)}">${esc(m.matchId)}</a>`).join("")
    + `<a class="pill" href="schedule.html">All matches</a>`;

  watchAuth(FB, (user)=>{
    if(user){
      $("authState").textContent = `Signed in: ${user.email}`;
      $("btnLogin").style.display="none";
      $("btnLogout").style.display="inline-flex";
      $("btnInit").disabled=false;
    } else {
      $("authState").textContent = "Not signed in.";
      $("btnLogin").style.display="inline-flex";
      $("btnLogout").style.display="none";
      $("btnInit").disabled=true;
    }
  });

  $("btnLogin").addEventListener("click", async ()=>{
    try{
      await signIn(FB, $("email").value.trim(), $("pass").value);
    }catch(e){
      $("authState").textContent = "Login failed: " + (e?.message||e);
    }
  });

  $("btnLogout").addEventListener("click", async ()=>{
    await signOutUser(FB);
  });

  $("btnInit").addEventListener("click", async ()=>{
    try{
      showState("Initializing…");
      await ensureTournamentDocs(FB, t);
      showState("Done ✅ Tournament + matches created/updated in Firestore.");
    }catch(e){
      showState("Init failed: " + (e?.message||e), false);
    }
  });
})();
