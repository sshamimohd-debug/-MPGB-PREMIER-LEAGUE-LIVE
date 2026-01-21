export const $ = (s, el=document)=>el.querySelector(s);
export const $$ = (s, el=document)=>Array.from(el.querySelectorAll(s));
export const esc = (s)=> (s??"").toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setActiveNav(key){
  document.querySelectorAll('[data-nav]').forEach(a=>{
    if(a.dataset.nav===key) a.classList.add('active'); else a.classList.remove('active');
  });
}
export async function loadTournament(){
  const res = await fetch('data/tournament.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Cannot load data/tournament.json');
  return await res.json();
}
export function fmtStatus(s){
  if(s==='LIVE') return {cls:'live', text:'LIVE'};
  if(s==='COMPLETED') return {cls:'done', text:'COMPLETED'};
  return {cls:'up', text:'UPCOMING'};
}
export function qs(){
  return new URLSearchParams(location.search);
}
export function idHash(s){
  return (s||"").toString().trim();
}

// ----------------------------
// Match context helpers (keeps Scorecard/Live tabs in-sync)
// ----------------------------
const LAST_MATCH_KEY = "mpgb_last_match";

export function persistLastMatchId(matchId){
  try{
    const id = (matchId || "").toString().trim();
    if(id) localStorage.setItem(LAST_MATCH_KEY, id);
  }catch(e){}
}

export function getLastMatchId(){
  try{ return (localStorage.getItem(LAST_MATCH_KEY) || "").toString().trim(); }
  catch(e){ return ""; }
}

// Preferred match id resolution order:
// 1) URL ?match=
// 2) persisted last match
// 3) fallback (default: A1)
export function preferredMatchId(fallback="A1"){
  const q = qs().get("match");
  const saved = getLastMatchId();
  return (q || saved || fallback).toString().trim();
}

// Rewrite bottom tab links so they keep the current match context.
// Works on pages that have the bottomNav markup.
export function wireBottomNav(matchId){
  try{
    const id = (matchId || "").toString().trim();
    if(!id) return;
    const map = {
      live: `live.html?match=${encodeURIComponent(id)}`,
      scorecard: `scorecard.html?match=${encodeURIComponent(id)}`
    };
    const apply = ()=>{
      document.querySelectorAll('.bottomNav a[data-nav]')
        .forEach(a=>{
          const k = a.getAttribute('data-nav');
          if(map[k]) a.setAttribute('href', map[k]);
        });
    };

    // Some pages load their module script before rendering bottomNav markup.
    // In that case, defer link rewriting until DOM is ready.
    if(document.querySelector('.bottomNav')) apply();
    else window.addEventListener('DOMContentLoaded', apply, {once:true});
  }catch(e){}
}
