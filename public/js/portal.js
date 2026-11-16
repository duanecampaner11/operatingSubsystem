(()=>{
const root=$('#app');let me=Session.user;const S={date:today(),rooms:[],staff:[],equip:[],cases:[],patients:[]};
const start=()=>me?boot():renderLogin(root,{onLogin:u=>{me=u;start()}});start();

async function boot(){
  const canEdit=['Administrator','Scheduler'].includes(me.role);
  try{[S.rooms,S.staff,S.equip,S.cases,S.patients]=await Promise.all([api('/api/rooms?date='+S.date),api('/api/staff'),api('/api/equipment'),api('/api/cases'),api('/api/patients')])}catch(e){toast(e.message,'bad')}
  const tabs=[{id:'sch',label:'Surgical Schedule',icon:'cal',render:tabSchedule},{id:'rooms',label:'Rooms & Availability',icon:'room',render:tabRooms},{id:'pat',label:'Patients',icon:'user',render:tabPatients},{id:'cases',label:'Cases',icon:'doc',render:tabCases}];
  if(canEdit)tabs.push({id:'new',label:'Schedule Procedure',icon:'plus',render:tabNew});
  if(me.role==='Administrator')tabs.push({id:'adm',label:'Admin Console (Accounts, Reports, Audit)',icon:'shield',render:()=>{location.href='admin.html'}});
  window.openTab=renderShell(root,{subtitle:'Operating Room & Surgical Scheduling',user:me,tabs});
  const d=document.createElement('dialog');d.id='dlg';document.body.append(d);
}
const dateBar=(title,load)=>`<div class="bar"><h2>${title}</h2><div class="ctl"><button class="btn ghost" id="pv">‹</button><input type="date" id="dt" value="${S.date}" style="width:auto"><button class="btn ghost" id="nx">›</button></div></div>`;
function wireDate(el,load){const set=v=>{S.date=v;$('#dt',el).value=v;load()};
  $('#dt',el).onchange=e=>e.target.value&&set(e.target.value);
  const sh=n=>{const d=new Date(S.date+'T00:00:00');d.setDate(d.getDate()+n);set(fmtDate(d))};$('#pv',el).onclick=()=>sh(-1);$('#nx',el).onclick=()=>sh(1)}
const canEdit=()=>['Administrator','Scheduler'].includes(me.role);

// ------------ Surgical schedule (day view grouped by room) ------------
async function tabSchedule(el){
  el.innerHTML=dateBar('Surgical Schedule')+'<div id="al"></div><div id="ls" class="stack"></div>';const cache={};
  const load=async()=>{try{
    const [sch,rooms]=await Promise.all([api('/api/schedules?date='+S.date),api('/api/rooms?date='+S.date)]);S.rooms=rooms;
    const al=[];rooms.forEach(r=>{if(r.status!=='Active')al.push(`${r.roomCode} is ${r.status.toLowerCase()}`);r.availability.filter(a=>a.availabilityType!=='Available').forEach(a=>al.push(`${r.roomCode}: ${a.availabilityType.toLowerCase()} ${a.startTime}–${a.endTime} ${a.notes||''}`))});
    sch.filter(s=>s.priority==='Emergency'&&!['Cancelled','Completed'].includes(s.status)).forEach(s=>al.push(`Emergency case ${s.caseRef} in ${s.room} at ${s.startTime}`));
    $('#al',el).innerHTML=al.length?`<div class="alert">${al.map(a=>`<div>${esc(a)}</div>`).join('')}</div>`:'';
    sch.forEach(s=>cache[s.id]=s);
    $('#ls',el).innerHTML=rooms.map(r=>{const l=sch.filter(s=>s.room===r.roomCode);return `<div class="box"><h3><span>${esc(r.roomCode)} · ${esc(r.roomName)} <small>${esc(r.specialty||'')}</small></span>${badge(r.status)}</h3>`+
      (l.length?`<div class="tw"><table><tr><th>Time</th><th>Case</th><th>Procedure</th><th>Priority</th><th>Team</th><th>Equipment</th><th>Status</th>${canEdit()?'<th></th>':''}</tr>${l.map(s=>`<tr><td><b>${s.startTime}–${s.endTime}</b><br><small>${s.durationMinutes} min</small></td><td>${esc(s.caseRef)}<br>${esc(s.patientName||s.patientAlias)}<br><small>${esc(s.patientCode||'')} ${esc(s.patientAlias)}</small></td><td>${esc(s.procedureName)}<br><small>${s.scheduleCode}</small></td><td>${badge(s.priority)}</td><td>${s.teamMembers.map(m=>`${esc(m.name)} <small>(${esc(m.role)})</small>`).join('<br>')||'<small>—</small>'}</td><td>${s.equipment.map(e=>`${esc(e.name)} ×${e.quantity}`).join('<br>')||'<small>—</small>'}</td><td>${badge(s.status,'s-')}${s.cancelReason?`<br><small>${esc(s.cancelReason)}</small>`:''}</td>${canEdit()?`<td>${['Scheduled','Rescheduled'].includes(s.status)?`<button class="btn sm ghost" data-e="${s.id}">Edit / Move / Cancel</button>`:''}</td>`:''}</tr>`).join('')}</table></div>`:'<p class="muted">No procedures scheduled.</p>')+'</div>'}).join('');
    $$('[data-e]',el).forEach(b=>b.onclick=()=>editDlg(cache[b.dataset.e],load));
  }catch(e){$('#ls',el).innerHTML=`<div class="msg bad">${esc(e.message)}</div>`}};
  wireDate(el,load);load()}

function editDlg(s,reload){
  const d=$('#dlg');d.innerHTML=`<form id="ef"><h3 style="margin-bottom:4px">${s.scheduleCode} · ${esc(s.caseRef)}</h3><p class="muted" style="margin-bottom:14px">${esc(s.procedureName)}</p>
  <div class="g2"><div class="full"><label>Action</label><select id="ac"><option value="update">Update details</option><option value="reschedule">Reschedule</option><option value="cancel">Cancel procedure</option><option value="complete">Mark completed</option></select></div>
  <div><label>Room</label><select id="er">${S.rooms.map(r=>`<option value="${r.roomCode}" ${r.roomCode===s.room?'selected':''}>${r.roomCode} (${esc(r.status)})</option>`).join('')}</select></div>
  <div><label>Date</label><input type="date" id="ed" value="${s.date}"></div><div><label>Start time</label><input type="time" id="es" value="${s.startTime}"></div>
  <div><label>Duration (min)</label><input type="number" id="eu" min="15" max="720" value="${s.durationMinutes}"></div>
  <div><label>Priority</label><select id="ep">${['Elective','Urgent','Emergency'].map(p=>`<option ${p===s.priority?'selected':''}>${p}</option>`).join('')}</select></div>
  <div class="full"><label>Reason (required for cancel)</label><input type="text" id="rs" placeholder="e.g. Patient not fit for surgery"></div></div>
  <div id="em"></div><div class="ctl" style="justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" id="xx">Close</button><button class="btn">Save change</button></div></form>`;
  d.showModal();$('#xx').onclick=()=>d.close();
  $('#ef').onsubmit=async e=>{e.preventDefault();try{const r=await put('/api/schedules/'+s.id,{action:$('#ac').value,roomId:$('#er').value,date:$('#ed').value,startTime:$('#es').value,durationMinutes:+$('#eu').value,priority:$('#ep').value,cancelReason:$('#rs').value});d.close();toast(r.message);reload()}catch(x){$('#em').innerHTML=`<div class="msg bad">${esc(x.message)}</div>`}}}

// ------------ Rooms & availability ------------
async function tabRooms(el){
  el.innerHTML=dateBar('Room Availability')+'<div id="rl" class="g2"></div>'+(canEdit()?`<div class="box" style="margin-top:16px"><h3>Record room hours / maintenance / blocked period</h3><form id="af" class="g2">
  <div><label>Room</label><select name="roomId">${S.rooms.map(r=>`<option value="${r.roomCode}">${r.roomCode} – ${esc(r.specialty||r.roomName)}</option>`).join('')}</select></div><div><label>Date</label><input type="date" name="date" value="${S.date}"></div>
  <div><label>Start</label><input type="time" name="startTime" value="07:00"></div><div><label>End</label><input type="time" name="endTime" value="19:00"></div>
  <div><label>Type</label><select name="availabilityType"><option>Available</option><option>Maintenance</option><option>Blocked</option></select></div><div><label>Notes</label><input type="text" name="notes"></div>
  <div class="full"><button class="btn">Save availability</button></div></form><div id="am"></div></div>`:'');
  const load=async()=>{try{S.rooms=await api('/api/rooms?date='+S.date);
    $('#rl',el).innerHTML=S.rooms.map(r=>`<div class="box" style="margin:0"><h3><span>${esc(r.roomCode)} <small>${esc(r.location||'')}</small></span>${badge(r.status)}</h3><p class="muted" style="margin-bottom:8px">${esc(r.roomName)} · ${esc(r.specialty||'')}</p>
    <label>Open slots</label>${r.openSlots.map(x=>`<span class="slot">${x}</span>`).join('')||'<small>None</small>'}
    <label style="margin-top:8px">Booked</label>${r.bookings.map(b=>`<span class="slot x">${b.startTime}–${b.endTime}</span>`).join('')||'<small>None</small>'}
    ${r.availability.length?`<label style="margin-top:8px">Entries</label>${r.availability.map(a=>`<div>${badge(a.availabilityType)} ${a.startTime}–${a.endTime} <small>${esc(a.notes||'')}</small></div>`).join('')}`:''}</div>`).join('')}catch(e){toast(e.message,'bad')}};
  wireDate(el,load);load();
  const f=$('#af',el);if(f)f.onsubmit=async e=>{e.preventDefault();try{const r=await post('/api/availability',Object.fromEntries(new FormData(f)));$('#am',el).innerHTML=`<div class="msg ok">${esc(r.message)}</div>`;S.date=f.date.value;$('#dt',el).value=S.date;load()}catch(x){$('#am',el).innerHTML=`<div class="msg bad">${esc(x.message)}</div>`}}}

// ------------ Patients ------------
async function tabPatients(el){
  S.patients=await api('/api/patients').catch(()=>S.patients);
  el.innerHTML=(canEdit()?`<div class="box"><h3>Register patient</h3><form id="pf" class="g2"><div><label>First name *</label><input type="text" name="firstName"></div><div><label>Last name *</label><input type="text" name="lastName"></div>
  <div><label>Age</label><input type="number" name="age" min="0" max="120"></div><div><label>Sex</label><select name="sex"><option value="">—</option><option>Male</option><option>Female</option></select></div><div><label>Contact number</label><input type="text" name="contactNumber"></div>
  <div class="full"><button class="btn">Save patient</button></div></form><div id="pm"></div></div>`:'')+'<div class="box"><h3>Patient records <input type="text" id="ps" placeholder="Search name, ID or initials" style="max-width:280px"></h3><div class="tw" id="pt"></div></div>';
  const draw=()=>{const q=($('#ps',el).value||'').toLowerCase();const l=S.patients.filter(p=>[p.fullName,p.patientCode,p.initials].join(' ').toLowerCase().includes(q));
    $('#pt',el).innerHTML=`<table><tr><th>Patient ID</th><th>Full name</th><th>Initials</th><th>Age</th><th>Sex</th><th>Contact</th><th>Linked cases</th></tr>${l.map(p=>`<tr><td><b>${esc(p.patientCode)}</b></td><td>${esc(p.fullName)}</td><td>${esc(p.initials)}</td><td>${p.age??''}</td><td>${esc(p.sex||'')}</td><td>${esc(p.contactNumber||'')}</td><td>${p.cases.map(c=>`<span class="b" title="${esc(c.procedureName)}">${esc(c.caseRef)}</span> `).join('')||'<small>None</small>'}</td></tr>`).join('')||'<tr><td colspan=7 class="muted">No patients found.</td></tr>'}</table>`};
  draw();$('#ps',el).oninput=draw;
  const f=$('#pf',el);if(f)f.onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(f));b.age=b.age===''?null:+b.age;
    try{const r=await post('/api/patients',b);$('#pm',el).innerHTML=`<div class="msg ok">${esc(r.message)}</div>`;f.reset();S.patients=await api('/api/patients');draw()}catch(x){$('#pm',el).innerHTML=`<div class="msg bad">${esc(x.message)}</div>`}}}

// ------------ Cases ------------
async function tabCases(el){
  [S.cases,S.patients]=await Promise.all([api('/api/cases'),api('/api/patients')]).catch(()=>[S.cases,S.patients]);
  el.innerHTML=(canEdit()?`<div class="box"><h3>Register case</h3><form id="cf" class="g2"><div><label>Case reference *</label><input type="text" name="caseRef" placeholder="CASE-2026-0147"></div>
  <div><label>Patient * <small>(register patients in the Patients tab)</small></label><select name="patientId">${S.patients.map(p=>`<option value="${p.id}">${esc(p.fullName)} · ${esc(p.patientCode)} · ${p.age??'?'} y/o</option>`).join('')||'<option value="">No patients yet</option>'}</select></div>
  <div><label>Urgency</label><select name="urgency"><option>Elective</option><option>Urgent</option><option>Emergency</option></select></div>
  <div><label>Procedure *</label><input type="text" name="procedureName" placeholder="Laparoscopic cholecystectomy"></div><div><label>Diagnosis</label><input type="text" name="diagnosis"></div>
  <div class="full"><button class="btn">Save case</button></div></form><div id="cm"></div></div>`:'')+'<div class="box"><h3>Registered cases</h3><div class="tw" id="ct"></div></div>';
  const draw=()=>$('#ct',el).innerHTML=`<table><tr><th>Case ref</th><th>Patient</th><th>Age</th><th>Procedure</th><th>Diagnosis</th><th>Urgency</th></tr>${S.cases.map(c=>`<tr><td><b>${esc(c.caseRef)}</b></td><td>${esc(c.patientName||c.patientAlias)}<br><small>${esc(c.patientCode||'')} · ${esc(c.patientAlias)}</small></td><td>${c.age??''}</td><td>${esc(c.procedureName)}</td><td>${esc(c.diagnosis||'')}</td><td>${badge(c.urgency)}</td></tr>`).join('')||'<tr><td colspan=6 class="muted">No cases yet.</td></tr>'}</table>`;draw();
  const f=$('#cf',el);if(f)f.onsubmit=async e=>{e.preventDefault();
    try{const r=await post('/api/cases',Object.fromEntries(new FormData(f)));$('#cm',el).innerHTML=`<div class="msg ok">${esc(r.message)}</div>`;f.reset();S.cases=await api('/api/cases');draw()}catch(x){$('#cm',el).innerHTML=`<div class="msg bad">${esc(x.message)}</div>`}}}

// ------------ Schedule a procedure ------------
async function tabNew(el){
  S.cases=await api('/api/cases').catch(()=>S.cases);const so=r=>`<option value="">— none —</option>`+S.staff.map(s=>`<option value="${s.id}">${esc(s.fullName)}</option>`).join('');
  el.innerHTML=`<div class="box"><h3>Schedule a procedure</h3><form id="sf" class="g2">
  <div><label>Case *</label><select name="caseRef">${S.cases.map(c=>`<option value="${esc(c.caseRef)}">${esc(c.caseRef)} – ${esc(c.patientName||c.patientAlias)} – ${esc(c.procedureName)}</option>`).join('')||'<option value="">Register a case first</option>'}</select></div>
  <div><label>Room *</label><select name="roomId">${S.rooms.map(r=>`<option value="${r.roomCode}">${r.roomCode} – ${esc(r.specialty||'')} (${esc(r.status)})</option>`).join('')}</select></div>
  <div><label>Date *</label><input type="date" name="date" value="${S.date}"></div><div><label>Start time *</label><input type="time" name="startTime" value="08:00"></div>
  <div><label>Duration (minutes) *</label><input type="number" name="durationMinutes" value="90" min="15" max="720"></div><div><label>Priority</label><select name="priority"><option>Elective</option><option>Urgent</option><option>Emergency</option></select></div>
  <div><label>Surgeon</label><select name="m_Surgeon">${so()}</select></div><div><label>Anesthesia staff</label><select name="m_Anesthesiologist">${so()}</select></div><div><label>Nurse</label><select name="m_Nurse">${so()}</select></div>
  <div class="full"><label>Required equipment</label><div class="g2">${S.equip.map((q,i)=>`<label style="font-weight:500"><input type="checkbox" data-eq="${esc(q.name)}"> ${esc(q.name)} <small>(${q.total} available)</small> <input type="number" min="1" max="${q.total}" value="1" style="width:64px;display:inline-block;padding:4px 8px" data-q="${i}"></label>`).join('')}</div></div>
  <div class="full"><button class="btn">Save schedule</button></div></form><div id="sm"></div></div>`;
  const f=$('#sf',el);f.onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));
    const team=['Surgeon','Anesthesiologist','Nurse'].filter(r=>v['m_'+r]).map(r=>({userId:v['m_'+r],role:r}));
    const equipment=$$('[data-eq]',f).filter(c=>c.checked).map(c=>({name:c.dataset.eq,quantity:+c.parentElement.querySelector('[data-q]').value}));
    try{const r=await post('/api/schedules',{caseRef:v.caseRef,roomId:v.roomId,date:v.date,startTime:v.startTime,durationMinutes:+v.durationMinutes,priority:v.priority,teamMembers:team,equipment});
      $('#sm',el).innerHTML=`<div class="msg ok">${esc(r.message)} (${r.scheduleId} · ${r.room} · ${r.status})</div>`;S.date=v.date;toast('Schedule saved')}
    catch(x){$('#sm',el).innerHTML=`<div class="msg bad">${x.status===409?'⚠ Scheduling conflict: ':''}${esc(x.message)}</div>`}}}
})();
