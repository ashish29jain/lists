/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
const pad=n=>String(n).padStart(2,'0');
const dkey=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey=k=>{const [y,m,d]=k.slice(0,10).split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(d,n)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x};
const daysBetween=(a,b)=>Math.round((parseKey(b)-parseKey(a))/864e5);
const weekStart=d=>addDays(d,-((d.getDay()+6)%7));
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const nowAt=()=>{const d=new Date();return dkey(d)+'T'+pad(d.getHours())+':'+pad(d.getMinutes())};
const time12=hm=>{let [h,m]=hm.split(':').map(Number);const ap=h>=12?'pm':'am';h=h%12||12;return `${h}:${pad(m)} ${ap}`};
const ms=(n,cls='')=>`<span class="ms ${cls}" aria-hidden="true">${n}</span>`;
const pill=(c,t)=>`<span class="pill ${c}">${esc(t)}</span>`;
function niceDay(k){const d=daysBetween(k,dkey());if(d===0)return 'Today';if(d===1)return 'Yesterday';const x=parseKey(k);return `${WD[x.getDay()]}, ${x.getDate()} ${MON[x.getMonth()]}`}
function period(reset,d=new Date()){return reset==='daily'?dkey(d):reset==='weekly'?dkey(weekStart(d)):reset==='monthly'?dkey(d).slice(0,7):'all'}
function reorderSubset(arr,ids){const set=new Set(ids);const pos=[];const by={};arr.forEach((x,i)=>{if(set.has(x.id)){pos.push(i);by[x.id]=x}});if(pos.length!==ids.length)return;ids.forEach((id,j)=>arr[pos[j]]=by[id])}
const lc=s=>String(s||'').trim().toLowerCase();

const TYPES={
  checklist:{label:'Checklist',icon:'checklist',desc:'To-dos and chores. Can reset every day or week.',ph:'Daily chores'},
  shopping:{label:'Shopping list',icon:'shopping_cart',desc:'Grouped by aisle, with quantities and usual buys.',ph:'Groceries to order'},
  trips:{label:'Trip packing',icon:'luggage',desc:'Master templates and a fresh checklist for each trip.',ph:'Trips'},
  rotation:{label:'Rotation list',icon:'restaurant',desc:'Options to cycle through, with a log of what was made.',ph:'Food options'},
  habits:{label:'Habit tracker',icon:'self_improvement',desc:'Daily or weekly habits with streaks.',ph:'New habits'},
  reference:{label:'Reference list',icon:'bookmark',desc:'Things to keep handy, with nothing to tick.',ph:'Movies to watch'},
  log:{label:'Log',icon:'edit_note',desc:'A dated diary: medicines, expenses, anything.',ph:'Medicine log'},
  notes:{label:'Notes',icon:'sticky_note_2',desc:'Notes by subject, each saved with the date and time.',ph:'Notes'}
};
const COLORS=['teal','amber','berry','blue','olive','plum'];
const ICONS=['checklist','home','cleaning_services','shopping_cart','grocery','luggage','flight','restaurant','skillet','self_improvement','fitness_center','water_drop','movie','menu_book','bookmark','card_giftcard','medication','savings','local_florist','pets','child_care','school','favorite','star','edit_note','sticky_note_2','lightbulb','folder','celebration'];
const DEFAULT_CATS=['Vegetables','Fruits','Dairy','Staples','Snacks','Household','Other'];
const DEFAULT_SECTIONS=['Clothes','Toiletries','Documents','Electronics','Medicines','Other'];
const DEFAULT_MEALS=['Breakfast','Lunch','Snack','Dinner'];

/* ---------- state + storage ---------- */
const S={lists:{},order:[],ready:false,route:{v:'home'},stack:[],homeQ:'',refQ:'',refTag:'',roTag:'',roSort:'mine',habWeek:0,habOpen:{},logLimit:21,recent:{},homeTab:(()=>{try{return localStorage.getItem('home-tab')||'lists'}catch(e){return 'lists'}})(),sheet:null,dirty:false,refocus:null,mode:'db'};
/* Storage: this person's own Google Sheet, through their own Apps Script web app.
   The connection (web app URL + key) is saved on this phone only, so one copy of the app
   can serve any number of people, each with a separate sheet. A copy of the lists is kept
   on the phone too, so the app opens instantly and works offline. */
const APP_VERSION='v1'; // keep in step with VERSION in sw.js
const LKEY='everyday-lists-cache-v1',CKEY='everyday-lists-connection-v1';
const store={get(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
S.conn=store.get(CKEY);
async function API(action,payload,conn=S.conn){
  if(!conn||!conn.url)throw new Error('This phone is not connected to a sheet.');
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),60000); // Apps Script can be slow to start
  try{
    const res=await fetch(conn.url,{method:'POST',signal:ctl.signal,redirect:'follow',body:new URLSearchParams({key:conn.key||'',action,payload:JSON.stringify(payload||{})})});
    if(!res.ok)throw new Error('The sheet answered with error '+res.status+'.');
    let j;try{j=await res.json()}catch(e){throw new Error('That address did not answer like an Everyday Lists web app. Check that it ends in /exec and that access is set to Anyone.')}
    if(!j.ok)throw new Error(j.error||'The sheet refused the request.');
    return j;
  }catch(e){if(e.name==='AbortError')throw new Error('The sheet took too long to answer.');if(e instanceof TypeError)throw new Error(navigator.onLine?"Couldn't reach the sheet. Check the web app address.":'No internet connection.');throw e}
  finally{clearTimeout(t)}
}
const dirty=new Set();let pumping=false,pumpT=null,saveSeq=0;
function cache(){store.set(LKEY,{url:S.conn&&S.conn.url,lists:S.lists,order:S.order,dirty:[...dirty],sheetUrl:S.sheetUrl||''})}
function loadCache(){const v=store.get(LKEY);if(v&&v.lists&&S.conn&&v.url===S.conn.url){S.lists=v.lists;S.order=v.order||[];(v.dirty||[]).forEach(k=>dirty.add(k));S.sheetUrl=v.sheetUrl||'';return true}return false}
function syncLabel(){const n=dirty.size;return ({ok:`${ms('cloud_done')} Saved to ${esc((S.conn&&S.conn.name)||'your Google Sheet')}`,saving:`${ms('sync')} Saving…`,
  error:`${ms('cloud_off')} ${navigator.onLine?"Can't reach the sheet":'Offline'}.${n?` ${n} change${n===1?'':'s'} waiting on this phone.`:''} Tap for details.`,loading:`${ms('sync')} Checking the sheet for changes…`})[S.sync]||''}
function setSync(s){S.sync=s;const el=document.getElementById('sync');if(el)el.innerHTML=syncLabel()}
function markDirty(k){dirty.add(k);cache();setSync('saving');clearTimeout(pumpT);pumpT=setTimeout(pump,700)}
function save(id){markDirty('list:'+id)}
function saveMeta(){markDirty('order')}
function wire(l){const c=JSON.parse(JSON.stringify(l));if(c.type==='checklist')c.items.forEach((i,n)=>{i._doneNow=clDone(l,l.items[n])});return JSON.stringify(c)}
function normalize(d){Object.values(d.lists).forEach(l=>{if(l.type!=='checklist')return;const p=period(l.reset);
  l.items.forEach(i=>{if(i._done===true&&!i.doneIn)i.doneIn=p;else if(i._done===false&&i.doneIn===p)i.doneIn=null;delete i._done})})}
async function pump(){
  if(pumping||!S.conn)return;pumping=true;
  while(dirty.size){const k=dirty.values().next().value;dirty.delete(k);
    try{if(k==='order')await API('saveOrder',{json:JSON.stringify(S.order)});
      else{const id=k.slice(5);const l=S.lists[id];if(l)await API('saveList',{json:wire(l)});else await API('deleteList',{id})}
      saveSeq++;S.lastError='';cache()}
    catch(e){dirty.add(k);cache();pumping=false;S.lastError=e.message;setSync('error');clearTimeout(pumpT);pumpT=setTimeout(pump,15000);return}}
  pumping=false;setSync('ok');cache()
}
async function refresh(){
  if(!S.conn||dirty.size||pumping)return;const seq=saveSeq;let d;
  try{d=(await API('getAll')).data;if(typeof d==='string')d=JSON.parse(d)}
  catch(e){S.lastError=e.message;if(!S.ready){S.loadError=e.message;render()}else setSync('error');return}
  if(dirty.size||pumping||seq!==saveSeq)return;
  normalize(d);S.sheetUrl=d.sheetUrl;let changed=!S.ready;
  Object.keys(d.lists).forEach(id=>{if(JSON.stringify(S.lists[id])!==JSON.stringify(d.lists[id])){S.lists[id]=d.lists[id];changed=true}});
  Object.keys(S.lists).forEach(id=>{if(!d.lists[id]){delete S.lists[id];changed=true}});
  if(JSON.stringify(S.order)!==JSON.stringify(d.order)){S.order=d.order;changed=true}
  S.ready=true;S.loadError='';S.lastError='';setSync('ok');cache();if(changed)softRender()
}

/* ---------- connecting this phone to a sheet ---------- */
const b64u={enc:s=>btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),dec:s=>decodeURIComponent(escape(atob(s.replace(/-/g,'+').replace(/_/g,'/'))))};
function setupLink(){return location.origin+location.pathname+'#connect='+b64u.enc(JSON.stringify({u:S.conn.url,k:S.conn.key}))}
async function connectTo(url,key){
  url=String(url||'').trim();key=String(key||'').trim();
  if(!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)&&!/^\/api\/\w+$/.test(url)/* local test server */)throw new Error('Paste the Web app URL from Apps Script. It starts with https://script.google.com and ends in /exec.');
  if(!key)throw new Error('Paste the key from the setup log.');
  const conn={url,key};const j=await API('ping',{},conn);conn.name=j.name||'your Google Sheet';
  if(!S.conn||S.conn.url!==url){S.lists={};S.order=[];dirty.clear();S.sheetUrl='';store.del(LKEY)}
  S.conn=conn;store.set(CKEY,conn);S.sheetUrl=j.sheetUrl||'';S.ready=false;S.loadError='';S.route={v:'home'};S.stack=[];
  S.sync='loading';render();await refresh();return conn
}
function vConnect(){
  return `<div class="empty" style="padding-bottom:8px"><span class="lic t-teal" style="width:56px;height:56px;border-radius:16px">${ms('checklist')}</span><h2>Connect your Google Sheet</h2>
  <p>Your lists are saved in your own Google Sheet. Open your personal setup link on this phone, or paste the two values from the setup log.</p></div>
  <form class="stack" data-form="connect" style="gap:14px">${fld('Web app URL','<input class="in" name="u" id="conn-u" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off" spellcheck="false">')}
  ${fld('Key','<input class="in" name="k" id="conn-k" autocomplete="off" autocapitalize="off" spellcheck="false">')}
  <p class="hint" id="conn-err" role="alert" style="color:var(--bad-fg);margin:0"></p>
  <button class="btn primary block" id="conn-btn">Connect</button></form>
  <p class="note">The setup guide (SETUP.md) shows where to find these.</p>`
}
function sheetAppSettings(){
  const n=dirty.size;
  openSheet(`${sheetHead('Settings')}
  <div class="fld"><span>Connected to</span><div style="font-weight:600">${esc(S.conn.name||'Google Sheet')}</div>${S.sheetUrl?`<a class="lnk" style="padding:0" href="${esc(S.sheetUrl)}" target="_blank" rel="noopener">${ms('table_view')} Open the Google Sheet</a>`:''}</div>
  <div class="fld"><span>Status</span><div>${syncLabel().replace(' Tap for details.','')}</div>${S.lastError?`<small class="hint" style="color:var(--bad-fg)">${esc(S.lastError)}</small>`:''}</div>
  <div class="btns"><button class="btn" data-act="sync-now">${ms('sync')}Sync now</button></div>
  <div class="fld"><span>Use these lists on another phone or laptop</span><small class="hint">Send this link to your own other devices. Anyone with the link can open these lists, so don't share it with other people. They get their own sheet.</small><button class="btn block" data-act="copy-setup">${ms('link')}Copy my setup link</button></div>
  <div class="danger-zone" id="dz"><button class="btn danger block" data-act="disconnect-ask">${ms('logout')}Disconnect this phone</button><small class="hint">Your lists stay in the Google Sheet.${n?` ${n} change${n===1?' has':'s have'} not been saved to it yet.`:''}</small></div>
  <p class="note">Everyday Lists ${APP_VERSION}</p>`)
}
function orderedLists(){const seen=new Set();const out=[];S.order.forEach(id=>{if(S.lists[id]&&!seen.has(id)){seen.add(id);out.push(S.lists[id])}});
  Object.values(S.lists).filter(l=>!seen.has(l.id)).sort((a,b)=>(a.created||0)-(b.created||0)).forEach(l=>out.push(l));return out}
const L=()=>S.lists[S.route.id];

/* ---------- toast ---------- */
let toastT=null;
function toast(msg,undo){const t=$('#toast');t.innerHTML=`<span>${esc(msg)}</span>${undo?'<button type="button" id="undo">Undo</button>':''}`;t.hidden=false;clearTimeout(toastT);
  if(undo)$('#undo').onclick=()=>{t.hidden=true;undo()};toastT=setTimeout(()=>t.hidden=true,undo?6000:3000)}
function withUndo(id,msg,fn){const before=JSON.stringify(S.lists[id]);fn();save(id);render();toast(msg,()=>{S.lists[id]=JSON.parse(before);save(id);render()})}

/* ---------- routing ---------- */
function go(r){S.stack.push(S.route);S.route=r;window.scrollTo(0,0);render()}
function back(){S.route=S.stack.pop()||{v:'home'};render()}

/* ---------- sheet ---------- */
function openSheet(html,focusSel){$('#panel').innerHTML='<div class="grab"></div>'+html;$('#sheet').hidden=false;document.body.style.overflow='hidden';syncRemindUI();
  setTimeout(()=>{const f=focusSel&&$('#panel '+focusSel);if(f)f.focus()},60)}
function closeSheet(){$('#sheet').hidden=true;$('#panel').innerHTML='';document.body.style.overflow='';S.sheet=null}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#sheet').hidden)closeSheet()});
const fld=(label,inner,hint)=>`<label class="fld"><span>${label}</span>${inner}${hint?`<small class="hint">${hint}</small>`:''}</label>`;
const sheetHead=t=>`<h2>${esc(t)}<button type="button" class="ib" data-act="close-sheet" aria-label="Close">${ms('close')}</button></h2>`;
const opts=(arr,sel)=>arr.map(x=>`<option ${x===sel?'selected':''}>${esc(x)}</option>`).join('');

/* ---------- summaries ---------- */
function summary(l){
  const today=new Date();
  switch(l.type){
    case 'checklist':{const act=l.items.filter(i=>clActive(i,today));const d=act.filter(i=>clDone(l,i)).length;const r={daily:'Resets daily',weekly:'Resets weekly',monthly:'Resets monthly'}[l.reset];return `${r?r+' · ':''}${d} of ${act.length} done`}
    case 'shopping':{const n=l.items.filter(i=>!i.done).length;return `${n} to buy`}
    case 'trips':{const a=l.trips.filter(t=>!t.past);if(a.length){const t=a[0];const d=t.items.filter(i=>i.done).length;return `${t.name} · ${d} of ${t.items.length} packed`}return `${l.templates.length} template${l.templates.length===1?'':'s'}`}
    case 'rotation':{const e=[...(l.log||[])].sort((a,b)=>b.at.localeCompare(a.at))[0];return e?`Last: ${logText(l,e)} · ${niceDay(e.at)}`:`${l.items.length} options`}
    case 'habits':{const k=dkey();const d=l.habits.filter(h=>h.log.includes(k)).length;return `${d} of ${l.habits.length} done today`}
    case 'reference':return `${l.items.length} item${l.items.length===1?'':'s'}`;
    case 'notes':{const n=(l.notes||[]).length;return `${l.subjects.length} subject${l.subjects.length===1?'':'s'} · ${n} note${n===1?'':'s'}`}
    case 'log':{const e=[...l.log].sort((a,b)=>b.at.localeCompare(a.at))[0];return e?`Last: ${logText(l,e)}`:'No entries yet'}
  }return ''
}

/* ---------- render ---------- */
function render(){
  const r=S.route;
  if(r.v!=='home'&&(!S.conn||!L())){S.route={v:'home'};S.stack=[]}
  if(S.route.v==='trip'&&!L().trips.find(t=>t.id===S.route.tid)){S.route={v:'list',id:S.route.id}}
  if(S.route.v==='tpl'&&!L().templates.find(t=>t.id===S.route.tid)){S.route={v:'list',id:S.route.id}}
  if(S.route.v==='subj'&&!(L().subjects||[]).find(x=>x.id===S.route.tid)){S.route={v:'list',id:S.route.id}}
  $('#top').innerHTML=header();$('#view').innerHTML=view();
  document.querySelector('.app').classList.toggle('chat',S.route.v==='subj'||(S.route.v==='list'&&L()&&L().type==='notes'));
  if(S.refocus){const f=document.getElementById(S.refocus);if(f)f.focus();S.refocus=null}
  if(S.scrollBottom){S.scrollBottom=false;requestAnimationFrame(()=>window.scrollTo(0,document.documentElement.scrollHeight))}
  if(S.focusHandle){const f=document.querySelector(S.focusHandle);if(f)f.focus();S.focusHandle=null}
}
function softRender(){const a=document.activeElement;if(drag||(a&&a.closest&&a.closest('#view')&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))){S.dirty=true;return}render()}
document.addEventListener('focusout',()=>setTimeout(()=>{if(S.dirty&&!drag){S.dirty=false;softRender()}},50));

function header(){
  const r=S.route;
  if(!S.conn)return `<div class="home-h" style="flex:1;min-width:0"><small>Welcome</small><h1>Everyday Lists</h1></div>`;
  if(r.v==='home'){const d=new Date();return `<div class="home-h" style="flex:1;min-width:0"><small>${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}</small><h1>Your lists</h1></div><button class="ib" data-act="app-settings" aria-label="Settings">${ms('settings')}</button><button class="ib solid" data-act="new-list" aria-label="New list">${ms('add')}</button>`}
  const l=L();let title=l.name,menu='menu';
  if(r.v==='trip'){title=l.trips.find(t=>t.id===r.tid).name;menu='trip-menu'}
  if(r.v==='tpl'){title=l.templates.find(t=>t.id===r.tid).name;menu='tpl-menu'}
  if(r.v==='subj'){title=l.subjects.find(t=>t.id===r.tid).name;menu='subj-menu'}
  return `<button class="ib" data-act="back" aria-label="Back">${ms('arrow_back')}</button><h1>${esc(title)}</h1><button class="ib" data-act="${menu}" aria-label="Options">${ms('more_horiz')}</button>`
}
function view(){
  const r=S.route;if(!S.conn)return vConnect();if(r.v==='home')return vHome();
  const l=L();if(r.v==='trip')return vTrip(l,l.trips.find(t=>t.id===r.tid));if(r.v==='tpl')return vTpl(l,l.templates.find(t=>t.id===r.tid));if(r.v==='subj')return vSubject(l,l.subjects.find(s=>s.id===r.tid));
  return ({checklist:vChecklist,shopping:vShopping,trips:vTrips,rotation:vRotation,habits:vHabits,reference:vReference,log:vLogList,notes:vNotes})[l.type](l)
}
const handle=label=>`<button type="button" class="handle" data-handle aria-label="Reorder ${esc(label)}. Use arrow keys to move.">${ms('drag_indicator')}</button>`;
const addForm=(form,ph,extra='')=>`<form class="add" data-form="${form}"><input id="add-${form}" name="t" class="in" placeholder="${esc(ph)}" autocomplete="off" enterkeyhint="done" aria-label="${esc(ph)}">${extra}<button class="btn primary sq" aria-label="Add">${ms('add')}</button></form>`;

/* ---------- done items: stay struck for 5 seconds, then move to the Done tab ---------- */
const LEAVE_MS=5000;
function markRecent(id){S.recent[id]=Date.now();setTimeout(()=>{if(S.recent[id]&&Date.now()-S.recent[id]>=LEAVE_MS-50){delete S.recent[id];softRender()}},LEAVE_MS)}
const isRecent=id=>!!S.recent[id];
const leaving=id=>isRecent(id)?` leaving" style="animation-delay:-${Math.min(LEAVE_MS,Date.now()-S.recent[id])}ms`:'';
function doneTabs(a,na,b,nb){const done=S.route.tab==='done';return `<div class="seg" role="tablist"><button role="tab" aria-selected="${!done}" class="${!done?'on':''}" data-act="tab" data-tab="todo">${a} · ${na}</button><button role="tab" aria-selected="${done}" class="${done?'on':''}" data-act="tab" data-tab="done">${b} · ${nb}</button></div>`}
function doneRow(i,act,editAct,text,extra=''){return `<div class="row" data-id="${i.id}"><span style="width:10px"></span><button class="tick on" data-act="${act}" data-id="${i.id}" aria-pressed="true" aria-label="Untick ${esc(text)}">${ms('check')}</button><button class="rtxt" data-act="${editAct}" data-id="${i.id}"><span class="t struck">${esc(text)}</span></button>${extra}</div>`}
const doneEmpty=w=>`<div class="inline-note">${ms('task_alt')}Nothing ${w} yet. Ticked items move here 5 seconds after you tick them.</div>`;

/* ---------- home ---------- */
function vHome(){
  if(!S.ready&&S.loadError)return `<div class="empty"><h2>Can't reach the Google Sheet</h2><p>Check your internet connection and try again.</p><div class="btns"><button class="btn primary" data-act="retry">${ms('refresh')}Try again</button><button class="btn" data-act="app-settings">${ms('settings')}Settings</button></div><small class="hint">${esc(S.loadError)}</small></div>`;
  if(!S.ready)return `<div class="empty"><p>Loading your lists from the Google Sheet…</p></div>`;
  const lists=orderedLists();const tabsH=homeTabs();
  if(S.homeTab==='today')return tabsH+vToday();
  let h=tabsH+`<div class="search">${ms('search')}<input id="home-q" type="search" placeholder="Search all lists" aria-label="Search all lists" data-input="home-q" value="${esc(S.homeQ)}" autocomplete="off"></div><div id="home-results">${homeResults()}</div>`;
  if(!lists.length)h+=`<div class="empty"><h2>Start your first list</h2><p>Make a checklist, a shopping list, a trip, a food rotation, habits or a list of things to keep handy.</p><button class="btn primary" data-act="new-list">${ms('add')}New list</button></div>`;
  else h+=`<div id="home-lists" ${S.homeQ?'hidden':''} class="stack"><div class="card" data-arr="lists">${lists.map(l=>`<div class="row" data-id="${l.id}">${handle(l.name)}<button class="lmain" data-act="open" data-id="${l.id}"><span class="lic t-${l.color||'teal'}">${ms(l.icon||TYPES[l.type].icon)}</span><span class="ltxt"><span class="lname">${esc(l.name)}</span><span class="lsum">${esc(summary(l))}</span></span>${ms('chevron_right','chev')}</button></div>`).join('')}</div>
  <p class="note">Drag ${ms('drag_indicator')} to put the most important lists at the top.</p></div>`;
  h+=`<button class="note sync" id="sync" data-act="app-settings" style="border:0;background:none;width:100%;cursor:pointer">${syncLabel()}</button>`;
  return h
}
function homeResults(){
  const q=lc(S.homeQ);if(!q)return '';const out=[];
  const hit=(t,l,sub,extra='')=>{if(lc(t).includes(q))out.push(`<button data-act="open" data-id="${l.id}" ${extra}><span>${esc(t)}</span><small>${esc(l.name)}${sub?' · '+esc(sub):''}</small></button>`)};
  orderedLists().forEach(l=>{
    hit(l.name,l,TYPES[l.type].label);
    (l.items||[]).forEach(i=>hit(i.text||i.name,l));
    (l.habits||[]).forEach(h=>hit(h.name,l));
    (l.trips||[]).forEach(t=>{hit(t.name,l,'Trip',`data-trip="${t.id}"`);t.items.forEach(i=>hit(i.text,l,t.name,`data-trip="${t.id}"`))});
    (l.templates||[]).forEach(t=>t.items.forEach(i=>hit(i.text,l,t.name,`data-tpl="${t.id}"`)));
    (l.log||[]).forEach(e=>hit(logText(l,e),l,niceDay(e.at)));
    (l.subjects||[]).forEach(s=>hit(s.name,l,'Subject',`data-subj="${s.id}"`));
    (l.notes||[]).forEach(n=>{if(lc(n.text).includes(q)){const s=(l.subjects||[]).find(x=>x.id===n.subj);out.push(`<button data-act="open" data-id="${l.id}" data-subj="${n.subj}"><span>${esc(snip(n.text))}</span><small>${esc(l.name)}${s?' · '+esc(s.name):''} · ${niceDay(n.at)}</small></button>`)}});
  });
  if(!out.length)return `<p class="note">Nothing matches “${esc(S.homeQ)}”.</p>`;
  return `<div class="card res">${out.slice(0,40).join('')}</div>`
}

/* ---------- checklist ---------- */
function clActive(it,d=new Date()){return !it.days||!it.days.length||it.days.includes(d.getDay())}
function clDone(l,it){return it.doneIn===period(l.reset)}
function daysLabel(days){if(!days||!days.length||days.length===7)return '';const o=[1,2,3,4,5,6,0].filter(d=>days.includes(d));if(o.length===1)return WD[o[0]]+'s';return o.map(d=>WD[d]).join(', ')}
function duePill(k){const d=daysBetween(dkey(),k);if(d<0)return pill('bad','Overdue');if(d===0)return pill('warn','Due today');if(d===1)return pill('','Due tomorrow');const x=parseKey(k);return pill('',`Due ${x.getDate()} ${MON[x.getMonth()]}`)}
function clRow(l,i,off){const done=clDone(l,i);const dl=daysLabel(i.days);const meta=[dl?pill('acc',dl):'',!done?remindBadge(i):''].join('');
  return `<div class="row${off?' dim':''}${done?leaving(i.id):''}" data-id="${i.id}">${handle(i.text)}<button class="tick ${done?'on':''}" data-act="cl-tog" data-id="${i.id}" aria-pressed="${done}" aria-label="${esc(i.text)}">${ms('check')}</button><button class="rtxt" data-act="cl-edit" data-id="${i.id}"><span class="t ${done?'struck':''}">${esc(i.text)}</span>${meta?`<span class="meta">${meta}</span>`:''}</button></div>`}
function vChecklist(l){
  const now=new Date();const act=l.items.filter(i=>clActive(i,now));const doneAll=l.items.filter(i=>clDone(l,i));const doneAct=act.filter(i=>clDone(l,i));
  const show=i=>!clDone(l,i)||isRecent(i.id);
  const todo=act.filter(show);const off=l.items.filter(i=>!clActive(i,now)&&show(i));
  const left=act.filter(i=>!clDone(l,i)).length;
  const pct=act.length?Math.round(doneAct.length/act.length*100):0;
  const rl={daily:'Unticks every night',weekly:'Unticks every Monday',monthly:'Unticks on the 1st',never:'Stays ticked until you clear it'}[l.reset||'never'];
  let h=doneTabs('To do',left,'Done',doneAll.length);
  if(S.route.tab==='done'){
    const pl={daily:' today',weekly:' this week',monthly:' this month'}[l.reset]||'';
    if(doneAll.length)h+=`<div class="sec-h"><span>Ticked${pl}</span><span>${doneAll.length}</span></div><div class="card">${doneAll.map(i=>doneRow(i,'cl-tog','cl-edit',i.text)).join('')}</div><div class="btns"><button class="btn" data-act="cl-untick">${ms('restart_alt')}Untick all</button>${l.reset==='never'?`<button class="btn" data-act="cl-clear">${ms('delete_sweep')}Remove ticked</button>`:''}</div>`;
    else h+=doneEmpty('ticked'+pl);
    const days=[];for(let n=0;n<30;n++){const k=dkey(addDays(now,-n));const its=l.items.filter(i=>(i.log||[]).includes(k));if(its.length)days.push([k,its])}
    if(days.length){h+=`<div class="sec-h"><span>History · last 30 days</span></div>`;
      days.forEach(([k,its])=>{h+=`<div class="logday"><div class="sec-h" style="margin:0 4px"><span>${niceDay(k)}</span><span>${its.length} done</span></div><div class="card">${its.map(i=>`<div class="row"><span class="ms" aria-hidden="true" style="color:var(--accent);margin-left:8px;font-size:20px">check_circle</span><span class="rtxt"><span class="t">${esc(i.text)}</span></span></div>`).join('')}</div></div>`})}
    return h}
  h+=`<div class="prog"><div class="bar"><i style="width:${pct}%"></i></div><div class="ptxt">${doneAct.length} of ${act.length} done · ${rl}</div></div>`;
  h+=addForm('cl-add','Add an item');
  h+=`<div class="card" data-arr="items">${todo.map(i=>clRow(l,i)).join('')}</div>`;
  if(!todo.length&&act.length)h+=`<div class="inline-note">${ms('celebration')}All done${l.reset==='daily'?' for today':''}.</div>`;
  if(off.length)h+=`<div class="sec-h"><span>Not today</span></div><div class="card" data-arr="items">${off.map(i=>clRow(l,i,true)).join('')}</div>`;
  return h
}

/* ---------- shopping ---------- */
function shRow(i){return `<div class="row" data-id="${i.id}">${handle(i.text)}<button class="tick ${i.done?'on':''}" data-act="sh-tog" data-id="${i.id}" aria-pressed="${!!i.done}" aria-label="${esc(i.text)}">${ms('check')}</button><button class="rtxt" data-act="sh-edit" data-id="${i.id}"><span class="t ${i.done?'struck':''}">${esc(i.text)}</span>${!i.done&&getRemind(i)?`<span class="meta">${remindBadge(i)}</span>`:''}</button></div>`}
/* Ticked groceries stay on the list (struck) for the rest of the day, then move to "Previously ordered". */
const shPrev=i=>i.done&&(!i.doneOn||i.doneOn<dkey());
function shKnown(l,text){const t=lc(text);const prev=[...l.items].reverse().find(i=>i.done&&lc(i.text)===t);return prev||l.staples.find(s=>lc(s.text)===t)}
function vShopping(l){
  const today=dkey();const show=l.items.filter(i=>!i.done||i.doneOn===today),prev=l.items.filter(shPrev);const left=l.items.filter(i=>!i.done).length;
  const pending=new Set(l.items.filter(i=>!i.done).map(i=>lc(i.text)));
  let h=doneTabs('To buy',left,'Previously ordered',prev.length);
  if(S.route.tab==='done'){
    if(!prev.length)return h+`<div class="inline-note">${ms('history')}Nothing here yet. Items you tick move here at the end of the day.</div>`;
    const groups=[];[...prev].sort((a,b)=>(b.doneOn||'').localeCompare(a.doneOn||'')).forEach(i=>{const k=i.doneOn||'';let g=groups[groups.length-1];if(!g||g.k!==k){g={k,items:[]};groups.push(g)}g.items.push(i)});
    groups.forEach(g=>{h+=`<div class="logday"><div class="sec-h" style="margin:0 4px"><span>${g.k?niceDay(g.k):'Earlier'}</span><span>${g.items.length} item${g.items.length===1?'':'s'}</span></div><div class="card">${g.items.map(i=>`<div class="row" data-id="${i.id}"><span style="width:10px"></span><button class="rtxt" data-act="sh-edit" data-id="${i.id}"><span class="t">${esc(i.text)}</span><span class="meta">${esc(i.cat||'Other')}</span></button>${pending.has(lc(i.text))?pill('acc','On the list'):`<button class="made" data-act="sh-again" data-id="${i.id}" aria-label="Order ${esc(i.text)} again">${ms('add')}Order again</button>`}</div>`).join('')}</div></div>`});
    return h}
  h+=`<form class="add" data-form="sh-add"><input id="add-sh-add" name="t" class="in" placeholder="Add an item" autocomplete="off" aria-label="Item name"><select name="c" class="sel" aria-label="Aisle">${opts(l.cats,S.lastCat&&l.cats.includes(S.lastCat)?S.lastCat:'Other')}</select><button class="btn primary sq" aria-label="Add">${ms('add')}</button></form>`;
  const cats=[...l.cats];show.forEach(i=>{if(!cats.includes(i.cat))cats.push(i.cat||'Other')});
  if(!show.length)h+=`<div class="inline-note">${ms('shopping_basket')}Nothing to buy. Add an item above or tap one to order again.</div>`;
  cats.forEach(c=>{const g=show.filter(i=>(i.cat||'Other')===c);if(g.length)h+=`<div class="sec-h"><span>${esc(c)}</span><span>${g.filter(i=>!i.done).length}</span></div><div class="card" data-arr="items">${g.map(shRow).join('')}</div>`});
  if(show.some(i=>i.done))h+=`<p class="note">Ticked items stay here until the end of the day, then move to Previously ordered.</p>`;
  const freq={};prev.forEach(i=>{const t=lc(i.text);freq[t]=(freq[t]||{n:0,text:i.text});freq[t].n++});l.staples.forEach(s=>{const t=lc(s.text);freq[t]=freq[t]||{n:0,text:s.text}});
  const chips=Object.entries(freq).filter(([t])=>!pending.has(t)).sort((a,b)=>b[1].n-a[1].n).slice(0,16).map(([,v])=>v.text);
  if(chips.length)h+=`<div class="sec-h"><span>Order again</span></div><div class="chips">${chips.map(t=>`<button class="chip btnlike" data-act="sh-staple" data-t="${esc(t)}">${ms('add')}${esc(t)}</button>`).join('')}</div>`;
  if(left)h+=`<div class="btns"><button class="btn" data-act="sh-copy">${ms('content_copy')}Copy list</button></div>`;
  return h
}
function shText(l){const todo=l.items.filter(i=>!i.done);const cats=[...l.cats];todo.forEach(i=>{if(!cats.includes(i.cat))cats.push(i.cat)});
  let t=l.name+'\n';cats.forEach(c=>{const g=todo.filter(i=>(i.cat||'Other')===c);if(g.length){t+=`\n${c}\n`+g.map(i=>`- ${i.text}`).join('\n')+'\n'}});return t.trim()}

/* ---------- trips ---------- */
function groupBySec(l,items,rowFn,key){const secs=[...l.sections];items.forEach(i=>{if(!secs.includes(i.sec))secs.push(i.sec||'Other')});
  return secs.map(s=>{const g=items.filter(i=>(i.sec||'Other')===s);return g.length?`<div class="sec-h"><span>${esc(s)}</span><span>${g.length}</span></div><div class="card" data-arr="${key}">${g.map(rowFn).join('')}</div>`:''}).join('')}
function vTrips(l){
  const act=l.trips.filter(t=>!t.past),past=l.trips.filter(t=>t.past);
  let h=`<button class="btn primary block" data-act="tr-new">${ms('add')}Start a new trip</button>`;
  h+=`<div class="sec-h"><span>Upcoming trips</span></div>`;
  h+=act.length?`<div class="card" data-arr="trips">${act.map(t=>{const d=t.items.filter(i=>i.done).length;const p=t.items.length?Math.round(d/t.items.length*100):0;
    return `<div class="row" data-id="${t.id}">${handle(t.name)}<button class="tripcard" data-act="tr-open" data-tid="${t.id}"><span class="t">${esc(t.name)}</span><span class="meta">${t.dates?esc(t.dates)+' · ':''}${d} of ${t.items.length} packed</span><span class="bar"><i style="width:${p}%"></i></span></button>${ms('chevron_right','chev')}</div>`}).join('')}</div>`:`<div class="inline-note">${ms('flight_takeoff')}No trips planned. Start one from a template.</div>`;
  h+=`<div class="sec-h"><span>Templates</span><button class="btn" style="height:32px;font-size:13px" data-act="tpl-new">${ms('add')}New</button></div>`;
  h+=l.templates.length?`<div class="card" data-arr="templates">${l.templates.map(t=>`<div class="row" data-id="${t.id}">${handle(t.name)}<button class="rtxt" data-act="tpl-open" data-tid="${t.id}"><span class="t">${esc(t.name)}</span><span class="meta">${t.items.length} items · master list</span></button>${ms('chevron_right','chev')}</div>`).join('')}</div>`:`<div class="inline-note">Make a template with the things you always pack.</div>`;
  if(past.length)h+=`<div class="sec-h"><span>Past trips</span></div><div class="card" data-arr="trips">${past.map(t=>`<div class="row" data-id="${t.id}">${handle(t.name)}<button class="rtxt" data-act="tr-open" data-tid="${t.id}"><span class="t">${esc(t.name)}</span><span class="meta">${t.dates?esc(t.dates)+' · ':''}${t.items.length} items</span></button>${ms('chevron_right','chev')}</div>`).join('')}</div>`;
  return h
}
function vTrip(l,t){
  const tpl=l.templates.find(x=>x.id===t.tplId);const d=t.items.filter(i=>i.done).length;const p=t.items.length?Math.round(d/t.items.length*100):0;
  let h=`<div class="prog"><div class="bar"><i style="width:${p}%"></i></div><div class="ptxt">${d} of ${t.items.length} packed${t.dates?' · '+esc(t.dates):''}${tpl?' · from '+esc(tpl.name):''}${t.past?' · past trip':''}</div></div>`;
  h+=`<form class="add" data-form="tr-add" style="flex-direction:column;align-items:stretch"><div class="add"><input id="add-tr-add" name="t" class="in" placeholder="Add an item" autocomplete="off" aria-label="Item name"><select name="s" class="sel" aria-label="Section">${opts(l.sections,S.lastSec&&l.sections.includes(S.lastSec)?S.lastSec:'Other')}</select><button class="btn primary sq" aria-label="Add">${ms('add')}</button></div>
  ${tpl?`<label class="check"><input type="checkbox" name="also"> Also add to “${esc(tpl.name)}” template</label><small class="hint">Left unticked, the item is only for this trip.</small>`:''}</form>`;
  if(t.items.length&&d===t.items.length)h+=`<div class="inline-note">${ms('celebration')}Everything is packed.</div>`;
  const row=i=>{const rec=isRecent(i.id);return `<div class="row${i.done?(rec?leaving(i.id):' dim'):''}" data-id="${i.id}">${handle(i.text)}<button class="tick ${i.done?'on':''}" data-act="tr-tog" data-id="${i.id}" aria-pressed="${!!i.done}" aria-label="${esc(i.text)}">${ms('check')}</button><button class="rtxt" data-act="tr-edit" data-id="${i.id}"><span class="t ${i.done?'struck':''}">${esc(i.text)}</span>${!i.done&&getRemind(i)?`<span class="meta">${remindBadge(i)}</span>`:''}</button>${i.only?pill('warn','This trip'):''}</div>`};
  // packed items sink to the bottom of their section 5 seconds after being ticked
  const ordered=[...t.items.filter(i=>!i.done||isRecent(i.id)),...t.items.filter(i=>i.done&&!isRecent(i.id))];
  h+=groupBySec(l,ordered,row,'trip:'+t.id)||`<div class="inline-note">This trip has no items yet.</div>`;
  return h
}
function vTpl(l,t){
  const row=i=>`<div class="row" data-id="${i.id}">${handle(i.text)}<button class="rtxt" data-act="tpl-edit" data-id="${i.id}"><span class="t">${esc(i.text)}</span></button></div>`;
  let h=`<p class="ptxt" style="margin:0 4px">The master list. Nothing here gets ticked. Each new trip starts as a copy of it.</p>`;
  h+=`<form class="add" data-form="tpl-add"><input id="add-tpl-add" name="t" class="in" placeholder="Add an item" autocomplete="off" aria-label="Item name"><select name="s" class="sel" aria-label="Section">${opts(l.sections,S.lastSec&&l.sections.includes(S.lastSec)?S.lastSec:'Other')}</select><button class="btn primary sq" aria-label="Add">${ms('add')}</button></form>`;
  h+=groupBySec(l,t.items,row,'tpl:'+t.id)||`<div class="inline-note">Add the things you always pack.</div>`;
  h+=`<button class="btn block" data-act="tr-new" data-tpl="${t.id}">${ms('luggage')}Start a trip from this template</button>`;
  return h
}

/* ---------- rotation + log ---------- */
function lastMadeMap(l){const m={};(l.log||[]).forEach(e=>{const k=e.at.slice(0,10);(e.dishIds||[]).forEach(id=>{if(!m[id]||k>m[id])m[id]=k})});return m}
function ago(l,k){if(!k)return {t:'Not made yet',c:'good',d:1e9};const d=daysBetween(k,dkey());const t=d<=0?'Today':d===1?'Yesterday':`${d} days ago`;const c=d<=1?'bad':d<(l.avoid||4)?'warn':'good';return {t,c,d}}
function roSuggest(l,tag){const m=lastMadeMap(l);return l.items.filter(i=>!tag||(i.tags||[]).includes(tag)).map(i=>({...i,a:ago(l,m[i.id])})).filter(i=>i.a.d>=(l.avoid||4)).sort((a,b)=>b.a.d-a.a.d).slice(0,3)}
function logText(l,e){const names=(e.dishIds||[]).map(id=>(l.items||[]).find(i=>i.id===id)).filter(Boolean).map(i=>i.name).filter(n=>!lc(e.text).includes(lc(n)));return [...names,e.text].filter(Boolean).join(', ')||'(empty)'}
function matchDishes(l,text){const t=lc(text);return (l.items||[]).filter(i=>i.name&&t.includes(lc(i.name))).map(i=>i.id)}
function mealFor(cats,d=new Date()){const h=d.getHours();if(cats.length===4)return cats[h<11?0:h<16?1:h<19?2:3];return cats[0]||''}
function vRotation(l){
  const tab=S.route.tab||'log';
  let h=`<div class="seg" role="tablist"><button role="tab" aria-selected="${tab==='log'}" class="${tab==='log'?'on':''}" data-act="ro-tab" data-tab="log">Log</button><button role="tab" aria-selected="${tab==='options'}" class="${tab==='options'?'on':''}" data-act="ro-tab" data-tab="options">Options</button></div>`;
  if(tab==='log')return h+vLog(l);
  h+=addForm('ro-add','Add an option');
  const tags=[...new Set(l.items.flatMap(i=>i.tags||[]))];const tag=tags.includes(S.roTag)?S.roTag:'';
  if(tags.length)h+=`<div class="chips" role="group" aria-label="Filter by tag"><button class="chip btnlike ${!tag?'on':''}" data-act="ro-tag" data-tag="">All</button>${tags.map(t=>`<button class="chip btnlike ${tag===t?'on':''}" data-act="ro-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
  const m=lastMadeMap(l);let items=l.items.filter(i=>!tag||(i.tags||[]).includes(tag)).map(i=>({i,a:ago(l,m[i.id])}));
  const mine=S.roSort==='mine';if(!mine)items.sort((x,y)=>y.a.d-x.a.d);
  h+=`<div class="sec-h"><span>${items.length} options</span><button class="btn" style="height:32px;font-size:13px" data-act="ro-sort">${ms('swap_vert')}${mine?'My order':'Longest ago first'}</button></div>`;
  h+=`<div class="card" data-arr="items">${items.map(({i,a})=>`<div class="row" data-id="${i.id}">${mine?handle(i.name):'<span style="width:8px"></span>'}<button class="rtxt" data-act="ro-edit" data-id="${i.id}"><span class="t">${esc(i.name)}</span><span class="meta">${pill(a.c,a.t)}${remindBadge(i)}${(i.tags||[]).map(t=>`<span>${esc(t)}</span>`).join(' · ')}</span></button><button class="made" data-act="ro-made" data-id="${i.id}" aria-label="Mark ${esc(i.name)} made today">${ms('check')}Made</button></div>`).join('')}</div>`;
  return h
}
function vLogList(l){return vLog(l)}
function vLog(l){
  const all=[...l.log].sort((a,b)=>b.at.localeCompare(a.at));
  let h=`<button class="btn primary block" data-act="log-new">${ms('add')}${l.type==='rotation'?'Log a meal':'Add entry'}</button>`;
  if(!all.length)return h+`<div class="inline-note">${ms('edit_note')}Nothing logged yet.</div>`;
  const days=[];all.forEach(e=>{const k=e.at.slice(0,10);let g=days[days.length-1];if(!g||g.k!==k){g={k,e:[]};days.push(g)}g.e.push(e)});
  days.slice(0,S.logLimit).forEach(g=>{h+=`<div class="logday"><div class="sec-h" style="margin-bottom:0"><span>${niceDay(g.k)}</span><span>${g.e.length}</span></div><div class="card">${g.e.map(e=>`<button class="lrow" data-act="log-edit" data-eid="${e.id}"><span class="tm">${time12(e.at.slice(11,16))}</span><span class="t">${esc(logText(l,e))}</span>${e.meal?pill('acc',e.meal):''}</button>`).join('')}</div></div>`});
  if(days.length>S.logLimit)h+=`<button class="btn block" data-act="log-more">Show older days</button>`;
  return h
}

/* ---------- habits ---------- */
function habStreak(h){const set=new Set(h.log);let n=0;
  if((h.target||7)>=7){let d=new Date();if(!set.has(dkey(d)))d=addDays(d,-1);while(set.has(dkey(d))&&n<2000){n++;d=addDays(d,-1)}return n?`${n}-day streak`:''}
  const cnt=w=>{let c=0;for(let i=0;i<7;i++)if(set.has(dkey(addDays(w,i))))c++;return c};let w=weekStart(new Date());if(cnt(w)>=h.target)n++;w=addDays(w,-7);while(cnt(w)>=h.target&&n<300){n++;w=addDays(w,-7)}return n?`${n}-week streak`:''}
function habTarget(t){return t>=7?'Every day':`${t} times a week`}
function vHabits(l){
  const today=new Date(),tk=dkey(today);const ws=addDays(weekStart(today),S.habWeek*7);const days=[...Array(7)].map((_,i)=>addDays(ws,i));
  const doneToday=l.habits.filter(h=>h.log.includes(tk)).length;
  let h=`<div class="prog"><div class="bar"><i style="width:${l.habits.length?Math.round(doneToday/l.habits.length*100):0}%"></i></div><div class="ptxt">${doneToday} of ${l.habits.length} done today</div></div>`;
  h+=`<form class="add" data-form="hb-add"><input id="add-hb-add" name="t" class="in" placeholder="Add a habit" autocomplete="off" aria-label="Habit name"><select name="g" class="sel" aria-label="How often">${[7,6,5,4,3,2,1].map(n=>`<option value="${n}">${n===7?'Every day':n+'× a week'}</option>`).join('')}</select><button class="btn primary sq" aria-label="Add">${ms('add')}</button></form>`;
  const wl=S.habWeek===0?'This week':S.habWeek===-1?'Last week':`${days[0].getDate()} ${MON[days[0].getMonth()]} – ${days[6].getDate()} ${MON[days[6].getMonth()]}`;
  h+=`<div class="hcard"><div class="weeknav"><button class="ib" data-act="hb-week" data-d="-1" aria-label="Previous week">${ms('chevron_left')}</button><span>${wl}</span><button class="ib" data-act="hb-week" data-d="1" aria-label="Next week" ${S.habWeek>=0?'disabled style="opacity:.3"':''}>${ms('chevron_right')}</button></div>
  <div class="hhead"><span></span><span></span>${days.map(d=>`<span class="hd ${dkey(d)===tk?'today':''}">${WD[d.getDay()][0]}<br>${d.getDate()}</span>`).join('')}</div>
  <div class="hbox" data-arr="habits">${l.habits.map(hb=>{const set=new Set(hb.log);const wk=days.filter(d=>set.has(dkey(d))).length;const st=habStreak(hb);
    const cells=days.map(d=>{const k=dkey(d);const fut=k>tk;return `<button class="cell ${set.has(k)?'on':''} ${k===tk?'today':''} ${fut?'future':''}" ${fut?'aria-disabled="true"':`data-act="hb-tog" data-h="${hb.id}" data-d="${k}"`} aria-pressed="${set.has(k)}" aria-label="${esc(hb.name)}, ${WD[d.getDay()]} ${d.getDate()}">${ms('check')}</button>`}).join('');
    let x=`<div class="row" data-id="${hb.id}" style="flex-direction:column;align-items:stretch;gap:0"><div class="hrowx">${handle(hb.name)}<button class="hname" data-act="hb-exp" data-h="${hb.id}" aria-expanded="${!!S.habOpen[hb.id]}"><span class="t">${esc(hb.name)}</span><span class="meta">${hb.target<7?`${wk} of ${hb.target} this week`:habTarget(hb.target)}${st?' · '+pill('good',st):''}</span></button>${cells}</div>`;
    if(S.habOpen[hb.id]){const end=today;const start=addDays(weekStart(end),-28);const cellsM=[];let c30=0;for(let i=0;i<30;i++)if(set.has(dkey(addDays(end,-i))))c30++;
      for(let i=0;i<35;i++){const d=addDays(start,i);const k=dkey(d);const fut=k>tk;cellsM.push(`<button class="cell ${set.has(k)?'on':''} ${k===tk?'today':''} ${fut?'future':''}" ${fut?'aria-disabled="true"':`data-act="hb-tog" data-h="${hb.id}" data-d="${k}"`} aria-label="${d.getDate()} ${MON[d.getMonth()]}" title="${d.getDate()} ${MON[d.getMonth()]}">${ms('check')}</button>`)}
      x+=`<div class="exp"><div class="meta" style="padding-left:34px">Last 5 weeks · ${Math.round(c30/30*100)}% of the last 30 days · ${habTarget(hb.target)}</div><div class="mgrid">${cellsM.join('')}</div><div style="padding-left:34px"><button class="btn" data-act="hb-edit" data-h="${hb.id}">${ms('edit')}Edit habit</button></div></div>`}
    return x+'</div>'}).join('')}</div></div>`;
  h+=`<p class="note">Tap a square to mark a day. Tap a habit’s name for its last 5 weeks.</p>`;
  return h
}

/* ---------- reference ---------- */
function vReference(l){
  const tags=[...new Set(l.items.flatMap(i=>i.tags||[]))];
  let h=addForm('rf-add','Add an item');
  h+=`<div class="search">${ms('search')}<input id="ref-q" type="search" placeholder="Search ${esc(l.name.toLowerCase())}" aria-label="Search this list" data-input="ref-q" value="${esc(S.refQ)}" autocomplete="off"></div>`;
  if(tags.length)h+=`<div class="chips" role="group" aria-label="Filter by tag"><button class="chip btnlike ${!S.refTag?'on':''}" data-act="rf-tag" data-tag="">All</button>${tags.map(t=>`<button class="chip btnlike ${S.refTag===t?'on':''}" data-act="rf-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
  h+=`<div id="ref-results" class="stack">${refResults(l)}</div>`;
  return h
}
function refResults(l){
  const q=lc(S.refQ),tag=S.refTag;const filtering=!!(q||tag);
  const match=i=>(!tag||(i.tags||[]).includes(tag))&&(!q||lc(i.text+' '+(i.note||'')+' '+(i.tags||[]).join(' ')).includes(q));
  const row=i=>`<div class="row" data-id="${i.id}">${filtering?'<span style="width:4px"></span>':handle(i.text)}<button class="star ${i.star?'on':''}" data-act="rf-star" data-id="${i.id}" aria-pressed="${!!i.star}" aria-label="Favourite ${esc(i.text)}">${ms('star',i.star?'fill':'')}</button><button class="rtxt" data-act="rf-edit" data-id="${i.id}"><span class="t">${esc(i.text)}</span>${(i.note||(i.tags||[]).length||getRemind(i))?`<span class="meta">${remindBadge(i)}${i.note?esc(i.note):''}${(i.tags||[]).map(t=>pill('',t)).join('')}</span>`:''}</button>${i.link?`<a class="lnk" href="${esc(i.link)}" target="_blank" rel="noopener" aria-label="Open link">${ms('open_in_new')}</a>`:''}</div>`;
  const st=l.items.filter(i=>i.star&&match(i)),rest=l.items.filter(i=>!i.star&&match(i));
  if(!st.length&&!rest.length)return `<div class="inline-note">${filtering?'Nothing matches.':'Nothing here yet. Add the first item below.'}</div>`;
  return `${st.length?`<div class="sec-h"><span>Favourites</span></div><div class="card" data-arr="items">${st.map(row).join('')}</div>`:''}${rest.length?`${st.length?'<div class="sec-h"><span>Everything else</span></div>':''}<div class="card" data-arr="items">${rest.map(row).join('')}</div>`:''}`
}

/* ---------- notes: subjects, each with a time-ordered feed of notes ---------- */
function nowAtS(){const d=new Date();return dkey(d)+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())}
function snip(t,n=120){t=String(t||'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n-1)+'…':t}
const noteTime=at=>time12(at.slice(11,16));
function composer(l,withSelect){const sel=S.lastSubj&&l.subjects.some(s=>s.id===S.lastSubj)?S.lastSubj:(l.subjects[0]||{}).id;
  return `<form class="composer" data-form="note-add">${withSelect&&l.subjects.length?`<select name="s" class="sel" aria-label="Subject">${l.subjects.map(s=>`<option value="${s.id}" ${s.id===sel?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`:''}<textarea id="note-text" name="t" class="in" rows="1" placeholder="Write a note" data-input="grow" aria-label="Write a note"></textarea><button class="btn primary sq" aria-label="Save note">${ms('send')}</button></form>`}
function vNotes(l){
  return `<div class="search">${ms('search')}<input id="notes-q" type="search" placeholder="Search notes" aria-label="Search notes" data-input="notes-q" value="${esc(S.notesQ||'')}" autocomplete="off"></div><div id="notes-results" class="stack">${notesResults(l)}</div>${composer(l,true)}`
}
function notesResults(l){
  const q=lc(S.notesQ);
  if(q){const hits=l.notes.filter(n=>lc(n.text).includes(q)).sort((a,b)=>b.at.localeCompare(a.at));
    if(!hits.length)return `<p class="note">No notes match “${esc(S.notesQ)}”.</p>`;
    return `<div class="card res">${hits.slice(0,60).map(n=>{const s=l.subjects.find(x=>x.id===n.subj);return `<button data-act="subj-open" data-tid="${n.subj}"><span>${esc(snip(n.text))}</span><small>${esc(s?s.name:'')} · ${niceDay(n.at)}, ${noteTime(n.at)}</small></button>`}).join('')}</div>`}
  const last={},count={};l.notes.forEach(n=>{count[n.subj]=(count[n.subj]||0)+1;if(!last[n.subj]||n.at>=last[n.subj].at)last[n.subj]=n});
  let h=addForm('subj-add','Add a subject')+`<div class="sec-h"><span>Subjects</span><span>${l.subjects.length}</span></div>`;
  h+=l.subjects.length?`<div class="card" data-arr="subjects">${l.subjects.map(s=>{const ln=last[s.id],c=count[s.id]||0;
    return `<div class="row" data-id="${s.id}">${handle(s.name)}<button class="rtxt" data-act="subj-open" data-tid="${s.id}"><span class="t" style="font-weight:600">${esc(s.name)}</span><span class="meta">${c} note${c===1?'':'s'}${ln?` · ${niceDay(ln.at)}, ${noteTime(ln.at)}`:''}</span>${ln?`<span class="preview">${esc(snip(ln.text,140))}</span>`:''}</button>${ms('chevron_right','chev')}</div>`}).join('')}</div>`
    :`<div class="inline-note">${ms('folder')}Make a subject for each topic, like a project.</div>`;
  h+=`<p class="note">Type below to add a quick note to a subject, or open a subject to see all its notes.</p>`;
  return h
}
function vSubject(l,s){
  const ns=l.notes.filter(n=>n.subj===s.id).sort((a,b)=>a.at.localeCompare(b.at));
  let h='';
  if(!ns.length)h+=`<div class="empty"><h2>${esc(s.name)}</h2><p>Type your first note below. Each note is saved with the date and time.</p></div>`;
  let day='';ns.forEach(n=>{const k=n.at.slice(0,10);if(k!==day){day=k;h+=`<div class="daysep"><span>${niceDay(k)}</span></div>`}
    h+=`<button class="ncard" data-act="note-edit" data-nid="${n.id}"><span class="ntext">${esc(n.text)}</span>${getRemind(n)?`<span class="meta">${remindBadge(n)}</span>`:''}<span class="ntime">${noteTime(n.at)}${n.edited?' · edited':''}</span></button>`});
  return h+composer(l,false)
}
function sheetNote(n){const l=L();S.sheet={nid:n.id};
  openSheet(`${sheetHead('Edit note')}<form data-form="note-item"><textarea class="in" name="t" rows="7" id="note-edit" aria-label="Note">${esc(n.text)}</textarea>
  ${fld('Subject',`<select class="sel" name="s">${l.subjects.map(s=>`<option value="${s.id}" ${s.id===n.subj?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`,'Change it to move the note to another subject.')}
  <small class="hint">Written ${niceDay(n.at)}, ${noteTime(n.at)}${n.edited?` · edited ${niceDay(n.edited)}, ${noteTime(n.edited)}`:''}</small>
  ${remindFields(n)}<div class="btns"><button class="btn primary" style="flex:1">Save</button><button type="button" class="btn" data-act="note-copy">${ms('content_copy')}Copy</button></div></form>
  <button class="btn danger block" data-act="note-del">${ms('delete')}Delete note</button>`)}
function sheetSubjMenu(){const l=L();const s=l.subjects.find(x=>x.id===S.route.tid);const c=l.notes.filter(n=>n.subj===s.id).length;
  openSheet(`${sheetHead('Subject options')}<form data-form="subj-meta">${fld('Subject name',`<input class="in" name="n" value="${esc(s.name)}" autocomplete="off">`)}<button class="btn primary block">Save</button></form>
  <div class="danger-zone" id="dz"><button class="btn danger block" data-act="subj-del">${ms('delete')}Delete subject and its ${c} note${c===1?'':'s'}</button></div>`)}
/* ---------- reminders and the Today tab ---------- */
function getRemind(i){return i.remind||(i.due?{type:'once',start:i.due}:null)}
function occursOn(r,k){if(!r||k<r.start)return false;if(r.until&&k>r.until)return false;const d=parseKey(k).getDay();
  if(r.type==='once')return k===r.start;if(r.type==='daily')return true;if(r.type==='weekdays')return d>=1&&d<=5;if(r.type==='days')return (r.days||[]).includes(d);return false}
const shortDate=k=>{const d=parseKey(k);return `${d.getDate()} ${MON[d.getMonth()]}`};
function remindLabel(r){const t=dkey();if(r.type==='once'){const n=daysBetween(t,r.start);return n===0?'Today':n===1?'Tomorrow':n===-1?'Yesterday':shortDate(r.start)}
  let s=r.type==='daily'?'Every day':r.type==='weekdays'?'Weekdays':(daysLabel(r.days)||'Weekly');if(r.start>t)s+=` from ${shortDate(r.start)}`;if(r.until)s+=r.until<t?' (ended)':` till ${shortDate(r.until)}`;return s}
function remindBadge(i){const r=getRemind(i);if(!r)return '';const t=dkey();const c=r.type==='once'?(r.start<t?'bad':r.start===t?'warn':'acc'):(r.until&&r.until<t?'':'acc');return `<span class="pill ${c}">${ms('notifications')} ${esc(remindLabel(r))}</span>`}
function remindFields(i){const r=getRemind(i)||{};const t=r.type||'none';const k=dkey();
  return `<div class="fld remind"><span>${ms('notifications')} Remind me</span>
  <select class="sel" name="rtype" aria-label="Remind me">${[['none','No reminder'],['once','On a date'],['daily','Every day'],['weekdays','Weekdays (Mon to Fri)'],['days','On certain days']].map(([v,l])=>`<option value="${v}" ${t===v?'selected':''}>${l}</option>`).join('')}</select>
  <label class="fld" data-show="once daily weekdays days"><span data-lbl>${t==='once'?'Date':'Starting'}</span><input class="in" type="date" name="rstart" value="${r.start||k}"></label>
  <div class="chips" data-show="days" role="group" aria-label="Days">${[1,2,3,4,5,6,0].map(d=>`<label class="chip"><input type="checkbox" name="rday" value="${d}" ${(r.days||[]).includes(d)?'checked':''}><span>${WD[d]}</span></label>`).join('')}</div>
  <div class="rbox" data-show="daily weekdays days"><label class="fld"><span>Ends</span><select class="sel" name="rend">${[['never','Never'],['7','After 1 week'],['14','After 2 weeks'],['30','After 1 month'],['date','On a date']].map(([v,l])=>`<option value="${v}" ${(r.until?'date':'never')===v?'selected':''}>${l}</option>`).join('')}</select></label><input class="in" type="date" name="runtil" value="${r.until||''}" data-endate aria-label="End date"></div>
  <small class="hint">It shows up in the Today tab on the home screen on those days.</small></div>`}
function syncRemindUI(){const p=$('#panel');const sel=p&&p.querySelector('[name=rtype]');if(!sel)return;const t=sel.value;
  p.querySelectorAll('[data-show]').forEach(el=>{el.hidden=!el.dataset.show.split(' ').includes(t)});
  const lbl=p.querySelector('[data-lbl]');if(lbl)lbl.textContent=t==='once'?'Date':'Starting';
  const end=p.querySelector('[name=rend]'),u=p.querySelector('[data-endate]');if(u)u.hidden=!(end&&end.value==='date')||!['daily','weekdays','days'].includes(t)}
function readRemind(f,old){const t=f.elements.rtype&&f.elements.rtype.value;if(!t||t==='none')return null;const start=f.elements.rstart.value||dkey();const r={type:t,start};
  if(t==='days'){r.days=[...f.querySelectorAll('[name=rday]:checked')].map(x=>Number(x.value));if(!r.days.length)r.days=[parseKey(start).getDay()]}
  if(t!=='once'){const e=f.elements.rend.value;if(e==='date'&&f.elements.runtil.value)r.until=f.elements.runtil.value;else if(/^\d+$/.test(e))r.until=dkey(addDays(parseKey(start),Number(e)-1))}
  const prev=old&&old.remind;if(prev&&prev.done&&prev.type===r.type&&prev.start===r.start)r.done=prev.done;return r}
function applyRemind(f,i){if(!f.elements.rtype)return;const r=readRemind(f,i);delete i.due;if(r)i.remind=r;else delete i.remind}
document.addEventListener('change',e=>{if(e.target.closest&&e.target.closest('#panel')&&(e.target.name==='rtype'||e.target.name==='rend'))syncRemindUI()});
function eachRemindable(l,fn){
  if(['checklist','shopping','rotation','reference'].includes(l.type))(l.items||[]).forEach(i=>fn(i,'',''));
  if(l.type==='trips')(l.trips||[]).filter(t=>!t.past).forEach(t=>t.items.forEach(i=>fn(i,t.id,t.name)));
  if(l.type==='notes')(l.notes||[]).forEach(n=>fn(n,n.subj,((l.subjects||[]).find(s=>s.id===n.subj)||{}).name||''))}
function findItem(l,id,ctx){if(l.type==='trips'){const t=l.trips.find(x=>x.id===ctx);return t&&t.items.find(i=>i.id===id)}if(l.type==='notes')return l.notes.find(n=>n.id===id);if(l.type==='habits')return l.habits.find(h=>h.id===id);return (l.items||[]).find(i=>i.id===id)}
function itemDoneOn(l,i,r,k){return (r.done||[]).includes(k)||(l.type==='checklist'&&(i.log||[]).includes(k))}
function itemDoneAny(l,i,r){return (r.done||[]).some(d=>d>=r.start)||(l.type==='checklist'&&(clDone(l,i)||(i.log||[]).some(d=>d>=r.start)))||((l.type==='shopping'||l.type==='trips')&&!!i.done)}
function collectToday(){
  const k=dkey(),now=new Date(),rows=[];
  orderedLists().forEach(l=>{const icon=l.icon||TYPES[l.type].icon;
    eachRemindable(l,(i,ctx,ctxName)=>{const r=getRemind(i);if(!r)return;const key=`rem|${l.id}|${i.id}|${ctx||''}`;let done,overdue=false;
      if(r.type==='once'){if(r.start>k)return;const any=itemDoneAny(l,i,r);if(r.start<k){if(any&&!itemDoneOn(l,i,r,k)&&!isRecent(key))return;overdue=!any}done=any}
      else{if(!occursOn(r,k))return;done=itemDoneOn(l,i,r,k)||(l.type==='checklist'&&clDone(l,i))||((l.type==='shopping'||l.type==='trips')&&!!i.done)}
      rows.push({key,kind:'rem',l,i,text:snip(i.text||i.name,100),icon,where:ctxName?`${l.name} · ${ctxName}`:l.name,label:overdue?`Was due ${shortDate(r.start)}`:remindLabel(r),done,overdue})});
    if(l.type==='checklist'&&l.reset==='daily')l.items.filter(i=>clActive(i,now)&&!getRemind(i)).forEach(i=>rows.push({key:`chore|${l.id}|${i.id}|`,kind:'chore',l,i,text:i.text,icon,where:l.name,label:'',done:clDone(l,i)}));
    if(l.type==='habits'){const ws=weekStart(now);l.habits.forEach(h=>{const set=new Set(h.log);const dn=set.has(k);let wk=0;for(let d=0;d<7;d++)if(set.has(dkey(addDays(ws,d))))wk++;
      if((h.target||7)<7&&wk>=h.target&&!dn)return;rows.push({key:`habit|${l.id}|${h.id}|`,kind:'habit',l,i:h,text:h.name,icon,where:l.name,label:h.target<7?`${wk} of ${h.target} this week`:'',done:dn})})}
  });
  return rows}
function homeTabs(){const n=collectToday().filter(r=>!r.done).length;const t=S.homeTab==='today';
  return `<div class="seg" role="tablist"><button role="tab" aria-selected="${!t}" class="${!t?'on':''}" data-act="home-tab" data-tab="lists">Lists</button><button role="tab" aria-selected="${t}" class="${t?'on':''}" data-act="home-tab" data-tab="today">Today${n?' · '+n:''}</button></div>`}
function todayRow(r){const on=r.done;return `<div class="row${on?leaving(r.key):''}" data-id="${esc(r.key)}"><span style="width:10px"></span><button class="tick ${on?'on':''}" data-act="td-tog" data-key="${esc(r.key)}" aria-pressed="${on}" aria-label="${esc(r.text)}">${ms('check')}</button><button class="rtxt" data-act="td-open" data-key="${esc(r.key)}"><span class="t ${on?'struck':''}">${esc(r.text)}</span><span class="meta"><span class="ms" aria-hidden="true" style="font-size:15px">${r.icon}</span>${esc(r.where)}${r.label?' · '+(r.overdue?pill('bad',r.label):esc(r.label)):''}</span></button></div>`}
function vToday(){
  const rows=collectToday();const pend=rows.filter(r=>!r.done||isRecent(r.key)),done=rows.filter(r=>r.done&&!isRecent(r.key));const left=rows.filter(r=>!r.done).length;
  const sec=(title,list)=>list.length?`<div class="sec-h"><span>${title}</span><span>${list.length}</span></div><div class="card">${list.map(todayRow).join('')}</div>`:'';
  let h='';
  if(rows.length)h+=`<div class="prog"><div class="bar"><i style="width:${Math.round((rows.length-left)/rows.length*100)}%"></i></div><div class="ptxt">${rows.length-left} of ${rows.length} done today</div></div>`;
  const cls=orderedLists().filter(l=>l.type==='checklist');
  {const nv=cls.find(l=>l.reset==='never');const def=nv?nv.id:'__new';const sel=S.lastTdList&&S.lists[S.lastTdList]?S.lastTdList:def;
    h+=`<form class="add" data-form="td-add"><input id="add-td-add" name="t" class="in" placeholder="Add a task for today" autocomplete="off" aria-label="Task for today"><select name="l" class="sel" aria-label="Add to list">${nv?'':`<option value="__new" ${sel==='__new'?'selected':''}>New list: To-do</option>`}${cls.map(l=>`<option value="${l.id}" ${l.id===sel?'selected':''}>${esc(l.name)}</option>`).join('')}</select><button class="btn primary sq" aria-label="Add">${ms('add')}</button></form>`}
  if(!rows.length)h+=`<div class="empty"><h2>Nothing planned for today</h2><p>Open any item in a list and set “Remind me” to see it here. Daily chores and habits show up here too.</p></div>`;
  else if(!left)h+=`<div class="inline-note">${ms('celebration')}Everything for today is done.</div>`;
  h+=sec('Overdue',pend.filter(r=>r.overdue))+sec('Reminders',pend.filter(r=>r.kind==='rem'&&!r.overdue))+sec('Daily chores',pend.filter(r=>r.kind==='chore'))+sec('Habits',pend.filter(r=>r.kind==='habit'));
  if(done.length)h+=`<div class="sec-h"><span>Done today</span><span>${done.length}</span></div><div class="card">${done.map(todayRow).join('')}</div>`;
  return h}

/* ---------- sheets ---------- */
function iconPicker(sel,color){return `<div class="icons">${ICONS.map(n=>`<label><input type="radio" name="icon" value="${n}" ${n===sel?'checked':''}><span class="box">${ms(n)}</span><span class="sr">${n}</span></label>`).join('')}</div>`}
function colorPicker(sel){return `<div class="chips">${COLORS.map(c=>`<label class="icons" style="display:inline-block"><input type="radio" name="color" value="${c}" ${c===sel?'checked':''} aria-label="${c}"><span class="swatch t-${c}"></span></label>`).join('')}</div>`}
function sheetNewList(){
  openSheet(`${sheetHead('New list')}<form data-form="new-list"><div class="types" role="radiogroup" aria-label="Kind of list">${Object.entries(TYPES).map(([k,t],i)=>`<label><input type="radio" name="type" value="${k}" ${i===0?'checked':''}><span class="lic t-${COLORS[i%6]}">${ms(t.icon)}</span><span><b>${t.label}</b><small>${t.desc}</small></span></label>`).join('')}</div>
  ${fld('Name','<input class="in" name="name" id="nl-name" placeholder="Daily chores" autocomplete="off">')}<button class="btn primary block">Create list</button></form>`);
  $('#panel').addEventListener('change',e=>{if(e.target.name==='type'){const n=$('#nl-name');n.placeholder=TYPES[e.target.value].ph}});
}
function sheetSettings(){
  const l=L();let extra='';
  if(l.type==='checklist')extra=fld('Untick items',`<select class="sel" name="reset">${[['never','Never (one-off list)'],['daily','Every day'],['weekly','Every Monday'],['monthly','On the 1st of each month']].map(([v,t])=>`<option value="${v}" ${l.reset===v?'selected':''}>${t}</option>`).join('')}</select>`);
  if(l.type==='shopping')extra=fld('Aisles, in shop order',`<input class="in" name="cats" value="${esc(l.cats.join(', '))}">`,'Separate with commas.')+fld('Usually buy',`<textarea class="in" name="staples">${esc(l.staples.map(s=>s.text).join('\n'))}</textarea>`,'One per line. Bought items are added here automatically.');
  if(l.type==='trips')extra=fld('Packing sections',`<input class="in" name="secs" value="${esc(l.sections.join(', '))}">`,'Separate with commas.');
  if(l.type==='rotation')extra=fld("Don't suggest again within",`<select class="sel" name="avoid">${[2,3,4,5,7,10,14].map(n=>`<option value="${n}" ${(l.avoid||4)===n?'selected':''}>${n} days</option>`).join('')}</select>`);
  if(l.type==='rotation'||l.type==='log')extra+=fld('Entry categories',`<input class="in" name="meals" value="${esc((l.cats||DEFAULT_MEALS).join(', '))}">`,'Like Breakfast, Lunch, Dinner. Separate with commas.');
  openSheet(`${sheetHead('List settings')}<form data-form="settings">${fld('Name',`<input class="in" name="name" value="${esc(l.name)}" autocomplete="off">`)}${extra}
  <div class="fld"><span>Icon</span>${iconPicker(l.icon)}</div><div class="fld"><span>Colour</span>${colorPicker(l.color)}</div>
  <button class="btn primary block">Save</button></form>
  <div class="danger-zone" id="dz"><button class="btn danger block" data-act="del-list-ask">${ms('delete')}Delete this list</button></div>`);
}
function sheetCl(i){S.sheet={id:i.id};const days=i.days||[];
  openSheet(`${sheetHead('Edit item')}<form data-form="cl-item">${fld('Item',`<input class="in" name="t" value="${esc(i.text)}" autocomplete="off">`)}
  <div class="fld"><span>Only on these days</span><div class="chips">${[1,2,3,4,5,6,0].map(d=>`<label class="chip"><input type="checkbox" name="d" value="${d}" ${days.includes(d)?'checked':''}><span>${WD[d]}</span></label>`).join('')}</div><small class="hint">Leave all off to show it every day.</small></div>
  
  ${S.route.v==='tpl'?'':remindFields(i)}<div class="btns"><button class="btn primary" style="flex:1">Save</button><button type="button" class="btn" data-act="move-top">${ms('vertical_align_top')}Move to top</button></div></form><button class="btn danger block" data-act="item-del">${ms('delete')}Delete item</button>`)}
function sheetSh(i){const l=L();S.sheet={id:i.id};
  openSheet(`${sheetHead('Edit item')}<form data-form="sh-item">${fld('Item',`<input class="in" name="t" value="${esc(i.text)}" autocomplete="off">`)}${fld('Aisle',`<select class="sel" name="c">${opts(l.cats,i.cat)}</select>`)}
  ${S.route.v==='tpl'?'':remindFields(i)}<div class="btns"><button class="btn primary" style="flex:1">Save</button><button type="button" class="btn" data-act="move-top">${ms('vertical_align_top')}Move to top</button></div></form><button class="btn danger block" data-act="item-del">${ms('delete')}Delete item</button>`)}
function sheetTripItem(l,t,i,isTpl){S.sheet={id:i.id};const tpl=!isTpl&&l.templates.find(x=>x.id===t.tplId);
  openSheet(`${sheetHead('Edit item')}<form data-form="${isTpl?'tpl-item':'tr-item'}">${fld('Item',`<input class="in" name="t" value="${esc(i.text)}" autocomplete="off">`)}${fld('Section',`<select class="sel" name="s">${opts(l.sections,i.sec)}</select>`)}
  ${S.route.v==='tpl'?'':remindFields(i)}<div class="btns"><button class="btn primary" style="flex:1">Save</button><button type="button" class="btn" data-act="move-top">${ms('vertical_align_top')}Move to top</button></div></form>
  ${(!isTpl&&i.only&&tpl)?`<div class="fld"><small class="hint">This item is only on this trip.</small><button class="btn block" data-act="tr-to-tpl">${ms('playlist_add')}Add to “${esc(tpl.name)}” template too</button></div>`:''}
  <button class="btn danger block" data-act="item-del">${ms('delete')}Delete item</button>`)}
function sheetNewTrip(tplId){const l=L();
  const from=[...l.templates.map(t=>[`tpl:${t.id}`,`Template: ${t.name}`]),...l.trips.map(t=>[`trip:${t.id}`,`Copy of trip: ${t.name}`]),['none','Empty list']];
  openSheet(`${sheetHead('New trip')}<form data-form="tr-new">${fld('Trip name','<input class="in" name="n" id="tr-n" placeholder="Goa, Dec 2026" autocomplete="off">')}${fld('Dates','<input class="in" name="d" placeholder="20 – 26 Dec" autocomplete="off">','Optional.')}
  ${fld('Start from',`<select class="sel" name="f">${from.map(([v,t])=>`<option value="${v}" ${v==='tpl:'+tplId?'selected':''}>${esc(t)}</option>`).join('')}</select>`)}<button class="btn primary block">Create trip</button></form>`,'#tr-n')}
function sheetTripMenu(){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);
  openSheet(`${sheetHead('Trip options')}<form data-form="tr-meta">${fld('Trip name',`<input class="in" name="n" value="${esc(t.name)}" autocomplete="off">`)}${fld('Dates',`<input class="in" name="d" value="${esc(t.dates||'')}" autocomplete="off">`)}<button class="btn primary block">Save</button></form>
  <button class="btn block" data-act="tr-past">${ms(t.past?'unarchive':'archive')}${t.past?'Move back to upcoming':'Mark trip as done'}</button>
  <button class="btn block" data-act="tr-untick">${ms('restart_alt')}Untick everything</button>
  <button class="btn block" data-act="tr-save-tpl">${ms('content_copy')}Save as a new template</button>
  <div class="danger-zone" id="dz"><button class="btn danger block" data-act="tr-del">${ms('delete')}Delete trip</button></div>`)}
function sheetTplMenu(){const l=L();const t=l.templates.find(x=>x.id===S.route.tid);
  openSheet(`${sheetHead('Template options')}<form data-form="tpl-meta">${fld('Template name',`<input class="in" name="n" value="${esc(t.name)}" autocomplete="off">`)}<button class="btn primary block">Save</button></form>
  <div class="danger-zone"><button class="btn danger block" data-act="tpl-del">${ms('delete')}Delete template</button><small class="hint">Trips made from it are kept.</small></div>`)}
function sheetRo(i){S.sheet={id:i.id};const l=L();const m=lastMadeMap(l);
  openSheet(`${sheetHead('Edit option')}<form data-form="ro-item">${fld('Name',`<input class="in" name="t" value="${esc(i.name)}" autocomplete="off">`)}${fld('Tags',`<input class="in" name="g" value="${esc((i.tags||[]).join(', '))}" placeholder="Dinner, Quick" autocomplete="off">`,'Separate with commas.')}
  ${S.route.v==='tpl'?'':remindFields(i)}<div class="btns"><button class="btn primary" style="flex:1">Save</button><button type="button" class="btn" data-act="move-top">${ms('vertical_align_top')}Move to top</button></div></form>
  <div class="fld"><span>Last made: ${esc(ago(l,m[i.id]).t)}</span><div class="add"><input class="in" type="date" id="ro-past" value="${dkey(addDays(new Date(),-1))}" max="${dkey()}" aria-label="Date made"><button class="btn" data-act="ro-made-on">Log as made</button></div></div>
  <button class="btn danger block" data-act="item-del">${ms('delete')}Delete option</button>`)}
function sheetLog(e){const l=L();const isNew=!e;const cats=l.cats||DEFAULT_MEALS;
  e=e||{id:uid(),at:nowAt(),meal:mealFor(cats),text:'',dishIds:[]};S.sheet={eid:e.id,isNew};
  let picks='';
  if(l.type!=='rotation'){const rec=[...new Set([...l.log].sort((a,b)=>b.at.localeCompare(a.at)).map(x=>x.text).filter(Boolean))].slice(0,8);
    if(rec.length)picks=`<div class="fld"><span>Recent</span><div class="chips">${rec.map(t=>`<button type="button" class="chip btnlike" data-act="log-fill" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`}
  openSheet(`${sheetHead(isNew?(l.type==='rotation'?'Log a meal':'Add entry'):'Edit entry')}<form data-form="log">${picks}
  ${fld(l.type==='rotation'?'What did you eat?':'What',`<input class="in" name="t" id="log-t" value="${esc(isNew?'':(l.type==='rotation'?logText(l,e):e.text||''))}" placeholder="${l.type==='rotation'?'Dal, roti, salad':'Vitamin D'}" autocomplete="off">`,l.type==='rotation'&&l.items.length?'Dishes from your options are recognised, so their “last made” stays up to date.':'')}
  ${cats.length?`<div class="fld"><span>When</span><div class="chips">${cats.map(c=>`<label class="chip"><input type="radio" name="meal" value="${esc(c)}" ${e.meal===c?'checked':''}><span>${esc(c)}</span></label>`).join('')}</div></div>`:''}
  <div class="add"><input class="in" type="date" name="d" value="${e.at.slice(0,10)}" aria-label="Date" style="flex:1 1 140px"><input class="in" type="time" name="h" value="${e.at.slice(11,16)}" aria-label="Time" style="flex:1 1 110px"></div>
  <button class="btn primary block">Save</button></form>${isNew?'':`<button class="btn danger block" data-act="log-del">${ms('delete')}Delete entry</button>`}`)}
function sheetHab(hb){S.sheet={id:hb.id};
  openSheet(`${sheetHead('Edit habit')}<form data-form="hb-item">${fld('Habit',`<input class="in" name="t" value="${esc(hb.name)}" autocomplete="off">`)}${fld('How often',`<select class="sel" name="g">${[7,6,5,4,3,2,1].map(n=>`<option value="${n}" ${hb.target===n?'selected':''}>${n===7?'Every day':n+' times a week'}</option>`).join('')}</select>`)}
  <button class="btn primary block">Save</button></form><button class="btn danger block" data-act="hb-del">${ms('delete')}Delete habit</button>`)}
function sheetRef(i){S.sheet={id:i.id};const targets=orderedLists().filter(x=>x.id!==S.route.id&&['checklist','shopping','reference','rotation'].includes(x.type));
  openSheet(`${sheetHead('Edit item')}<form data-form="rf-item">${fld('Item',`<input class="in" name="t" value="${esc(i.text)}" autocomplete="off">`)}${fld('Note',`<input class="in" name="n" value="${esc(i.note||'')}" placeholder="Recommended by Riya" autocomplete="off">`)}${fld('Link',`<input class="in" name="k" type="url" value="${esc(i.link||'')}" placeholder="https://" autocomplete="off">`)}${fld('Tags',`<input class="in" name="g" value="${esc((i.tags||[]).join(', '))}" placeholder="Comedy, Hindi" autocomplete="off">`,'Separate with commas.')}
  ${S.route.v==='tpl'?'':remindFields(i)}<div class="btns"><button class="btn primary" style="flex:1">Save</button><button type="button" class="btn" data-act="move-top">${ms('vertical_align_top')}Move to top</button></div></form>
  ${targets.length?`<div class="fld"><span>Move to another list</span><div class="add"><select class="sel" id="rf-target" style="flex:1" aria-label="Target list">${targets.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><button class="btn" data-act="rf-move">Move</button></div></div>`:''}
  <button class="btn danger block" data-act="item-del">${ms('delete')}Delete item</button>`)}

/* ---------- item lookup for sheets ---------- */
function sheetArr(){const l=L(),r=S.route;if(r.v==='trip')return l.trips.find(t=>t.id===r.tid).items;if(r.v==='tpl')return l.templates.find(t=>t.id===r.tid).items;if(l.type==='habits')return l.habits;return l.items}
function sheetItem(){return sheetArr().find(i=>i.id===S.sheet.id)}

/* ---------- actions ---------- */
const ACT={
  'close-sheet':closeSheet,back,
  'new-list':sheetNewList,
  open(el){const id=el.dataset.id;S.homeQ='';if(el.dataset.subj){S.scrollBottom=true;go({v:'subj',id,tid:el.dataset.subj})}else if(el.dataset.trip)go({v:'trip',id,tid:el.dataset.trip});else if(el.dataset.tpl)go({v:'tpl',id,tid:el.dataset.tpl});else go({v:'list',id})},
  menu:sheetSettings,
  'del-list-ask'(){$('#dz').innerHTML=`<div class="confirm"><span>Delete “${esc(L().name)}” and everything in it?</span><div class="btns"><button class="btn danger" data-act="del-list">Delete list</button><button class="btn" data-act="close-sheet">Keep it</button></div></div>`},
  'del-list'(){const l=L();const before=JSON.stringify(l);const ord=S.order.slice();delete S.lists[l.id];S.order=S.order.filter(x=>x!==l.id);save(l.id);saveMeta();closeSheet();S.route={v:'home'};S.stack=[];render();
    toast(`Deleted ${l.name}`,()=>{const v=JSON.parse(before);S.lists[v.id]=v;S.order=ord;save(v.id);saveMeta();render()})},
  'move-top'(){const l=L();const arr=sheetArr();const i=arr.findIndex(x=>x.id===S.sheet.id);if(i>0){const [x]=arr.splice(i,1);arr.unshift(x);save(l.id)}closeSheet();render();toast('Moved to the top')},
  'item-del'(){const l=L();const arr=sheetArr();const id=S.sheet.id;const it=arr.find(x=>x.id===id);closeSheet();withUndo(l.id,`Deleted ${it.text||it.name}`,()=>{arr.splice(arr.indexOf(it),1);if(l.type==='rotation')l.log.forEach(e=>{if(e.dishIds)e.dishIds=e.dishIds.filter(x=>x!==id)})})},
  // checklist
  tab(el){S.route.tab=el.dataset.tab;window.scrollTo(0,0);render()},
  'cl-tog'(el){const l=L();const i=l.items.find(x=>x.id===el.dataset.id);const k=dkey();
    if(clDone(l,i)){i.doneIn=null;i.log=(i.log||[]).filter(d=>d!==k);delete S.recent[i.id]}else{i.doneIn=period(l.reset);i.log=[...new Set([...(i.log||[]),k])].slice(-120);markRecent(i.id)}save(l.id);render()},
  'cl-edit'(el){sheetCl(L().items.find(x=>x.id===el.dataset.id))},
  'cl-untick'(){const l=L();withUndo(l.id,'Unticked everything',()=>l.items.forEach(i=>{if(clDone(l,i)){i.doneIn=null;i.log=(i.log||[]).filter(d=>d!==dkey())}}))},
  'cl-clear'(){const l=L();withUndo(l.id,'Removed ticked items',()=>{l.items=l.items.filter(i=>!clDone(l,i))})},
  // shopping
  'sh-tog'(el){const l=L();const i=l.items.find(x=>x.id===el.dataset.id);i.done=!i.done;if(i.done)i.doneOn=dkey();else delete i.doneOn;save(l.id);render()},
  'sh-edit'(el){sheetSh(L().items.find(x=>x.id===el.dataset.id))},
  'sh-staple'(el){const l=L();const s=shKnown(l,el.dataset.t);l.items.push({id:uid(),text:el.dataset.t,qty:'',cat:(s&&s.cat)||'Other',done:false});save(l.id);render();toast(`Added ${el.dataset.t}`)},
  'sh-again'(el){const l=L();const p=l.items.find(x=>x.id===el.dataset.id);l.items.push({id:uid(),text:p.text,qty:'',cat:p.cat||'Other',done:false});save(l.id);render();toast(`Added ${p.text} to To buy`)},
  'sh-clear'(){const l=L();withUndo(l.id,'Cleared bought items',()=>{l.items.filter(i=>i.done).forEach(i=>{const s=l.staples.find(x=>lc(x.text)===lc(i.text));if(s){s.qty=i.qty;s.cat=i.cat}else l.staples.push({text:i.text,qty:i.qty,cat:i.cat})});l.items=l.items.filter(i=>!i.done)})},
  'sh-copy'(){const t=shText(L());const fb=()=>openSheet(`${sheetHead('Copy list')}<textarea class="in" id="copy-t" rows="12" readonly>${esc(t)}</textarea><small class="hint">Select all and copy, then paste into WhatsApp or a delivery app.</small>`,'#copy-t');
    try{navigator.clipboard.writeText(t).then(()=>toast('List copied. Paste it into WhatsApp or a delivery app.'),fb)}catch(e){fb()}},
  // trips
  'tr-new'(el){sheetNewTrip(el.dataset.tpl)},
  'tr-open'(el){go({v:'trip',id:S.route.id,tid:el.dataset.tid})},
  'tpl-open'(el){go({v:'tpl',id:S.route.id,tid:el.dataset.tid})},
  'tpl-new'(){const l=L();const t={id:uid(),name:'New template',items:[]};l.templates.push(t);save(l.id);go({v:'tpl',id:l.id,tid:t.id});sheetTplMenu()},
  'tr-tog'(el){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);const i=t.items.find(x=>x.id===el.dataset.id);i.done=!i.done;if(i.done)markRecent(i.id);else delete S.recent[i.id];save(l.id);render()},
  'tr-edit'(el){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);sheetTripItem(l,t,t.items.find(x=>x.id===el.dataset.id),false)},
  'tpl-edit'(el){const l=L();const t=l.templates.find(x=>x.id===S.route.tid);sheetTripItem(l,t,t.items.find(x=>x.id===el.dataset.id),true)},
  'tr-to-tpl'(){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);const tpl=l.templates.find(x=>x.id===t.tplId);const i=sheetItem();tpl.items.push({id:uid(),text:i.text,sec:i.sec});i.only=false;save(l.id);closeSheet();render();toast(`Added to ${tpl.name}`)},
  'trip-menu':sheetTripMenu,'tpl-menu':sheetTplMenu,
  'tr-past'(){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);t.past=!t.past;save(l.id);closeSheet();render();toast(t.past?'Moved to past trips':'Moved to upcoming')},
  'tr-untick'(){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);closeSheet();withUndo(l.id,'Unticked everything',()=>t.items.forEach(i=>i.done=false))},
  'tr-save-tpl'(){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);const n={id:uid(),name:`${t.name} template`,items:t.items.map(i=>({id:uid(),text:i.text,sec:i.sec}))};l.templates.push(n);save(l.id);closeSheet();render();toast(`Saved “${n.name}”`)},
  'tr-del'(){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);closeSheet();S.route={v:'list',id:l.id};S.stack=[{v:'home'}];withUndo(l.id,`Deleted ${t.name}`,()=>{l.trips=l.trips.filter(x=>x!==t)})},
  'tpl-del'(){const l=L();const t=l.templates.find(x=>x.id===S.route.tid);closeSheet();S.route={v:'list',id:l.id};S.stack=[{v:'home'}];withUndo(l.id,`Deleted ${t.name}`,()=>{l.templates=l.templates.filter(x=>x!==t)})},
  // rotation + log
  'ro-tab'(el){S.route.tab=el.dataset.tab;render()},
  'ro-tag'(el){S.roTag=el.dataset.tag;render()},
  'ro-sort'(){S.roSort=S.roSort==='mine'?'ago':'mine';render()},
  'ro-made'(el){const l=L();const i=l.items.find(x=>x.id===el.dataset.id);const meal=mealFor(l.cats||DEFAULT_MEALS);withUndo(l.id,`Logged ${i.name}${meal?' for '+meal.toLowerCase():''}`,()=>l.log.push({id:uid(),at:nowAt(),meal,text:'',dishIds:[i.id]}))},
  'ro-made-on'(){const l=L();const i=sheetItem();const d=$('#ro-past').value;if(!d)return;closeSheet();withUndo(l.id,`Logged ${i.name} on ${niceDay(d)}`,()=>l.log.push({id:uid(),at:d+'T20:00',meal:(l.cats||DEFAULT_MEALS).includes('Dinner')?'Dinner':'',text:'',dishIds:[i.id]}))},
  'ro-edit'(el){sheetRo(L().items.find(x=>x.id===el.dataset.id))},
  'log-new'(){sheetLog(null)},
  'log-edit'(el){sheetLog(L().log.find(e=>e.id===el.dataset.eid))},
  'log-fill'(el){$('#log-t').value=el.dataset.t},
  'log-del'(){const l=L();const id=S.sheet.eid;closeSheet();withUndo(l.id,'Entry deleted',()=>{l.log=l.log.filter(e=>e.id!==id)})},
  'log-more'(){S.logLimit+=21;render()},
  // habits
  'hb-tog'(el){const l=L();const h=l.habits.find(x=>x.id===el.dataset.h);const k=el.dataset.d;h.log=h.log.includes(k)?h.log.filter(x=>x!==k):[...h.log,k].sort().slice(-800);save(l.id);render()},
  'hb-exp'(el){S.habOpen[el.dataset.h]=!S.habOpen[el.dataset.h];render()},
  'hb-week'(el){S.habWeek=Math.min(0,S.habWeek+Number(el.dataset.d));render()},
  'hb-edit'(el){sheetHab(L().habits.find(x=>x.id===el.dataset.h))},
  'hb-del'(){const l=L();const id=S.sheet.id;const h=l.habits.find(x=>x.id===id);closeSheet();withUndo(l.id,`Deleted ${h.name}`,()=>{l.habits=l.habits.filter(x=>x.id!==id)})},
  // today
  'home-tab'(el){S.homeTab=el.dataset.tab;try{localStorage.setItem('home-tab',S.homeTab)}catch(e){}render()},
  'td-open'(el){const [kind,lid,iid,ctx]=el.dataset.key.split('|');const l=S.lists[lid];if(!l)return;
    if(l.type==='trips'&&ctx)go({v:'trip',id:lid,tid:ctx});else if(l.type==='notes'&&ctx){S.scrollBottom=true;go({v:'subj',id:lid,tid:ctx})}else go({v:'list',id:lid})},
  'td-tog'(el){const key=el.dataset.key;const [kind,lid,iid,ctx]=key.split('|');const l=S.lists[lid];if(!l)return;const k=dkey();
    const it=findItem(l,iid,ctx);if(!it)return;const row=collectToday().find(r=>r.key===key);const was=!!(row&&row.done);
    if(kind==='habit')it.log=was?it.log.filter(x=>x!==k):[...it.log,k].sort().slice(-800);
    else if(l.type==='checklist'){if(was){it.doneIn=null;it.log=(it.log||[]).filter(d=>d!==k);if(it.remind)it.remind.done=(it.remind.done||[]).filter(d=>d!==k)}else{it.doneIn=period(l.reset);it.log=[...new Set([...(it.log||[]),k])].slice(-120)}}
    else{const r=getRemind(it);if(!r)return;
      if(was){r.done=r.type==='once'?[]:(r.done||[]).filter(d=>d!==k);if(l.type==='shopping'||l.type==='trips')it.done=false}
      else{r.done=[...new Set([...(r.done||[]),k])].slice(-60);if(r.type==='once'&&(l.type==='shopping'||l.type==='trips'))it.done=true}
      it.remind=r;delete it.due;if(l.type==='shopping'){if(it.done)it.doneOn=it.doneOn||k;else delete it.doneOn}}
    if(was)delete S.recent[key];else markRecent(key);save(l.id);render()},
  // notes
  'subj-open'(el){S.scrollBottom=true;go({v:'subj',id:S.route.id,tid:el.dataset.tid})},
  'note-edit'(el){sheetNote(L().notes.find(n=>n.id===el.dataset.nid))},
  'note-copy'(){const n=L().notes.find(x=>x.id===S.sheet.nid);try{navigator.clipboard.writeText(n.text).then(()=>toast('Note copied'),()=>{const t=$('#note-edit');t.focus();t.select();toast('Select and copy the text')})}catch(e){const t=$('#note-edit');t.focus();t.select()}},
  'note-del'(){const l=L();const id=S.sheet.nid;closeSheet();withUndo(l.id,'Note deleted',()=>{l.notes=l.notes.filter(n=>n.id!==id)})},
  'subj-menu':sheetSubjMenu,
  'subj-del'(){const l=L();const s=l.subjects.find(x=>x.id===S.route.tid);closeSheet();S.route={v:'list',id:l.id};S.stack=[{v:'home'}];
    withUndo(l.id,`Deleted ${s.name}`,()=>{l.subjects=l.subjects.filter(x=>x!==s);l.notes=l.notes.filter(n=>n.subj!==s.id)})},
  // reference
  'rf-star'(el){const l=L();const i=l.items.find(x=>x.id===el.dataset.id);i.star=!i.star;save(l.id);render()},
  'rf-edit'(el){sheetRef(L().items.find(x=>x.id===el.dataset.id))},
  'rf-tag'(el){S.refTag=el.dataset.tag;render()},
  'rf-move'(){const l=L();const i=sheetItem();const to=S.lists[$('#rf-target').value];if(!to)return;
    const n={checklist:{id:uid(),text:i.text,doneIn:null},shopping:{id:uid(),text:i.text,qty:'',cat:'Other',done:false},reference:{...i,id:uid()},rotation:{id:uid(),name:i.text,tags:[]}}[to.type];
    to.items.push(n);l.items=l.items.filter(x=>x.id!==i.id);save(to.id);save(l.id);closeSheet();render();toast(`Moved to ${to.name}`)}
};
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el||el.disabled)return;const f=ACT[el.dataset.act];if(f){e.preventDefault();f(el,e)}});

/* ---------- forms ---------- */
const val=(f,n)=>(f.elements[n]?.value||'').trim();
const splitList=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
const FORM={
  'new-list'(f){const type=f.elements.type.value;const name=val(f,'name')||TYPES[type].ph;const idx=Object.keys(S.lists).length;
    const base={id:uid(),type,name,icon:TYPES[type].icon,color:COLORS[idx%6],created:Date.now()};
    const extra={checklist:{reset:'never',items:[]},shopping:{cats:[...DEFAULT_CATS],items:[],staples:[]},trips:{sections:[...DEFAULT_SECTIONS],templates:[{id:uid(),name:'Packing template',items:[]}],trips:[]},rotation:{avoid:4,cats:[...DEFAULT_MEALS],items:[],log:[]},habits:{habits:[]},reference:{items:[]},log:{cats:[],log:[]},notes:{subjects:[{id:uid(),name:'General'}],notes:[]}}[type];
    const l={...base,...extra};S.lists[l.id]=l;S.order=[...orderedLists().map(x=>x.id).filter(x=>x!==l.id),l.id];save(l.id);saveMeta();closeSheet();S.route={v:'home'};go({v:'list',id:l.id});S.refocus=document.querySelector('#view form.add input')?.id;render()},
  settings(f){const l=L();l.name=val(f,'name')||l.name;l.icon=f.elements.icon?.value||l.icon;l.color=f.elements.color?.value||l.color;
    if(l.type==='checklist'){const r=f.elements.reset.value;if(r!==l.reset){const old=l.reset;l.items.forEach(i=>{if(i.doneIn===period(old))i.doneIn=period(r);else i.doneIn=null});l.reset=r}}
    if(l.type==='shopping'){const c=splitList(val(f,'cats'));if(c.length){if(!c.includes('Other'))c.push('Other');l.cats=c}
      const lines=f.elements.staples.value.split('\n').map(x=>x.trim()).filter(Boolean);l.staples=lines.map(t=>l.staples.find(s=>s.text===t)||{text:t,qty:'',cat:'Other'})}
    if(l.type==='trips'){const c=splitList(val(f,'secs'));if(c.length){if(!c.includes('Other'))c.push('Other');l.sections=c}}
    if(l.type==='rotation')l.avoid=Number(f.elements.avoid.value);
    if(l.type==='rotation'||l.type==='log')l.cats=splitList(val(f,'meals'));
    save(l.id);closeSheet();render();toast('Saved')},
  'cl-add'(f){const t=val(f,'t');if(!t)return;const l=L();l.items.push({id:uid(),text:t,doneIn:null});save(l.id);S.refocus='add-cl-add';render()},
  'cl-item'(f){const l=L();const i=sheetItem();i.text=val(f,'t')||i.text;i.days=[...f.querySelectorAll('[name=d]:checked')].map(x=>Number(x.value));if(!i.days.length||i.days.length===7)delete i.days;applyRemind(f,i);save(l.id);closeSheet();render()},
  'sh-add'(f){const t=val(f,'t');if(!t)return;const l=L();const c=f.elements.c.value;S.lastCat=c;const st=shKnown(l,t);
    l.items.push({id:uid(),text:t,qty:val(f,'q'),cat:(c==='Other'&&st&&st.cat)?st.cat:c,done:false});save(l.id);S.refocus='add-sh-add';render()},
  'sh-item'(f){const l=L();const i=sheetItem();i.text=val(f,'t')||i.text;i.cat=f.elements.c.value;applyRemind(f,i);save(l.id);closeSheet();render()},
  'tr-new'(f){const l=L();const n=val(f,'n');if(!n){f.elements.n.focus();f.elements.n.placeholder='Give the trip a name';return}
    const src=f.elements.f.value;let items=[],tplId=null;
    if(src.startsWith('tpl:')){const t=l.templates.find(x=>'tpl:'+x.id===src);tplId=t.id;items=t.items.map(i=>({id:uid(),text:i.text,sec:i.sec,done:false,only:false}))}
    else if(src.startsWith('trip:')){const t=l.trips.find(x=>'trip:'+x.id===src);tplId=t.tplId;items=t.items.map(i=>({id:uid(),text:i.text,sec:i.sec,done:false,only:!!i.only}))}
    const trip={id:uid(),name:n,dates:val(f,'d'),tplId,items,past:false};l.trips.unshift(trip);save(l.id);closeSheet();
    if(S.route.v==='tpl')S.route={v:'list',id:l.id};go({v:'trip',id:l.id,tid:trip.id})},
  'tr-add'(f){const t=val(f,'t');if(!t)return;const l=L();const trip=l.trips.find(x=>x.id===S.route.tid);const s=f.elements.s.value;S.lastSec=s;const also=f.elements.also?.checked;const tpl=l.templates.find(x=>x.id===trip.tplId);
    trip.items.push({id:uid(),text:t,sec:s,done:false,only:!!tpl&&!also});if(also&&tpl)tpl.items.push({id:uid(),text:t,sec:s});save(l.id);S.refocus='add-tr-add';render();if(also&&tpl)toast(`Also added to ${tpl.name}`)},
  'tpl-add'(f){const t=val(f,'t');if(!t)return;const l=L();const tpl=l.templates.find(x=>x.id===S.route.tid);const s=f.elements.s.value;S.lastSec=s;tpl.items.push({id:uid(),text:t,sec:s});save(l.id);S.refocus='add-tpl-add';render()},
  'tr-item'(f){const l=L();const i=sheetItem();i.text=val(f,'t')||i.text;i.sec=f.elements.s.value;if(S.route.v==='trip')applyRemind(f,i);save(l.id);closeSheet();render()},
  'tpl-item'(f){FORM['tr-item'](f)},
  'tr-meta'(f){const l=L();const t=l.trips.find(x=>x.id===S.route.tid);t.name=val(f,'n')||t.name;t.dates=val(f,'d');save(l.id);closeSheet();render()},
  'tpl-meta'(f){const l=L();const t=l.templates.find(x=>x.id===S.route.tid);t.name=val(f,'n')||t.name;save(l.id);closeSheet();render()},
  'ro-add'(f){const t=val(f,'t');if(!t)return;const l=L();l.items.push({id:uid(),name:t,tags:S.roTag?[S.roTag]:[]});save(l.id);S.refocus='add-ro-add';render()},
  'ro-item'(f){const l=L();const i=sheetItem();i.name=val(f,'t')||i.name;i.tags=splitList(val(f,'g'));applyRemind(f,i);save(l.id);closeSheet();render()},
  log(f){const l=L();const text=val(f,'t');const dishIds=l.type==='rotation'?matchDishes(l,text):[];
    if(!text){const t=$('#log-t');t.placeholder='Type what it was';t.focus();return}
    const at=(f.elements.d.value||dkey())+'T'+(f.elements.h.value||'12:00');const meal=f.querySelector('[name=meal]:checked')?.value||'';
    if(S.sheet.isNew)l.log.push({id:S.sheet.eid,at,meal,text,dishIds});else Object.assign(l.log.find(e=>e.id===S.sheet.eid),{at,meal,text,dishIds});
    save(l.id);closeSheet();render();toast('Saved')},
  'hb-add'(f){const t=val(f,'t');if(!t)return;const l=L();l.habits.push({id:uid(),name:t,target:Number(f.elements.g.value),log:[]});save(l.id);S.refocus='add-hb-add';render()},
  'hb-item'(f){const l=L();const h=sheetItem();h.name=val(f,'t')||h.name;h.target=Number(f.elements.g.value);save(l.id);closeSheet();render()},
  'td-add'(f){const t=val(f,'t');if(!t)return;let l=S.lists[f.elements.l.value];if(!l){l={id:uid(),type:'checklist',name:'To-do',icon:'checklist',color:'blue',created:Date.now(),reset:'never',items:[]};S.lists[l.id]=l;S.order=[...orderedLists().map(x=>x.id).filter(x=>x!==l.id),l.id];saveMeta()}S.lastTdList=l.id;
    l.items.push({id:uid(),text:t,doneIn:null,remind:{type:'once',start:dkey()}});save(l.id);S.refocus='add-td-add';render();toast(`Added to ${l.name}`)},
  'subj-add'(f){const t=val(f,'t');if(!t)return;const l=L();const s={id:uid(),name:t};l.subjects.push(s);save(l.id);S.lastSubj=s.id;S.refocus='add-subj-add';render();toast(`Added ${t}`)},
  'note-add'(f){const text=f.elements.t.value.trim();if(!text){f.elements.t.focus();return}const l=L();
    let sid=S.route.v==='subj'?S.route.tid:(f.elements.s?f.elements.s.value:'');
    if(!sid){let g=l.subjects.find(s=>s.name==='General');if(!g){g={id:uid(),name:'General'};l.subjects.unshift(g)}sid=g.id}
    S.lastSubj=sid;l.notes.push({id:uid(),subj:sid,text,at:nowAtS()});save(l.id);S.refocus='note-text';
    if(S.route.v==='subj')S.scrollBottom=true;render();if(S.route.v!=='subj')toast(`Saved to ${l.subjects.find(s=>s.id===sid).name}`)},
  'note-item'(f){const l=L();const n=l.notes.find(x=>x.id===S.sheet.nid);const t=f.elements.t.value.trim();if(!t)return;
    if(t!==n.text){n.text=t;n.edited=nowAtS()}const moved=n.subj!==f.elements.s.value;n.subj=f.elements.s.value;applyRemind(f,n);save(l.id);closeSheet();render();
    if(moved)toast(`Moved to ${l.subjects.find(s=>s.id===n.subj).name}`)},
  'subj-meta'(f){const l=L();const s=l.subjects.find(x=>x.id===S.route.tid);s.name=val(f,'n')||s.name;save(l.id);closeSheet();render()},
  'rf-add'(f){const t=val(f,'t');if(!t)return;const l=L();l.items.push({id:uid(),text:t,note:'',tags:S.refTag?[S.refTag]:[],star:false});save(l.id);S.refocus='add-rf-add';render()},
  'rf-item'(f){const l=L();const i=sheetItem();i.text=val(f,'t')||i.text;i.note=val(f,'n');const k=val(f,'k');i.link=/^https?:\/\//i.test(k)?k:(k?'https://'+k:'');i.tags=splitList(val(f,'g'));applyRemind(f,i);save(l.id);closeSheet();render()}
};
document.addEventListener('submit',e=>{const f=FORM[e.target.dataset.form];if(f){e.preventDefault();f(e.target)}});
document.addEventListener('input',e=>{const k=e.target.dataset.input;
  if(k==='home-q'){S.homeQ=e.target.value;$('#home-results').innerHTML=homeResults();const hl=$('#home-lists');if(hl)hl.hidden=!!S.homeQ}
  if(k==='notes-q'){S.notesQ=e.target.value;$('#notes-results').innerHTML=notesResults(L())}
  if(k==='grow'){const t=e.target;t.style.height='auto';t.style.height=Math.min(t.scrollHeight+2,180)+'px'}
  if(k==='ref-q'){S.refQ=e.target.value;$('#ref-results').innerHTML=refResults(L())}});

document.addEventListener('keydown',e=>{if(e.target.id==='note-text'&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.target.form.requestSubmit()}});
/* ---------- drag to reorder ---------- */
let drag=null;
function finishReorder(box,id){const key=box.dataset.arr;const ids=[...box.children].map(c=>c.dataset.id).filter(Boolean);
  if(key==='lists'){S.order=ids;saveMeta()}else{const l=L();const [k,sub]=key.split(':');
    const arr=k==='subjects'?l.subjects:k==='items'?l.items:k==='habits'?l.habits:k==='trips'?l.trips:k==='templates'?l.templates:k==='trip'?l.trips.find(t=>t.id===sub).items:l.templates.find(t=>t.id===sub).items;
    reorderSubset(arr,ids);save(l.id)}
  if(id)S.focusHandle=`[data-arr="${key}"] > [data-id="${id}"] [data-handle]`;render()}
document.addEventListener('pointerdown',e=>{const h=e.target.closest('[data-handle]');if(!h||e.button>0)return;const row=h.closest('[data-id]');const box=row&&row.parentElement;if(!box||!box.dataset.arr)return;
  e.preventDefault();try{h.setPointerCapture(e.pointerId)}catch(_){}drag={row,box,moved:false};row.classList.add('dragging')});
document.addEventListener('pointermove',e=>{if(!drag)return;e.preventDefault();const y=e.clientY;const sibs=[...drag.box.children].filter(c=>c.dataset.id&&c!==drag.row);
  let before=null;for(const s of sibs){const r=s.getBoundingClientRect();if(y<r.top+r.height/2){before=s;break}}
  if(before){if(drag.row.nextElementSibling!==before){drag.box.insertBefore(drag.row,before);drag.moved=true}}else if(sibs.length){const last=sibs[sibs.length-1];if(last.nextElementSibling!==drag.row){last.after(drag.row);drag.moved=true}}
  if(y<90)window.scrollBy(0,-10);else if(y>innerHeight-70)window.scrollBy(0,10)},{passive:false});
function endDrag(){if(!drag)return;const d=drag;drag=null;d.row.classList.remove('dragging');if(d.moved)finishReorder(d.box);else if(S.dirty){S.dirty=false;render()}}
document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
document.addEventListener('keydown',e=>{const h=e.target.closest&&e.target.closest('[data-handle]');if(!h||(e.key!=='ArrowUp'&&e.key!=='ArrowDown'))return;e.preventDefault();
  const row=h.closest('[data-id]');const box=row.parentElement;const sib=e.key==='ArrowUp'?row.previousElementSibling:row.nextElementSibling;if(!sib||!sib.dataset.id)return;
  if(e.key==='ArrowUp')box.insertBefore(row,sib);else sib.after(row);finishReorder(box,row.dataset.id)});

/* ---------- start ---------- */
Object.assign(ACT,{
  retry(){S.loadError='';render();refresh()},
  'app-settings':sheetAppSettings,
  'sync-now'(){closeSheet();if(dirty.size)pump();refresh();toast('Checking the sheet…')},
  'copy-setup'(){const t=setupLink();const fb=()=>openSheet(`${sheetHead('Your setup link')}<textarea class="in" id="copy-t" rows="5" readonly>${esc(t)}</textarea><small class="hint">Select it all and copy it. Open it on your other phone to connect it to the same sheet.</small>`,'#copy-t');
    try{navigator.clipboard.writeText(t).then(()=>{closeSheet();toast('Setup link copied')},fb)}catch(e){fb()}},
  'disconnect-ask'(){$('#dz').innerHTML=`<div class="confirm"><span>Disconnect this phone from ${esc(S.conn.name||'the sheet')}?${dirty.size?` ${dirty.size} unsaved change${dirty.size===1?'':'s'} will be lost.`:''}</span><div class="btns"><button class="btn danger" data-act="disconnect">Disconnect</button><button class="btn" data-act="close-sheet">Stay connected</button></div></div>`},
  disconnect(){closeSheet();store.del(CKEY);store.del(LKEY);S.conn=null;S.lists={};S.order=[];dirty.clear();S.ready=false;S.route={v:'home'};S.stack=[];render()}
});
FORM.connect=async f=>{const err=$('#conn-err'),btn=$('#conn-btn');err.textContent='';btn.disabled=true;btn.textContent='Connecting…';
  try{await connectTo(f.elements.u.value,f.elements.k.value);toast('Connected')}catch(e){if($('#conn-err')){$('#conn-err').textContent=e.message;btn.disabled=false;btn.textContent='Connect'}}};
async function init(){
  // A personal setup link (#connect=...) connects this phone in one tap. The part after # never leaves the phone.
  const m=location.hash.match(/^#connect=([A-Za-z0-9_-]+)/);
  if(m){history.replaceState(null,'',location.pathname+location.search);
    try{const c=JSON.parse(b64u.dec(m[1]));render();await connectTo(c.u,c.k);toast('Connected to '+(S.conn.name||'your sheet'))}
    catch(e){S.conn=store.get(CKEY);render();const el=$('#conn-err');if(el)el.textContent='That setup link did not work: '+e.message;else toast('That setup link did not work: '+e.message)}}
  else{S.ready=loadCache();if(S.conn){S.sync=dirty.size?'saving':'loading'}render();if(S.conn){if(dirty.size)pump();refresh()}}
  setInterval(()=>{if(S.conn&&document.visibilityState==='visible'){if(dirty.size)pump();refresh()}},60000);
  document.addEventListener('visibilitychange',()=>{if(S.conn&&document.visibilityState==='visible'){if(dirty.size)pump();refresh()}});
  window.addEventListener('hashchange',()=>{if(/^#connect=/.test(location.hash))location.reload()}); // setup link opened while the app is already open
  window.addEventListener('online',()=>{if(S.conn){if(dirty.size)pump();refresh()}});
  window.addEventListener('offline',()=>{if(S.sync==='error'||dirty.size)setSync('error')});
}
if('serviceWorker' in navigator){
  // When a new version has finished downloading, switch to it (the very first install needs no reload).
  let current=navigator.serviceWorker.controller,switching=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{const wasUpdate=!!current;current=navigator.serviceWorker.controller;
    if(!wasUpdate||switching||!$('#sheet').hidden)return;switching=true;cache();location.reload()});
  navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})})}).catch(()=>{});
}
init();
