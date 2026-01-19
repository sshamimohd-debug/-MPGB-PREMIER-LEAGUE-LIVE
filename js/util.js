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
