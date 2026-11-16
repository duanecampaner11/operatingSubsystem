const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ICONS={user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',room:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
team:'<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-4 3-6 7-6s7 2 7 6M17 5a3.5 3.5 0 010 7M22 20c0-3-2-5-4-5.5"/>',chart:'<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',heart:'<path d="M12 21C5 15.5 2 12 2 8.5A5 5 0 0112 6a5 5 0 0110 2.5C22 12 19 15.5 12 21z"/><path d="M6 12h3l2-4 3 7 2-3h2"/>',
pulse:'<path d="M2 12h5l2-6 4 12 2-6h7"/>',doc:'<path d="M6 3h8l4 4v14H6z"/><path d="M9 12h6M9 16h6"/>',plus:'<path d="M12 5v14M5 12h14"/>',logout:'<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>'};
const ic=(n,z=20)=>`<svg class="ic" width="${z}" height="${z}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
const fmtDate=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=()=>fmtDate(new Date());
const Session={get user(){try{return JSON.parse(sessionStorage.getItem('or_user'))}catch{return null}},set(u){sessionStorage.setItem('or_user',JSON.stringify(u));sessionStorage.setItem('or_token',u.token)},clear(){sessionStorage.clear()}};
function toast(m,t='ok'){let e=$('#toast');if(!e){e=document.createElement('div');e.id='toast';document.body.append(e)}e.className='toast '+t+' show';e.textContent=m;clearTimeout(e._h);e._h=setTimeout(()=>e.classList.remove('show'),4500)}
async function api(path,opt={}){
  const h={'Content-Type':'application/json'},t=sessionStorage.getItem('or_token');if(t)h.Authorization='Bearer '+t;
  let r;try{r=await fetch(path,{...opt,headers:h})}catch{throw new Error('Cannot reach the server. Check the web address and that the server is running on port 5050.')}
  const d=await r.json().catch(()=>({}));
  if(r.status===401&&t){Session.clear();alert('Your session expired. Please sign in again.');location.reload()}
  if(!r.ok)throw Object.assign(new Error(d.message||'Request failed ('+r.status+')'),{status:r.status});return d}
const post=(p,b)=>api(p,{method:'POST',body:JSON.stringify(b)}),put=(p,b)=>api(p,{method:'PUT',body:JSON.stringify(b)});

function renderLogin(root,{adminOnly=false,onLogin}){
  root.innerHTML=`<div class="auth"><section class="hero"><span class="pill">Asian Development Foundation College</span>
  <h1>SurgiSchedule <em>OR</em></h1><h2>${adminOnly?'Administrator Console — Schedules, Reports & Audit Trail':'Operating Room &amp; Surgical Scheduling System'}</h2>
  <p class="tag"><b>Better scheduling. Safer surgeries.</b><br>Manage room availability, surgical cases, teams and equipment all in one place.</p>
  <div class="tiles"><div class="tile">${ic('room',34)}Room<br>Availability</div><div class="tile">${ic('cal',34)}Procedure<br>Scheduling</div><div class="tile">${ic('team',34)}Team &amp;<br>Equipment</div><div class="tile">${ic('chart',34)}Reports &amp;<br>Audit Trail</div></div>
  <p class="sub">Subsystem of the Integrated Hospital Information System · integrates with MedRecords HIS (patients) and MediAdmit (admissions)</p></section>
  <section class="panel"><form class="card" id="lf" autocomplete="off"><div class="logo">${ic('heart',64)}</div><h3>SurgiSchedule OR</h3><p class="lead">${adminOnly?'Administrator sign-in':'Access for Better Scheduling'}</p>
  <div class="pulse">${ic('pulse',26)}</div>
  <div class="field">${ic('user')}<input id="u" placeholder="Employee ID or Username" required></div>
  <div class="field">${ic('lock')}<input id="p" type="password" placeholder="Password" required><button type="button" class="show" id="sh">Show</button></div>
  <div class="row"><label style="margin:0;font-weight:400"><input type="checkbox" id="rm"> Remember me</label><a id="fg">Forgot password?</a></div>
  <div class="err" id="er"></div><button class="btn big" id="go">${ic('logout',22)} Sign In</button>
  <div class="or">or</div><button type="button" class="btn out" id="ca">${ic('shield',18)} Contact Administrator</button>
  <div class="notice">🔒 Access is restricted to authorized hospital personnel. All sign-ins are recorded in the Audit Trail.</div>
  <div class="stat"><i class="dot" id="dot"></i><span id="st">Checking server…</span></div></form></section></div>`;
  $('#sh').onclick=()=>{const p=$('#p');p.type=p.type==='password'?'text':'password';$('#sh').textContent=p.type==='password'?'Show':'Hide'};
    $('#ca').onclick=$('#fg').onclick=()=>toast('Please contact the system administrator to create or reset your account.','ok');
  api('/api/health').then(h=>{$('#dot').className='dot '+(h.databaseConnected?'on':'off');$('#st').textContent=h.databaseConnected?'Server online · Database connected':'Server online · Database unavailable'}).catch(()=>{$('#dot').className='dot off';$('#st').textContent='Server unreachable'});
  $('#lf').onsubmit=async e=>{e.preventDefault();$('#er').textContent='';$('#go').disabled=true;
    try{const r=await post('/api/auth/login',{username:$('#u').value,password:$('#p').value});
      if(adminOnly&&r.role!=='Administrator')throw new Error('Administrator access is required for this page.');
      Session.set(r);onLogin(r)}catch(x){$('#er').textContent=x.message}finally{$('#go').disabled=false}}}

function renderShell(root,{subtitle,user,tabs}){
  root.innerHTML=`<header class="top"><div class="brand"><span class="logo">${ic('heart',34)}</span><div>SurgiSchedule OR<small>${subtitle}</small></div></div><div class="who"><span>${esc(user.fullName)} · ${esc(user.role)}</span><button class="btn sm" id="lo">Sign out</button></div></header>
  <nav class="tabs">${tabs.map(t=>`<button data-id="${t.id}">${ic(t.icon,18)}${t.label}</button>`).join('')}</nav><main id="view"></main>`;
  $('#lo').onclick=()=>{Session.clear();location.reload()};
  const open=id=>{$$('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.id===id));const t=tabs.find(x=>x.id===id);const v=$('#view');v.innerHTML='';clearInterval(window._poll);t.render(v)};
  $$('.tabs button').forEach(b=>b.onclick=()=>open(b.dataset.id));open(tabs[0].id);return open}
const badge=(t,p='b-')=>`<span class="b ${p}${esc(String(t).split(' ')[0])}">${esc(t)}</span>`;
