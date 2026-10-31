'use strict';
(() => {
  const $=id=>document.getElementById(id), KEY='deadlock-match-clock-v3', MAX_SECONDS=7200;
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const validRecord=value=>value&&typeof value==='object'&&finite(value.at)&&value.at>=0&&finite(value.due)&&value.due>value.at;
  const cleanRecords=value=>Object.fromEntries(Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{}).filter(([id,r])=>id&&validRecord(r)).map(([id,r])=>[id,{...r,kind:typeof r.kind==='string'?r.kind:'clear'}]));
  let saved;try{saved=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
  const valid=saved&&finite(saved.base)&&saved.base>=0&&finite(saved.anchor);
  const state={base:valid?Math.min(saved.base,MAX_SECONDS):0,anchor:Date.now(),running:valid?!!saved.running:false,records:valid?cleanRecords(saved.records):{}};
  if(valid&&state.running)state.base=Math.min(MAX_SECONDS,state.base+Math.max(0,(Date.now()-saved.anchor)/1000));
  if(state.base>=MAX_SECONDS)state.running=false;
  let atlas, plan, dataError=false, lastSecond=-1, pendingTarget=null, renderedRunning=null;
  const fmt=seconds=>{const s=finite(seconds)?Math.max(0,Math.ceil(seconds)):0;return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
  const seconds=()=>Math.min(MAX_SECONDS,Math.max(0,state.base+(state.running?Math.max(0,(Date.now()-state.anchor)/1000):0)));
  function save(){try{localStorage.setItem(KEY,JSON.stringify({base:seconds(),anchor:Date.now(),running:state.running,records:state.records}));return true;}catch{return false;}}
  function emit(reason='tick',id=null){window.dispatchEvent(new CustomEvent('match:tick',{detail:{seconds:seconds(),running:state.running,reason,id}}));}
  function setTime(value){const next=Number(value);if(!Number.isFinite(next))return false;state.base=Math.max(0,Math.min(MAX_SECONDS,next));state.anchor=Date.now();if(state.base>=MAX_SECONDS)state.running=false;save();tick(true,'sync');return true;}
  function toggle(){state.base=seconds();state.anchor=Date.now();state.running=state.base<MAX_SECONDS&&!state.running;save();tick(true,'run');}
  function reset(){state.base=0;state.anchor=Date.now();state.running=false;state.records={};save();tick(true,'reset');}
  function record(id,duration,kind='clear',extra={}){
    if(typeof id!=='string'||!id)return false;
    const metadata=extra&&typeof extra==='object'?{...extra}:{};
    let interval=Number(duration);
    if(kind==='midboss'){
      const event=plan?.eventRules?.find(r=>r.id==='midboss');
      const sequence=event?.returnSecondsByDeath||[420,360,300];
      const supplied=metadata.deathNumber??metadata.deathCount;
      let deathNumber=supplied==null?sequence.indexOf(interval)+1:Number(supplied);
      if(!Number.isInteger(deathNumber)||deathNumber<1)return false;
      interval=sequence[Math.min(deathNumber,sequence.length)-1];
      metadata.deathNumber=deathNumber;
    }else if(kind==='rift')interval=plan?.eventRules?.find(r=>r.id==='rift')?.opensAfterAnnouncementSeconds??20;
    if(!Number.isFinite(interval)||interval<=0)return false;
    const at=seconds();state.records[id]={...metadata,at,due:at+interval,kind};save();tick(true,'record',id);return true;
  }
  function undo(id){delete state.records[id];save();tick(true,'record',id);}
  function ruleFor(p){
    if(!p)return {kind:'utility',reference:'Choose a target on the map.'};
    if(!plan)return {kind:'loading',reference:dataError?'Timing data could not load. Reload to try again.':'Loading verified timing rules…'};
    const special=plan.localOverrides.entries.find(r=>r.poiId===p.id);if(special)return {uncertain:true,uncertainty:'local',first:null,return:null,kind:'custom',reference:'Early local spawn is unverified. Use this camp’s in-game timer.',action:'Check the camp, then take it only after your wave and with a safe exit.',wait:'The authored opening time is unconfirmed; follow the in-game timer.',sources:plan.localOverrides.sources};
    const structure=plan.structureRules.find(r=>r.poiTypes.includes(p.type));if(structure)return {...structure,kind:'prerequisite',action:structure.recommend,wait:structure.waitIf,reference:'No fixed attack minute · prerequisite and safety decide.'};
    if(['crate','tough','buffContainer'].includes(p.type)){
      const vaulted=(p.packageIds||[]).some(id=>['bell-tower','sunken-plaza'].includes(id));
      const square=p.timing?.firstSpawnSeconds===600;
      if(vaulted||square){const r=plan.resourceRules.find(r=>r.id===(square?'times_square_loot':'tower_plaza_loot'));return {...r,first:r.firstSeconds,return:r.returnSeconds,wait:r.waitIf,kind:'clear',reference:`First ${fmt(r.firstSeconds)} · return ${fmt(r.returnSeconds)} after this object breaks; collect its drop.`};}
      return {kind:'custom',uncertain:true,uncertainty:'area',first:null,return:null,reference:'Surface: first 03:00, return 03:00. Tunnels: first 05:00, return 05:00. Confirm the area.',action:'Break convenient boxes or containers while moving between useful stops.',wait:'A precise timer needs a confirmed area; do not lose a wave for the detour.',sources:plan.resourceRules.find(r=>r.id==='surface_loot')?.sources};
    }
    const event=plan.eventRules.find(r=>r.poiTypes.includes(p.type));
    if(p.type==='midBoss')return {...event,kind:'midboss',first:event.firstSeconds,reference:'Present from start · returns 07:00, then 06:00, then 05:00 after deaths.',wait:event.waitIf};
    if(p.type==='rift')return {...event,kind:'rift',reference:'Variable event. Opens 00:20 after the live announcement.',wait:event.waitIf};
    if(p.type==='urnSite')return {...event,kind:'urn',first:event.firstArrivalSeconds,reference:'Arrives at 10:00 · first pickup about 10:13. Later 5-minute checkpoints can be delayed.',wait:event.waitIf};
    const r=plan.resourceRules.find(r=>r.poiTypes.includes(p.type)&&!r.packageIds);
    if(r){const ret=p.timing?.respawnAfterFullClearSeconds??r.returnSeconds;return {...r,first:r.firstSeconds,return:ret,wait:r.waitIf,kind:r.timerKind==='scheduled'?'scheduled':'clear',reference:`First ${fmt(r.firstSeconds)}${ret!=null?` · return ${fmt(ret)} after ${p.type==='healingSnack'?'pickup':p.type==='sinner'?'the entire site is cleared':'full clear'}`:r.intervalSeconds?' · 5-minute match schedule':''}.`};}
    return {kind:'utility',reference:'Use whenever it is safe · no farming countdown.',action:null};
  }
  function describe(p){
    const r=ruleFor(p),now=seconds(),rec=state.records[p?.id];
    if(rec){
      if(rec.at>now+0.05)return {...r,status:'waiting',label:'Recorded event is ahead of this clock',note:`Recorded at ${fmt(rec.at)}. Sync the match time or undo this record.`,record:rec,remaining:null};
      const remaining=rec.due-now;
      if(rec.kind==='midboss'){
        const landingAt=rec.at+(r.rewardLandingSeconds??7.5);
        if(now<landingAt)return {...r,status:'tracked',label:`Crystals descending · land in ${fmt(landingAt-now)}`,note:`Guard all three crystals. Midboss expected back at ${fmt(rec.due)}.`,remaining:landingAt-now,respawnRemaining:remaining,record:rec};
      }
      return {...r,status:remaining>0?'tracked':'check',label:remaining>0?`${rec.kind==='rift'?'Opens':'Expected return'} in ${fmt(remaining)}`:rec.kind==='rift'?'Opening time passed · check event':'Expected back · check in-game',note:`Recorded at ${fmt(rec.at)} · expected ${fmt(rec.due)}`,remaining:remaining>0?remaining:null,record:rec};
    }
    if(r.kind==='loading')return {...r,status:'condition',label:r.reference,note:'The manual clock still works.',remaining:null};
    if(r.kind==='prerequisite')return {...r,status:'condition',label:r.required,note:r.reference,remaining:null};
    if(r.uncertain)return {...r,status:'condition',label:r.uncertainty==='local'?'Local timer unverified · check in-game':'Area-dependent timing · check in-game',note:r.reference,remaining:null};
    if(r.kind==='midboss')return {...r,status:'condition',label:'Team readiness decides when to attack',note:r.reference,remaining:null};
    if(r.kind==='rift')return {...r,status:'condition',label:'Wait for the live announcement',note:r.reference,remaining:null};
    if(r.kind==='urn'){
      if(now<r.firstArrivalSeconds)return {...r,status:'waiting',label:`First Urn arrives in ${fmt(r.firstArrivalSeconds-now)}`,note:r.reference,remaining:r.firstArrivalSeconds-now};
      if(now<r.firstUsableEstimateSeconds)return {...r,status:'waiting',label:`Urn descending · pickup in about ${fmt(r.firstUsableEstimateSeconds-now)}`,note:'Do not try to take it before it lands.',remaining:r.firstUsableEstimateSeconds-now};
      return {...r,status:'check',label:'Check the active Urn and delivery point',note:r.reference,remaining:null};
    }
    if(r.first!=null&&now<r.first)return {...r,status:'waiting',label:`First spawn in ${fmt(r.first-now)}`,note:r.reference,remaining:r.first-now};
    if(r.kind==='scheduled'){const next=r.firstSeconds+(Math.floor((now-r.firstSeconds)/r.intervalSeconds)+1)*r.intervalSeconds;return {...r,status:'check',label:`Check pickup · next scheduled in ${fmt(next-now)}`,note:r.reference,remaining:null,scheduledRemaining:next-now};}
    if(r.first!=null)return {...r,status:'check',label:'First spawn passed · check availability',note:r.reference,remaining:null};
    return {...r,status:'condition',label:'Use when the route is safe',note:r.reference,remaining:null};
  }
  function recommendations(){const now=seconds(),stage=plan?.visibleStageCards?.find(r=>now>=r.fromSeconds&&(r.toSeconds==null||now<r.toSeconds));const shared={waitTitle:'WAIT IF',waitNote:stage?.wait||'The clear risks your wave, health or exit.'};if(now<120)return {...shared,nowTitle:'Lane waves',nowNote:'Secure souls, trade safely.',nowFocus:['guardian'],nextTitle:'Small camps',nextNote:`First spawn in ${fmt(120-now)}`,nextFocus:['small']};if(now<180)return {...shared,nowTitle:'Nearby small camps',nowNote:'After your wave; keep an exit.',nowFocus:['small'],nextTitle:'Surface boxes',nextNote:`Usual first spawn in ${fmt(180-now)}`,nextFocus:['crate']};if(now<300)return {...shared,nowTitle:'Wave + nearby loot',nowNote:'Short detours; don’t lose a wave.',nowFocus:['crate','small'],nextTitle:'Medium camps',nextNote:`Usual first spawn in ${fmt(300-now)}`,nextFocus:['medium']};if(now<480)return {...shared,nowTitle:'Medium camps + bridge buff',nowNote:'Wave first; choose a quick, safe detour.',nowFocus:['medium','powerup'],nextTitle:'Sinners + large camps',nextNote:`Usual first spawn in ${fmt(480-now)}`,nextFocus:['sinner','large']};if(now<600)return {...shared,nowTitle:'Safe Sinner detours',nowNote:'Enough health to clear and leave.',nowFocus:['sinner'],nextTitle:'Soul Urn arrival',nextNote:`Arrives in ${fmt(600-now)}; then descends.`,nextFocus:['urn']};if(now<612.5)return {...shared,waitNote:'The Urn is still descending; wait until it lands.',nowTitle:'Urn descending',nowNote:'Prepare a safe escort.',nowFocus:['urn'],nextTitle:'First Urn pickup',nextNote:`About ${fmt(612.5-now)} until landed.`,nextFocus:['urn']};const next=(Math.floor(now/300)+1)*300;return {...shared,nowTitle:now<1200?'Push toward a Walker':'Next team objective',nowNote:'Win space, bring the wave, then attack.',nowFocus:now<1200?['walker']:['base_guardian','shrine','patron'],nextTitle:'Bridge-buff checkpoint',nextNote:`Scheduled check in ${fmt(next-now)}`,nextFocus:['powerup']};}
  function renderRunControl(){
    if(renderedRunning===state.running)return;
    const button=$('clock-run'),label=state.running?'Pause match clock':'Start match clock';
    let icon=button.querySelector('svg.ui-icon'),use=icon?.querySelector('use');
    if(!use){icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('class','ui-icon');icon.setAttribute('aria-hidden','true');use=document.createElementNS('http://www.w3.org/2000/svg','use');icon.append(use);button.replaceChildren(icon);}
    use.setAttribute('href',state.running?'#i-pause':'#i-play');button.setAttribute('aria-label',label);button.title=label;renderedRunning=state.running;
  }
  function tick(force=false,reason='tick',id=null){
    const value=Math.floor(seconds());
    if(state.running&&value>=MAX_SECONDS){state.base=MAX_SECONDS;state.anchor=Date.now();state.running=false;save();force=true;reason='limit';}
    if(!force&&value===lastSecond)return;lastSecond=value;
    $('clock-display').textContent=fmt(value);renderRunControl();
    if($('clock-state')){$('clock-state').textContent=state.running?'Running':'Paused';$('clock-state').dataset.running=String(state.running);$('clock-state').title=value>=MAX_SECONDS?'120-minute clock limit. Sync or start a new match.':'Manual reference — sync with the in-game match clock.';}
    const r=recommendations();$('attack-now-title').textContent=r.nowTitle;$('attack-now-note').textContent=r.nowNote;$('attack-next-title').textContent=r.nextTitle;$('attack-next-note').textContent=r.nextNote;if($('attack-wait-note'))$('attack-wait-note').textContent=r.waitNote;
    if(atlas?.setMatchSeconds)atlas.setMatchSeconds(value);emit(reason,id);
  }
  function openCustom(p){if(!p)return;pendingTarget=p;const loot=['crate','tough','buffContainer'].includes(p.type);$('return-timer-description').textContent=loot?'Confirm this object’s area, then enter its return duration: surface loot usually takes 3 minutes; tunnel loot takes 5. Start immediately after breaking this object and collect its drop.':'Enter this location’s confirmed return duration. Start immediately after clearing the entire linked camp, or enter the remaining time shown in-game.';$('return-minutes').value='';$('return-minutes').placeholder=loot?'3 or 5':'Minutes';$('return-seconds').value='0';$('return-minutes').setCustomValidity('');if(!$('return-timer-dialog').open)$('return-timer-dialog').showModal();}
  function pendingSeconds(){const value=Number($('clock-minutes-input').value)*60+Number($('clock-seconds-input').value);return Number.isFinite(value)?Math.max(0,Math.min(MAX_SECONDS,value)):null;}
  function writePendingTime(value){const s=Math.floor(Math.max(0,Math.min(MAX_SECONDS,value)));$('clock-minutes-input').value=Math.floor(s/60);$('clock-seconds-input').value=s%60;}
  function adjustPendingTime(delta){const value=pendingSeconds();if(value!==null)writePendingTime(value+delta);}
  window.matchClock={seconds,format:fmt,setTime,toggle,reset,record,undo,describe,ruleFor,recommendations,openCustom,getRecords:()=>Object.fromEntries(Object.entries(state.records).map(([id,r])=>[id,{...r}])),getPlan:()=>plan};
  $('clock-run').addEventListener('click',toggle);$('clock-minus').addEventListener('click',()=>adjustPendingTime(-60));$('clock-plus').addEventListener('click',()=>adjustPendingTime(60));
  $('clock-edit').addEventListener('click',()=>{writePendingTime(seconds());if(!$('clock-sync-dialog').open)$('clock-sync-dialog').showModal();});
  $('clock-sync-form').addEventListener('submit',e=>{e.preventDefault();const value=pendingSeconds();if(value!==null&&setTime(value))$('clock-sync-dialog').close();});
  $('clock-dialog-cancel').addEventListener('click',()=>$('clock-sync-dialog').close());$('clock-new-match').addEventListener('click',()=>{reset();$('clock-sync-dialog').close();});
  $('return-timer-cancel').addEventListener('click',()=>{pendingTarget=null;$('return-timer-dialog').close();});$('return-minutes').addEventListener('input',()=>$('return-minutes').setCustomValidity(''));$('return-seconds').addEventListener('input',()=>$('return-minutes').setCustomValidity(''));$('return-timer-form').addEventListener('submit',e=>{e.preventDefault();const duration=Number($('return-minutes').value)*60+Number($('return-seconds').value);if(!pendingTarget||!Number.isFinite(duration)||duration<=0){$('return-minutes').setCustomValidity('Enter a positive return duration.');$('return-minutes').reportValidity();return;}if(record(pendingTarget.id,duration,'custom')){pendingTarget=null;$('return-timer-dialog').close();}});
  for(const which of ['now','next'])$(`attack-${which}`).addEventListener('click',e=>{e.preventDefault();if($('clock-sync-dialog').open)$('clock-sync-dialog').close();window.dispatchEvent(new CustomEvent('match:focus',{detail:{types:recommendations()[`${which}Focus`]}}));});
  addEventListener('atlas:ready',e=>{atlas=e.detail;tick(true,'ready');});addEventListener('atlas:clock-set',e=>setTime(e.detail.seconds));
  function adoptSaved(raw){try{const incoming=JSON.parse(raw||'null');if(!incoming||!finite(incoming.base)||incoming.base<0||!finite(incoming.anchor))return false;state.base=Math.min(MAX_SECONDS,incoming.base+(incoming.running?Math.max(0,(Date.now()-incoming.anchor)/1000):0));state.anchor=Date.now();state.running=!!incoming.running&&state.base<MAX_SECONDS;state.records=cleanRecords(incoming.records);tick(true,'storage');return true;}catch{return false;}}
  // User actions already persist an anchored clock. Passive tabs must never overwrite it.
  addEventListener('storage',e=>{if(e.key===KEY)adoptSaved(e.newValue);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){let adopted=false;try{adopted=adoptSaved(localStorage.getItem(KEY));}catch{}if(!adopted)tick(true,'resume');}});
  const measure=()=>{const header=document.querySelector('.app-header'),hud=document.querySelector('.match-hud');const regions=[header,hud].filter(element=>element&&!element.closest('dialog')&&element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden');const height=regions.filter(element=>!regions.some(other=>other!==element&&other.contains(element))).reduce((sum,element)=>sum+element.getBoundingClientRect().height,0);document.documentElement.style.setProperty('--top-ui-height',`${height}px`);};if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(measure);for(const selector of ['.app-header','.match-hud']){const element=document.querySelector(selector);if(element)observer.observe(element);}}addEventListener('resize',measure);measure();
  fetch('assets/attack-data.json').then(r=>{if(!r.ok)throw new Error('Attack timing data unavailable');return r.json();}).then(d=>{if(!Array.isArray(d.resourceRules)||!Array.isArray(d.eventRules)||!Array.isArray(d.structureRules)||!Array.isArray(d.localOverrides?.entries))throw new Error('Attack timing data is incomplete');plan=d;tick(true,'rules');}).catch(e=>{dataError=true;console.error(e);tick(true,'rules-error');});
  setInterval(()=>tick(),500);tick(true,'initial');
})();
