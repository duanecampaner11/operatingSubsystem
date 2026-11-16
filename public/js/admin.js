(()=>{
const root=$('#app');let me=Session.user;const S={date:today(),data:null};
const start=()=>me&&me.role==='Administrator'?boot():(Session.clear(),renderLogin(root,{adminOnly:true,onLogin:u=>{me=u;start()}}));start();

function boot(){
  const tabs=[{id:'ov',label:'Dashboard',icon:'chart',render:v=>tab(v,ov)},{id:'ch',label:'Changes & Cancellations',icon:'cal',render:v=>tab(v,chg)},{id:'au',label:'Audit Log',icon:'shield',render:v=>tab(v,aud)},{id:'us',label:'Manage Accounts',icon:'team',render:users},{id:'pt',label:'Scheduling Portal',icon:'cal',render:()=>{location.href='index.html'}}];
  renderShell(root,{subtitle:'Administrator Console',user:me,tabs});
}
let first=true;
async function load(){S.data=await api('/api/admin/records?date='+S.date+(first?'&review=1':''));first=false}
function tab(v,fn){const paint=async()=>{try{await load();v.innerHTML=fn(S.data);wire(v,paint)}catch(e){v.innerHTML=`<div class="msg bad">${esc(e.message)}</div>`}};paint();window._poll=setInterval(()=>{if(!document.activeElement||document.activeElement.tagName!=='INPUT')paint()},20000)} // auto-refresh every 20 s
function wire(v,paint){const d=$('#dt',v);if(d)d.onchange=e=>{S.date=e.target.value;paint()};const r=$('#rf',v);if(r)r.onclick=paint}
const rows=l=>l.map(s=>`<tr><td><b>${s.startTime}–${s.endTime}</b></td><td>${esc(s.room)}</td><td>${esc(s.caseRef)}<br>${esc(s.patientName||s.patientAlias)}<br><small>${esc(s.patientAlias)}</small></td><td>${esc(s.procedureName)}</td><td>${badge(s.priority)}</td><td>${s.teamMembers.map(m=>esc(m.name)).join('<br>')||'—'}</td><td>${badge(s.status,'s-')}</td></tr>`).join('');
function ov(d){return `<div class="bar"><h2>Daily Dashboard</h2><div class="ctl"><input type="date" id="dt" value="${d.date}" style="width:auto"><button class="btn ghost" id="rf">Refresh</button></div></div>
 <div class="grid" style="margin-bottom:16px"><div class="kpi"><b>${d.stats.today}</b><span>Procedures on ${d.date}</span></div><div class="kpi"><b>${d.stats.totalSchedules}</b><span>Total schedules</span></div><div class="kpi"><b>${d.stats.totalCases}</b><span>Registered cases</span></div><div class="kpi"><b>${d.stats.rescheduled}</b><span>Rescheduled</span></div><div class="kpi"><b>${d.stats.cancelled}</b><span>Cancelled</span></div></div>
 ${d.alerts.length?`<div class="alert">${d.alerts.map(a=>`<div>${esc(a)}</div>`).join('')}</div>`:''}
 <div class="box"><h3>Daily OR schedule</h3><div class="tw"><table><tr><th>Time</th><th>Room</th><th>Case</th><th>Procedure</th><th>Priority</th><th>Team</th><th>Status</th></tr>${rows(d.dailySchedule)||'<tr><td colspan=7 class="muted">No procedures on this date.</td></tr>'}</table></div></div>
 <div class="box"><h3>Room-use summary</h3><div class="tw"><table><tr><th>Room</th><th>Status</th><th>Procedures</th><th>Booked</th><th>Utilization (07:00–19:00)</th></tr>${d.roomUse.map(r=>`<tr><td><b>${r.roomCode}</b> <small>${esc(r.roomName)}</small></td><td>${badge(r.status)}</td><td>${r.procedures}</td><td>${r.bookedMinutes} min</td><td><div class="bar2"><i style="width:${r.utilization}%"></i></div><small>${r.utilization}%</small></td></tr>`).join('')}</table></div></div>`}
const chg=d=>`<div class="bar"><h2>Change Report</h2><button class="btn ghost" id="rf">Refresh</button></div><div class="box"><div class="tw"><table><tr><th>Schedule</th><th>Date / time</th><th>Room</th><th>Case</th><th>Status</th><th>Reason</th><th>Updated</th></tr>${d.changes.map(s=>`<tr><td>${s.scheduleCode}</td><td>${s.date} ${s.startTime}–${s.endTime}</td><td>${esc(s.room)}</td><td>${esc(s.caseRef)}<br><small>${esc(s.procedureName)}</small></td><td>${badge(s.status,'s-')}</td><td>${esc(s.cancelReason||'')}</td><td><small>${new Date(s.updatedAt).toLocaleString()}</small></td></tr>`).join('')||'<tr><td colspan=7 class="muted">No changes or cancellations.</td></tr>'}</table></div></div>`;
const aud=d=>`<div class="bar"><h2>Audit Log</h2><button class="btn ghost" id="rf">Refresh</button></div><div class="box"><div class="tw"><table><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr>${d.audit.map(a=>`<tr><td><small>${new Date(a.timestamp).toLocaleString()}</small></td><td>${esc(a.user)}</td><td><span class="b">${esc(a.action)}</span></td><td>${esc(a.entityType)}</td><td>${esc(a.details||'')}</td><td><small>${esc(a.ipAddress||'')}</small></td></tr>`).join('')}</table></div></div>`;
function openDlg(title,body,label,go,after){
  let d=$('#dlg');if(!d){d=document.createElement('dialog');d.id='dlg';document.body.append(d)}
  d.innerHTML=`<form><h3 style="margin-bottom:12px">${title}</h3>${body}<div id="dm"></div><div class="ctl" style="justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" id="dx">Cancel</button><button class="btn ${label==='Delete'?'red':''}">${label}</button></div></form>`;
  d.showModal();$('#dx').onclick=()=>d.close();
  $('form',d).onsubmit=async e=>{e.preventDefault();try{const r=await go(Object.fromEntries(new FormData(e.target)));d.close();toast(r.message);after()}catch(x){$('#dm').innerHTML=`<div class="msg bad">${esc(x.message)}</div>`}}}
async function users(v){
  v.innerHTML=`<div class="box"><h3>Create account</h3><form id="uf" class="g2"><div><label>Full name</label><input type="text" name="fullName"></div><div><label>Username</label><input type="text" name="username"></div><div><label>Password (min 6)</label><input type="password" name="password"></div>
  <div><label>Role</label><select name="role"><option value="Scheduler">Scheduler</option><option value="SurgicalStaff">Surgical staff (surgeon / anesthesia / nurse)</option><option value="Administrator">Administrator</option></select></div><div class="full"><button class="btn">Create account</button></div></form><div id="um"></div></div>
  <div class="box"><h3>Manage accounts</h3><div class="tw" id="ul"></div></div>`;
  let list=[];const mine=u=>u.username===me.username;
  const draw=async()=>{list=await api('/api/admin/users');
    $('#ul',v).innerHTML=`<table><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr>${list.map(u=>`<tr><td><b>${esc(u.username)}</b>${mine(u)?' <small>(you)</small>':''}</td><td>${esc(u.fullName)}</td><td><span class="b">${u.role}</span></td><td>${badge(u.status)}</td><td><small>${new Date(u.createdAt).toLocaleDateString()}</small></td>
    <td style="white-space:nowrap"><button class="btn sm ghost" data-ed="${u.id}">Edit</button> <button class="btn sm ghost" data-pw="${u.id}">Reset password</button> ${mine(u)?'':`<button class="btn sm red" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}</table>`;
    const get=id=>list.find(u=>u.id===id);
    $$('[data-ed]',v).forEach(b=>b.onclick=()=>{const u=get(b.dataset.ed),lock=mine(u)?'disabled':'';
      openDlg('Edit '+esc(u.username),`<div class="g2"><div class="full"><label>Full name</label><input type="text" name="fullName" value="${esc(u.fullName)}"></div>
      <div><label>Role</label><select name="role" ${lock}>${['Administrator','Scheduler','SurgicalStaff'].map(r=>`<option ${r===u.role?'selected':''}>${r}</option>`).join('')}</select></div>
      <div><label>Status</label><select name="status" ${lock}>${['Active','Inactive'].map(s=>`<option ${s===u.status?'selected':''}>${s}</option>`).join('')}</select></div></div>${lock?'<p class="muted" style="margin-top:8px">You cannot change your own role or status.</p>':''}`,'Save changes',b2=>put('/api/admin/users/'+u.id,b2),draw)});
    $$('[data-pw]',v).forEach(b=>b.onclick=()=>{const u=get(b.dataset.pw);
      openDlg('Reset password for '+esc(u.username),'<label>New password (min 6)</label><input type="password" name="password" autocomplete="new-password">','Reset password',b2=>put('/api/admin/users/'+u.id,{password:b2.password}),draw)});
    $$('[data-del]',v).forEach(b=>b.onclick=()=>{const u=get(b.dataset.del);
      openDlg('Delete account',`<p>Delete <b>${esc(u.username)}</b> (${esc(u.fullName)})? This cannot be undone. Accounts linked to cases or schedules cannot be deleted; set them to Inactive instead.</p>`,'Delete',()=>api('/api/admin/users/'+u.id,{method:'DELETE'}),draw)})};
  draw().catch(e=>toast(e.message,'bad'));
  $('#uf',v).onsubmit=async e=>{e.preventDefault();try{const r=await post('/api/admin/users',Object.fromEntries(new FormData(e.target)));$('#um',v).innerHTML=`<div class="msg ok">${esc(r.message)}</div>`;e.target.reset();draw()}catch(x){$('#um',v).innerHTML=`<div class="msg bad">${esc(x.message)}</div>`}}}
})();
