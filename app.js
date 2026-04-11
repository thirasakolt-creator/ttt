// ============================================================
//  MANEECHAN RESORT — app.js  v3.0
//  + routine กะเช้า/เที่ยง/ดึกเต็มรูปแบบ
//  + afternoon log, chlorine rotation, VIP dashboard
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbzX4_G2astabG-Njqbn3yEzMCnSSABRmaJvHE349FXazLwAckLLMLglOkeGFcjsMttt/exec";

const state = {
  currentUser:null, currentShift:null,
  repairs:[], filter:"all",
  selectedRepair:null, selectedStatus:null,
  pinBuffer:"", users:[], routineHasItems:false,
  afterPhotoB64:null, imgUrlCache:{},
  autoLogoutTimer:null,
  afternoonPhotos:[],       // รูปกะเที่ยง (หลายรูป)
  nextEndpointPoint:null,   // จุดตรวจคลอรีนวันนี้
};

const K={
  SESSION:"mcr_session", REPAIRS:"mcr_repairs_v2", USERS:"mcr_users_v2",
  ROUTINE_DONE:"mcr_routine_done", QUEUE:"mcr_queue", LOGGED_TODAY:"mcr_logged_today",
};

function store(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function load(k,d=null){try{const r=localStorage.getItem(k);return r?JSON.parse(r):d;}catch(e){return d;}}

function enqueue(action,params){
  const q=load(K.QUEUE,[]); q.push({action,params,ts:Date.now()}); store(K.QUEUE,q);
}
async function flushQueue(){
  const q=load(K.QUEUE,[]); if(!q.length) return;
  const rem=[];
  for(const item of q){
    try{const r=await api({action:item.action,...item.params}); if(!r.success&&!r.duplicate) rem.push(item);}
    catch(e){rem.push(item);}
  }
  store(K.QUEUE,rem);
}

async function api(params){
  const qs=new URLSearchParams(params).toString();
  const r=await fetch(`${API_URL}?${qs}`);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function uploadPhotoAPI(b64,filename){
  const body=new URLSearchParams({action:"uploadPhoto",filename,data:b64});
  const r=await fetch(API_URL,{method:"POST",body});
  return r.json();
}

// ── Sync Dot ──
function setSyncStatus(s){
  const dot=document.getElementById("sync-dot"); if(!dot) return;
  dot.className="sync-dot "+s;
}

// ── Utils ──
function showToast(msg,type=""){
  const t=document.getElementById("toast");
  t.textContent=msg; t.className=`toast ${type}`; t.classList.remove("hidden");
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.classList.add("hidden"),2500);
}
function getShiftLabel(s){return{morning:"กะเช้า 🌅",afternoon:"กะเที่ยง ☀️",night:"กะดึก 🌙"}[s]||s;}
function getShiftIcon(s){return{morning:"🌅",afternoon:"☀️",night:"🌙"}[s]||"🔧";}
function detectAvailableShifts(){
  const h=new Date().getHours();
  if(h>=6&&h<12) return ["morning","afternoon"];
  if(h>=12&&h<18) return ["afternoon","night"];
  return ["afternoon","night"];
}
function getTodayStr(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function normalizeYear(s){
  if(!s) return s;
  const parts=String(s).split("-"); if(parts.length!==3) return s;
  let y=parseInt(parts[0]); if(y>2400) y-=543;
  return `${y}-${parts[1]}-${parts[2]}`;
}
function getCurrentYear(){return new Date().getFullYear();}
function isTuesday(){return new Date().getDay()===2;}
function roleLabel(r){return{admin:"Admin",manager:"ผู้จัดการ",head_tech:"หัวหน้าช่าง",technician:"ช่าง"}[r]||r;}
function isVIP(r){return["admin","manager","head_tech"].includes(r);}
function getInitial(n){return n?n.charAt(0).toUpperCase():"?";}
function showScreen(id){document.querySelectorAll(".screen").forEach(s=>s.classList.add("hidden"));document.getElementById(id).classList.remove("hidden");}
function showMainPanel(id){document.querySelectorAll(".main-content").forEach(p=>p.classList.add("hidden"));const el=document.getElementById(id);if(el)el.classList.remove("hidden");}

function getDriveUrl(path){
  if(!path) return null;
  if(state.imgUrlCache[path]) return state.imgUrlCache[path];
  let fileId=null;
  const m1=path.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const m2=path.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if(m1) fileId=m1[1]; else if(m2) fileId=m2[1];
  if(!fileId) return null;
  const url=`https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  state.imgUrlCache[path]=url; return url;
}

// ── Routine Done ──
function routineKey(shift,date){return`${shift}_${date}`;}
function isRoutineDoneToday(shift){const done=load(K.ROUTINE_DONE,{});return!!done[routineKey(shift,getTodayStr())];}
function markRoutineDone(shift,doneBy){
  const today=getTodayStr(), done=load(K.ROUTINE_DONE,{});
  done[routineKey(shift,today)]={done_by:doneBy,ts:Date.now()};
  const cutoff=Date.now()-7*86400000;
  Object.keys(done).forEach(k=>{if(done[k].ts<cutoff)delete done[k];});
  store(K.ROUTINE_DONE,done);
}

// ── Logged Today ──
function getLoggedTodayLocal(){const obj=load(K.LOGGED_TODAY,{date:"",user_ids:[]});return obj.date===getTodayStr()?obj.user_ids||[]:[]; }
function addLoggedTodayLocal(uid){
  const today=getTodayStr(), obj=load(K.LOGGED_TODAY,{date:today,user_ids:[]});
  if(obj.date!==today){obj.date=today;obj.user_ids=[];}
  if(!obj.user_ids.includes(uid)) obj.user_ids.push(uid);
  store(K.LOGGED_TODAY,obj);
}

// ── Permission ──
function canManage(myRole,targetRole){
  const ranks={admin:3,manager:2,head_tech:1,technician:0};
  const my=ranks[myRole]||0, tgt=ranks[targetRole]||0;
  if(tgt>=my||myRole==="technician") return{toggle:false,del:false};
  return{toggle:true,del:true};
}
function canAddUser(r){return["admin","manager","head_tech"].includes(r);}
function creatableRoles(r){
  if(r==="admin") return["technician","head_tech","manager"];
  if(r==="manager") return["technician","head_tech"];
  if(r==="head_tech") return["technician"];
  return[];
}

// ── Auto Logout ──
function setupAutoLogout(shift){
  clearTimeout(state.autoLogoutTimer);
  if(!shift||isVIP(state.currentUser?.role)) return;
  const now=new Date(), target=new Date(now);
  target.setDate(target.getDate()+1);
  target.setHours(shift==="night"?12:3,0,0,0);
  const ms=target.getTime()-now.getTime();
  if(ms>0) state.autoLogoutTimer=setTimeout(()=>{showToast("หมดเวลากะ — ออกจากระบบ",""); setTimeout(()=>doLogout(),2000);},ms);
}

// ============================================================
//  SPLASH
// ============================================================
window.addEventListener("DOMContentLoaded",async()=>{
  const session=load(K.SESSION);
  await new Promise(r=>setTimeout(r,1500));
  document.getElementById("splash").style.display="none";
  if(session){state.currentUser=session;enterApp(session.savedShift||null,true);}
  else{showScreen("screen-login");loadUserList();}
});

// ============================================================
//  LOGIN
// ============================================================
async function loadUserList(){
  const grid=document.getElementById("user-list");
  const cached=load(K.USERS,[]); state.users=cached; renderUserGrid(cached);
  try{const res=await api({action:"getUsers"});if(res.success){state.users=res.users;store(K.USERS,res.users);renderUserGrid(res.users);}}catch(e){}
}
function renderUserGrid(users){
  const grid=document.getElementById("user-list");
  const techs=users.filter(u=>u.is_active&&u.role==="technician");
  if(!techs.length){grid.innerHTML=`<div class="user-loading" style="grid-column:1/-1;text-align:center;line-height:2">ยังไม่มีช่างในระบบ<br><small style="opacity:0.5">ใช้ปุ่มเข้าด้วยรหัสผ่านด้านล่าง</small></div>`;return;}
  grid.innerHTML=techs.map(u=>`<div class="user-card" data-uid="${u.user_id}"><div class="uc-avatar">${getInitial(u.name)}</div><div class="uc-name">${u.name}</div><div class="uc-role">${roleLabel(u.role)}</div></div>`).join("");
  grid.querySelectorAll(".user-card").forEach(card=>{card.addEventListener("click",()=>{const user=state.users.find(u=>u.user_id===card.dataset.uid);if(user)onUserSelected(user);});});
}
function onUserSelected(user){
  state.currentUser=user;
  if(user.role==="admin"){store(K.SESSION,user);enterApp(null,false);return;}
  showShiftPicker(user);
}
function showShiftPicker(user){
  const shifts=detectAvailableShifts();
  const container=document.getElementById("shift-picker-btns");
  container.innerHTML=shifts.map(s=>`<button class="btn-primary shift-pick-btn" data-shift="${s}">${getShiftIcon(s)} ${getShiftLabel(s)}</button>`).join("");
  container.querySelectorAll(".shift-pick-btn").forEach(btn=>{btn.addEventListener("click",()=>{closeShiftPicker();finishLogin(user,btn.dataset.shift);});});
  document.getElementById("modal-shift-picker").classList.remove("hidden");
}
function closeShiftPicker(){document.getElementById("modal-shift-picker").classList.add("hidden");}
function finishLogin(user,shift){
  const sessionData={...user,savedShift:shift,savedShiftDate:getTodayStr()};
  store(K.SESSION,sessionData); state.currentUser=sessionData;
  addLoggedTodayLocal(user.user_id);
  api({action:"markLogin",user_id:user.user_id,name:encodeURIComponent(user.name),shift,date:getTodayStr()}).catch(()=>{});
  enterApp(shift,false);
}

document.getElementById("btn-vip-login").addEventListener("click",()=>{state.pinBuffer="";updatePinDisplay();document.getElementById("pin-error").classList.add("hidden");document.getElementById("section-select-user").classList.add("hidden");document.getElementById("section-password").classList.remove("hidden");});
document.getElementById("btn-back-login").addEventListener("click",()=>{document.getElementById("section-password").classList.add("hidden");document.getElementById("section-select-user").classList.remove("hidden");});
document.querySelectorAll(".num-btn[data-num]").forEach(btn=>{btn.addEventListener("click",()=>{if(state.pinBuffer.length>=6)return;state.pinBuffer+=btn.dataset.num;updatePinDisplay();});});
document.getElementById("btn-pin-clear").addEventListener("click",()=>{state.pinBuffer=state.pinBuffer.slice(0,-1);updatePinDisplay();});
document.getElementById("btn-pin-ok").addEventListener("click",submitPin);
function updatePinDisplay(){document.querySelectorAll("#pin-display span").forEach((s,i)=>s.classList.toggle("filled",i<state.pinBuffer.length));}
async function submitPin(){
  if(state.pinBuffer.length<4){showPinError("กรอกรหัสผ่านให้ครบ");return;}
  const okBtn=document.getElementById("btn-pin-ok"); okBtn.disabled=true; okBtn.textContent="...";
  const vipUsers=state.users.filter(u=>isVIP(u.role)&&u.is_active);
  let found=false;
  for(const u of vipUsers){try{const res=await api({action:"verifyLogin",user_id:u.user_id,password:state.pinBuffer});if(res.success){found=true;onUserSelected({user_id:res.user_id,name:res.name,role:res.role});break;}}catch(e){}}
  if(!found){showPinError("รหัสผ่านไม่ถูกต้อง");state.pinBuffer="";updatePinDisplay();}
  okBtn.disabled=false; okBtn.textContent="OK";
}
function showPinError(msg){const el=document.getElementById("pin-error");el.textContent=msg;el.classList.remove("hidden");}

// ============================================================
//  ENTER APP
// ============================================================
function enterApp(shift,fromSession){
  const user=state.currentUser; if(!user){showScreen("screen-login");return;}
  if(!shift&&fromSession){const s=load(K.SESSION);if(s&&s.savedShiftDate===getTodayStr())shift=s.savedShift||null;}
  state.currentShift=shift||"morning";
  showScreen("screen-app");
  document.getElementById("topbar-name").textContent=user.name||"ผู้ใช้";
  document.getElementById("topbar-role").textContent=roleLabel(user.role);
  document.getElementById("shift-badge").textContent=shift?getShiftLabel(state.currentShift):"⚙️ Admin";
  document.getElementById("nav-vip").classList.toggle("hidden",!isVIP(user.role));
  setSyncStatus("");
  document.querySelectorAll(".nav-btn").forEach(btn=>{btn.addEventListener("click",()=>{document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");navigateTo(btn.dataset.nav);});});
  flushQueue().catch(()=>{});
  setupAutoLogout(shift);
  navigateTo("repairs");
}

function navigateTo(page){
  if(page==="repairs") checkRoutineGate();
  else if(page==="water"){ensureWaterScreen();showMainPanel("screen-water");}
  else if(page==="vip"){showMainPanel("screen-vip");loadVIPData();}
}
function ensureWaterScreen(){
  if(document.getElementById("screen-water")) return;
  const el=document.createElement("div"); el.id="screen-water"; el.className="main-content";
  el.innerHTML=`<div class="water-coming-soon"><div class="icon">💧</div><p>บันทึกระดับน้ำ</p></div>`;
  document.getElementById("screen-app").insertBefore(el,document.getElementById("bottom-nav"));
}

// ============================================================
//  ROUTINE GATE
// ============================================================
function checkRoutineGate(){
  const user=state.currentUser;
  if(user.role==="admin"){loadRepairsInstant();return;}
  const shift=state.currentShift;
  if(isRoutineDoneToday(shift)){loadRepairsInstant();return;}
  showRoutineForm(shift);
}

// ============================================================
//  ROUTINE FORM — รองรับทุกกะ
// ============================================================
async function showRoutineForm(shift){
  showMainPanel("screen-routine");
  document.getElementById("routine-icon").textContent=getShiftIcon(shift);
  document.getElementById("routine-title").textContent=`Routine ${getShiftLabel(shift)}`;
  document.getElementById("routine-subtitle").textContent="บันทึก routine แล้วเข้างานซ่อมได้เลย";
  document.getElementById("routine-done-banner").classList.add("hidden");
  document.getElementById("btn-skip-routine").style.display="none";
  const btn=document.getElementById("btn-submit-routine");
  btn.style.display="flex"; btn.disabled=false;
  btn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> บันทึก และเข้างานซ่อม`;

  document.getElementById("routine-form-container").innerHTML=
    `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลด...</span></div>`;

  try{
    const res=await api({action:"getRoutineTemplate",shift});
    if(res.success&&res.items){
      store(`mcr_tmpl_${shift}`,res.items);
      if(shift==="afternoon"&&res.next_endpoint_point){
        state.nextEndpointPoint=res.next_endpoint_point;
      }
      renderRoutineItems(res.items, shift);
    }
  }catch(e){
    const cached=load(`mcr_tmpl_${shift}`,null);
    if(cached) renderRoutineItems(cached, shift);
    else{
      document.getElementById("routine-form-container").innerHTML=
        `<div class="empty-state" style="padding:24px 0"><div style="font-size:2rem">⚠️</div><p style="margin-top:8px">โหลดไม่ได้ กดผ่านได้เลย</p></div>`;
      btn.innerHTML=`เข้าสู่งานซ่อม`; state.routineHasItems=false;
    }
  }
}

function renderRoutineItems(items, shift){
  state.routineHasItems=!!(items&&items.length);
  if(!state.routineHasItems){
    document.getElementById("routine-form-container").innerHTML=
      `<div class="empty-state" style="padding:24px 0"><div style="font-size:2.5rem">✅</div><p style="margin-top:8px">ไม่มี routine สำหรับกะนี้</p></div>`;
    document.getElementById("btn-submit-routine").innerHTML=`เข้าสู่งานซ่อม`; return;
  }

  if(shift==="morning"){
    renderMorningRoutine(items);
  } else if(shift==="afternoon"){
    renderAfternoonRoutine(items);
  } else {
    // กะดึก — เหมือนเดิม
    const pond1=items.filter(it=>it.group==="pond1");
    const pond2=items.filter(it=>it.group==="pond2");
    let html="";
    if(pond1.length) html+=buildRoutineCard("🔵 บ่อพักน้ำประปา",pond1);
    if(pond2.length) html+=buildRoutineCard("🟢 สระว่ายน้ำ",pond2);
    document.getElementById("routine-form-container").innerHTML=html;
  }
}

function renderMorningRoutine(items){
  const pond1=items.filter(it=>it.group==="pond1");
  const pond2=items.filter(it=>it.group==="pond2");
  let html="";
  if(pond1.length) html+=buildRoutineCard("🔵 บ่อพักน้ำประปา",pond1);
  if(pond2.length) html+=buildRoutineCard("🟢 สระว่ายน้ำ",pond2);
  document.getElementById("routine-form-container").innerHTML=html;
}

function renderAfternoonRoutine(items){
  const pond1  =items.filter(it=>it.group==="pond1");
  const pond2  =items.filter(it=>it.group==="pond2");
  const endpoint=items.filter(it=>it.group==="endpoint");
  const gas    =items.filter(it=>it.group==="gas");

  let html="";
  if(pond1.length) html+=buildRoutineCard("🔵 บ่อพักน้ำประปา",pond1);
  if(pond2.length) html+=buildRoutineCard("🟢 สระว่ายน้ำ",pond2);

  // ปลายทาง — แสดงชื่อจุดที่ต้องตรวจวันนี้
  if(endpoint.length){
    const pointName=state.nextEndpointPoint||"สจ๊วต";
    html+=`<div class="routine-card">
      <div class="routine-card-title">🔬 ตรวจคลอรีนปลายทาง</div>
      <div class="endpoint-badge">📍 จุดวันนี้: <strong>${pointName}</strong></div>
      ${endpoint.map(it=>`
        <div class="routine-input-row">
          <label>${it.description}</label>
          <input class="routine-input" type="number" step="0.1" min="0" id="ri_${it.item_id}" placeholder="0" inputmode="decimal"/>
          <span class="routine-unit">${it.unit||""}</span>
        </div>`).join("")}
    </div>`;
  }

  // ตรวจแก๊ส (วันอังคารเท่านั้น)
  if(gas.length){
    html+=`<div class="routine-card">
      <div class="routine-card-title">⛽ ตรวจรั่วแก๊ส (วันอังคาร)</div>
      <div class="gas-select-row">
        <button class="gas-btn" data-val="ปกติ" id="gas-btn-ok">✅ ปกติ</button>
        <button class="gas-btn gas-btn-warn" data-val="ไม่ปกติ" id="gas-btn-warn">⚠️ ไม่ปกติ</button>
      </div>
      <input type="hidden" id="ri_T014" value=""/>
    </div>`;
  }

  // อัปโหลดรูป (1-10 รูป)
  html+=`<div class="routine-card">
    <div class="routine-card-title">📷 รูปภาพประจำวัน (สูงสุด 10 รูป)</div>
    <div class="photo-btns-row">
      <label class="photo-upload-btn" for="afternoon-photo-camera">📷 ถ่ายรูป</label>
      <label class="photo-upload-btn" for="afternoon-photo-gallery">🖼️ อัลบั้ม</label>
    </div>
    <input type="file" id="afternoon-photo-camera" accept="image/*" capture="environment" style="display:none"/>
    <input type="file" id="afternoon-photo-gallery" accept="image/*" multiple style="display:none"/>
    <div id="afternoon-photo-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>
    <p id="afternoon-photo-count" style="font-size:.72rem;color:var(--white-dim);margin-top:4px">0 รูป</p>
  </div>`;

  document.getElementById("routine-form-container").innerHTML=html;
  state.afternoonPhotos=[];

  // gas buttons
  document.querySelectorAll(".gas-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".gas-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("ri_T014").value=btn.dataset.val;
    });
  });

  // photo inputs
  const addPhotos=(files)=>{
    Array.from(files).forEach(file=>{
      if(state.afternoonPhotos.length>=10) return;
      const reader=new FileReader();
      reader.onload=e=>{
        state.afternoonPhotos.push({b64:e.target.result.split(",")[1],name:file.name});
        const prev=document.getElementById("afternoon-photo-preview");
        const img=document.createElement("img");
        img.src=e.target.result; img.style.cssText="width:70px;height:70px;object-fit:cover;border-radius:8px;border:1px solid var(--border)";
        prev.appendChild(img);
        document.getElementById("afternoon-photo-count").textContent=`${state.afternoonPhotos.length} รูป`;
      };
      reader.readAsDataURL(file);
    });
  };
  document.getElementById("afternoon-photo-camera").addEventListener("change",function(){addPhotos(this.files);});
  document.getElementById("afternoon-photo-gallery").addEventListener("change",function(){addPhotos(this.files);});
}

function buildRoutineCard(title,items){
  const rows=items.map(it=>`
    <div class="routine-input-row">
      <label>${it.description}</label>
      <input class="routine-input" type="number" step="0.1" min="0"
        id="ri_${it.item_id}" placeholder="0" inputmode="decimal"/>
      <span class="routine-unit">${it.unit||""}</span>
    </div>`).join("");
  return `<div class="routine-card"><div class="routine-card-title">${title}</div>${rows}</div>`;
}

// ── Submit Routine ──
document.getElementById("btn-submit-routine").addEventListener("click",()=>{
  const shift=state.currentShift, today=getTodayStr(), user=state.currentUser;
  if(!state.routineHasItems){markRoutineDone(shift,user.name);loadRepairsInstant();return;}

  const waterData={};
  document.querySelectorAll(".routine-input").forEach(inp=>{waterData[inp.id.replace("ri_","")]=inp.value||"0";});

  markRoutineDone(shift,user.name);
  loadRepairsInstant();

  const doUpload=async()=>{
    try{await api({action:"saveRoutineLog",shift,date:today,done_by:encodeURIComponent(user.name)});}
    catch(e){enqueue("saveRoutineLog",{shift,date:today,done_by:encodeURIComponent(user.name)});}

    if(shift==="morning"){
      const wp={date:today,shift,
        pond1_level_cm:waterData["T001"]||"",pond1_chlorine:waterData["T002"]||"",pond1_chlorine_kg:waterData["T003"]||"",
        pond2_level_cm:waterData["T004"]||"",pond2_cl:waterData["T005"]||"",pond2_ph:waterData["T006"]||"",
        pond2_chlorine_kg:waterData["T007"]||"",pond2_soda_kg:waterData["T008"]||"",
        pond2_f2000_l:waterData["T009"]||"",pond2_poolclear_l:waterData["T010"]||"",
        done_by:encodeURIComponent(user.name)};
      try{await api({action:"saveWaterLog",...wp});}catch(e){enqueue("saveWaterLog",wp);}
    }
    else if(shift==="night"){
      const wp={date:today,shift,
        pond1_level_cm:waterData["T015"]||"",pond2_level_cm:waterData["T016"]||"",
        done_by:encodeURIComponent(user.name)};
      try{await api({action:"saveWaterLog",...wp});}catch(e){enqueue("saveWaterLog",wp);}
    }
    else if(shift==="afternoon"){
      // upload รูปก่อน
      const photoUrls=[];
      for(const photo of state.afternoonPhotos){
        try{
          const up=await uploadPhotoAPI(photo.b64,`afternoon_${today}_${Date.now()}.jpg`);
          if(up.success) photoUrls.push(up.url||"");
        }catch(e){}
      }
      const ap={date:today,
        pond1_level_cm:waterData["T011"]||"",pond2_level_cm:waterData["T012"]||"",
        endpoint_point:encodeURIComponent(state.nextEndpointPoint||""),
        endpoint_cl:waterData["T013"]||"",
        gas_status:encodeURIComponent(waterData["T014"]||""),
        photos:encodeURIComponent(JSON.stringify(photoUrls)),
        done_by:encodeURIComponent(user.name)};
      try{await api({action:"saveAfternoonLog",...ap});}catch(e){enqueue("saveAfternoonLog",ap);}
    }
  };
  doUpload().catch(()=>{});
});
document.getElementById("btn-skip-routine").addEventListener("click",()=>loadRepairsInstant());

// ============================================================
//  REPAIRS
// ============================================================
function loadRepairsInstant(){
  showMainPanel("screen-repairs");
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.nav==="repairs"));
  const cached=load(K.REPAIRS,[]);
  if(cached.length){state.repairs=cached;renderRepairs();}
  else document.getElementById("repair-list").innerHTML=`<div class="loading-state"><div class="spinner"></div><span>กำลังโหลดครั้งแรก...</span></div>`;
  syncRepairsBackground();
}

async function syncRepairsBackground(){
  setSyncStatus("syncing");
  try{
    const res=await api({action:"getRepairs"});
    if(!res.success){setSyncStatus("error");return;}
    const fresh=res.data;
    let changed=fresh.length!==state.repairs.length;
    if(!changed){const oldMap={};state.repairs.forEach(r=>{oldMap[r.doc_no]=r;});fresh.forEach(r=>{if(!oldMap[r.doc_no]||oldMap[r.doc_no].status!==r.status)changed=true;});}
    if(changed){state.repairs=fresh;store(K.REPAIRS,fresh);renderRepairs();}
    setSyncStatus("synced"); setTimeout(()=>setSyncStatus(""),3000);
  }catch(e){setSyncStatus("error");}
}

function renderRepairs(){
  const list=document.getElementById("repair-list");
  let items=state.repairs;
  if(state.filter!=="all") items=items.filter(r=>r.status===state.filter);
  if(!items.length){list.innerHTML=`<div class="empty-state">🎉 ไม่มีงานค้าง</div>`;return;}
  list.innerHTML=items.map(r=>{
    const st=r.status||"", lbl=st===""?"ใหม่":st, cls=st===""?"new":st;
    const imgUrl=getDriveUrl(r.img_before);
    const imgHtml=imgUrl?`<div class="rc-img-wrap"><img class="rc-thumb" src="${imgUrl}" alt="" loading="lazy" onerror="this.closest('.rc-img-wrap').style.display='none'"/></div>`:"";
    return `<div class="repair-card status-${cls}" data-docno="${r.doc_no}">
      ${imgHtml}
      <div class="rc-top"><div class="rc-location">${r.location||"ไม่ระบุสถานที่"}</div><div class="rc-status s-${cls}">${lbl}</div></div>
      <div class="rc-desc">${r.description||"-"}</div>
      <div class="rc-meta">
        <span class="rc-tag">${r.department||"-"}</span>
        <span class="rc-tag">${r.problem_type||"-"}</span>
        <span class="rc-tag">${normalizeYear(r.date)||""}</span>
        ${r.reporter?`<span class="rc-tag">👤 ${r.reporter}</span>`:""}
      </div></div>`;
  }).join("");
  list.querySelectorAll(".repair-card").forEach(card=>{
    card.addEventListener("click",()=>{const item=state.repairs.find(r=>r.doc_no===card.dataset.docno);if(item)openRepairModal(item);});
  });
}

document.getElementById("filter-tabs").addEventListener("click",e=>{
  const btn=e.target.closest(".tab-btn"); if(!btn) return;
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active"); state.filter=btn.dataset.filter; renderRepairs();
});
document.getElementById("btn-refresh").addEventListener("click",()=>syncRepairsBackground());

// ── Repair Modal ──
function openRepairModal(item){
  state.selectedRepair=item; state.selectedStatus=item.status||null; state.afterPhotoB64=null;
  document.getElementById("modal-doc-no").textContent=`#${item.doc_no}`;
  document.getElementById("modal-location").textContent=item.location||"ไม่ระบุ";
  document.getElementById("modal-date").textContent=normalizeYear(item.date)||"-";
  document.getElementById("modal-dept").textContent=item.department||"-";
  document.getElementById("modal-reporter").textContent=item.reporter||"-";
  document.getElementById("modal-type").textContent=item.problem_type||"-";
  document.getElementById("modal-desc").textContent=item.description||"-";
  const urlB=getDriveUrl(item.img_before), imgB=document.getElementById("modal-img-before");
  if(urlB){imgB.src=urlB;imgB.style.display="block";}else imgB.style.display="none";
  const urlA=getDriveUrl(item.img_after), imgA=document.getElementById("modal-img-after"), secA=document.getElementById("img-after-section");
  if(urlA){imgA.src=urlA;imgA.style.display="block";secA.style.display="block";}else{imgA.style.display="none";secA.style.display="none";}
  const techRow=document.getElementById("modal-tech-row");
  if(item.tech_main){document.getElementById("modal-tech").textContent=item.tech_main;techRow.style.display="flex";}else techRow.style.display="none";
  document.getElementById("inp-tech-main").value=item.tech_main||state.currentUser.name||"";
  document.getElementById("inp-tech-assist1").value=item.tech_assist1||"";
  document.getElementById("inp-tech-assist2").value=item.tech_assist2||"";
  document.getElementById("after-photo-preview").src=""; document.getElementById("after-photo-preview").style.display="none";
  document.getElementById("after-photo-label").textContent="";
  document.querySelectorAll(".status-btn").forEach(b=>b.classList.toggle("selected",b.dataset.status===item.status));
  updateTechRequired(item.status);
  document.getElementById("btn-update-status").disabled=false; document.getElementById("btn-update-status").textContent="บันทึกสถานะ";
  document.getElementById("modal-repair").classList.remove("hidden");
}
function updateTechRequired(status){
  const req=status==="ดำเนินการเรียบร้อย";
  document.getElementById("group-tech-main").querySelector("label").innerHTML=req?"ผู้ซ่อมหลัก <span style='color:var(--red)'>*</span>":"ผู้ซ่อมหลัก";
  document.getElementById("group-after-photo").style.display=req?"block":"none";
  document.getElementById("group-assistants").style.display=req?"block":"none";
}
document.querySelectorAll(".status-btn").forEach(btn=>{btn.addEventListener("click",()=>{document.querySelectorAll(".status-btn").forEach(b=>b.classList.remove("selected"));btn.classList.add("selected");state.selectedStatus=btn.dataset.status;updateTechRequired(btn.dataset.status);});});
document.getElementById("btn-close-modal").addEventListener("click",closeRepairModal);
document.getElementById("modal-overlay").addEventListener("click",closeRepairModal);
function closeRepairModal(){document.getElementById("modal-repair").classList.add("hidden");state.selectedRepair=null;state.afterPhotoB64=null;}
function handlePhotoFile(file){
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{const b64=e.target.result.split(",")[1];state.afterPhotoB64=b64;const prev=document.getElementById("after-photo-preview");prev.src=e.target.result;prev.style.display="block";document.getElementById("after-photo-label").textContent="✅ เลือกรูปแล้ว";};
  reader.readAsDataURL(file);
}
document.getElementById("after-photo-camera").addEventListener("change",function(){handlePhotoFile(this.files[0]);});
document.getElementById("after-photo-gallery").addEventListener("change",function(){handlePhotoFile(this.files[0]);});

document.getElementById("btn-update-status").addEventListener("click",async()=>{
  if(!state.selectedRepair||!state.selectedStatus){showToast("กรุณาเลือกสถานะ","error");return;}
  const techMain=document.getElementById("inp-tech-main").value.trim();
  const assist1=document.getElementById("inp-tech-assist1").value.trim();
  const assist2=document.getElementById("inp-tech-assist2").value.trim();
  if(state.selectedStatus==="ดำเนินการเรียบร้อย"&&!techMain){showToast("กรุณาระบุผู้ซ่อมหลัก","error");return;}
  const btn=document.getElementById("btn-update-status"); btn.disabled=true; btn.textContent="กำลังบันทึก...";
  const params={row_index:state.selectedRepair.row_index,status:state.selectedStatus,
    tech_main:encodeURIComponent(techMain),tech_assist1:encodeURIComponent(assist1),tech_assist2:encodeURIComponent(assist2),
    date_done:state.selectedStatus==="ดำเนินการเรียบร้อย"?getTodayStr():"",img_after:""};
  const idx=state.repairs.findIndex(r=>r.doc_no===state.selectedRepair.doc_no);
  if(idx!==-1){
    state.repairs[idx].status=state.selectedStatus; state.repairs[idx].tech_main=techMain;
    if(["ดำเนินการเรียบร้อย","ติดต่อช่างนอก"].includes(state.selectedStatus)) state.repairs.splice(idx,1);
  }
  store(K.REPAIRS,state.repairs); closeRepairModal(); renderRepairs();
  showToast("✅ บันทึกแล้ว กำลัง sync...","success"); btn.disabled=false; btn.textContent="บันทึกสถานะ";
  const doUpload=async()=>{
    if(state.afterPhotoB64){try{const up=await uploadPhotoAPI(state.afterPhotoB64,`after_${state.selectedRepair.doc_no}_${Date.now()}.jpg`);if(up.success)params.img_after=encodeURIComponent(up.path||up.url||"");}catch(e){}}
    try{const r=await api({action:"updateRepairFull",...params});if(!r.success)enqueue("updateRepairFull",params);}
    catch(e){enqueue("updateRepairFull",params);}
  };
  doUpload().catch(()=>{});
});

// ============================================================
//  VIP
// ============================================================
async function loadVIPData(){
  try{
    const res=await api({action:"getRepairsVIP"});
    if(res.success){
      const curYear=getCurrentYear();
      const filterYear=arr=>arr.filter(r=>{const d=normalizeYear(r.date);return d&&parseInt(d.split("-")[0])===curYear;});
      const outsource=filterYear(res.outsource), pending=filterYear(res.pending_score);
      document.getElementById("badge-outsource").textContent=outsource.length;
      document.getElementById("badge-pending").textContent=pending.length;
      renderVIPList("list-outsource",outsource,"ไม่มีงานติดต่อช่างนอก","rgba(231,76,60,0.15)","var(--red)","ช่างนอก");
      renderVIPList("list-pending",pending,"ไม่มีงานรอให้คะแนน","rgba(241,196,15,0.15)","var(--yellow)","รอคะแนน");
    }
  }catch(e){showToast("โหลดข้อมูล VIP ไม่ได้","error");}
  loadUserMgmt();
}
function renderVIPList(elId,items,emptyMsg,bg,color,label){
  const list=document.getElementById(elId);
  if(!items.length){list.innerHTML=`<div class="empty-state">${emptyMsg}</div>`;return;}
  list.innerHTML=items.map(r=>`<div class="repair-card"><div class="rc-top"><div class="rc-location">${r.location||"-"}</div><div class="rc-status" style="background:${bg};color:${color}">${label}</div></div><div class="rc-desc">${r.description||"-"}</div><div class="rc-meta"><span class="rc-tag">${r.department||"-"}</span><span class="rc-tag">${normalizeYear(r.date)||""}</span>${r.tech_main?`<span class="rc-tag">👷 ${r.tech_main}</span>`:""}</div></div>`).join("");
}
document.querySelectorAll(".vip-tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    document.querySelectorAll(".vip-tab").forEach(t=>t.classList.remove("active")); tab.classList.add("active");
    document.querySelectorAll(".vip-panel").forEach(p=>p.classList.add("hidden"));
    const panel=document.getElementById(`vip-${tab.dataset.vip}`);
    if(panel) panel.classList.remove("hidden");
    if(tab.dataset.vip==="dashboard") loadChlorineDashboard();
  });
});

// ── Chlorine Dashboard ──
async function loadChlorineDashboard(){
  const container=document.getElementById("chlorine-table-container");
  container.innerHTML=`<div class="loading-state"><div class="spinner"></div><span>กำลังโหลด...</span></div>`;
  const startDate=document.getElementById("dash-start").value||"";
  const endDate  =document.getElementById("dash-end").value  ||"";
  try{
    const res=await api({action:"getChlorineDashboard",start_date:startDate,end_date:endDate});
    if(!res.success){container.innerHTML=`<div class="empty-state" style="color:var(--red)">โหลดไม่ได้</div>`;return;}
    renderChlorineTable(res.rows, res.endpoint_points);
  }catch(e){container.innerHTML=`<div class="empty-state" style="color:var(--red)">โหลดไม่ได้</div>`;}
}
function renderChlorineTable(rows, points){
  const container=document.getElementById("chlorine-table-container");
  if(!rows.length){container.innerHTML=`<div class="empty-state">ไม่มีข้อมูลในช่วงนี้</div>`;return;}
  const html=`
    <div class="table-wrap">
      <table class="chlorine-table">
        <thead>
          <tr>
            <th>วันที่</th>
            <th>บ่อประปา</th>
            ${points.map(p=>`<th>${p}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>`
            <tr>
              <td>${r.date}</td>
              <td class="cl-val">${r.pond1_cl||"-"}</td>
              ${points.map(p=>`<td class="cl-val ${r[p]?'has-val':''}">${r[p]||""}</td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  container.innerHTML=html;
}
document.getElementById("dash-filter-btn")?.addEventListener("click",loadChlorineDashboard);

// ── User Management ──
async function loadUserMgmt(){
  const list=document.getElementById("user-mgmt-list");
  list.innerHTML=`<div class="loading-state"><div class="spinner"></div></div>`;
  try{const res=await api({action:"getUsers"});if(res.success){state.users=res.users;store(K.USERS,res.users);renderUserMgmt(res.users);}}
  catch(e){list.innerHTML=`<div class="empty-state" style="color:var(--red)">โหลดไม่ได้</div>`;}
}
function renderUserMgmt(users){
  const list=document.getElementById("user-mgmt-list");
  const myRole=state.currentUser?.role||"";
  document.getElementById("btn-add-user").style.display=canAddUser(myRole)?"flex":"none";
  if(!users.length){list.innerHTML=`<div class="empty-state">ยังไม่มีผู้ใช้</div>`;return;}
  list.innerHTML=users.map(u=>{
    const perm=canManage(myRole,u.role);
    return `<div class="user-mgmt-card">
      <div class="umc-avatar">${getInitial(u.name)}</div>
      <div class="umc-info"><div class="umc-name">${u.name}</div><div class="umc-role">${roleLabel(u.role)} ${u.is_active?"":"<span style='color:var(--red);font-size:.65rem'>(ปิด)</span>"}</div></div>
      <div class="umc-actions">
        <div class="toggle ${u.is_active?"on":""}" data-uid="${u.user_id}" style="${perm.toggle?"":"opacity:0.35;pointer-events:none"}"></div>
        ${perm.del?`<button class="btn-icon btn-delete-user" data-uid="${u.user_id}" data-name="${u.name}" style="color:var(--red)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>`:""}
      </div></div>`;
  }).join("");
  list.querySelectorAll(".toggle[data-uid]").forEach(tog=>{
    if(tog.style.pointerEvents==="none"||tog.style.opacity==="0.35") return;
    tog.addEventListener("click",async()=>{
      const uid=tog.dataset.uid, wasOn=tog.classList.contains("on"), newVal=!wasOn;
      tog.classList.toggle("on",newVal);
      try{const res=await api({action:"updateUser",user_id:uid,is_active:String(newVal)});if(res.success){showToast(newVal?"เปิดใช้งานแล้ว":"ปิดใช้งานแล้ว","success");setTimeout(()=>loadUserMgmt(),800);}else{tog.classList.toggle("on",wasOn);showToast(res.message||"อัปเดตไม่ได้","error");}}
      catch(e){tog.classList.toggle("on",wasOn);showToast("เครือข่ายขัดข้อง","error");}
    });
  });
  list.querySelectorAll(".btn-delete-user").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const uid=btn.dataset.uid, name=btn.dataset.name;
      if(!confirm(`ลบ "${name}" ออกจากระบบ?`)) return;
      try{const res=await api({action:"deleteUser",user_id:uid,requester_role:myRole});if(res.success){showToast(`ลบ ${name} แล้ว`,"success");loadUserMgmt();}else showToast(res.message||"ลบไม่ได้","error");}
      catch(e){showToast("เกิดข้อผิดพลาด","error");}
    });
  });
}
document.getElementById("btn-add-user").addEventListener("click",()=>{
  const myRole=state.currentUser?.role||"", roles=creatableRoles(myRole);
  const select=document.getElementById("input-user-role");
  select.innerHTML=roles.map(r=>`<option value="${r}">${roleLabel(r)}</option>`).join("");
  document.getElementById("input-user-name").value=""; document.getElementById("input-user-password").value="";
  document.getElementById("group-password").style.display="none";
  document.getElementById("modal-add-user").classList.remove("hidden");
});
document.getElementById("input-user-role").addEventListener("change",function(){document.getElementById("group-password").style.display=["head_tech","manager","admin"].includes(this.value)?"block":"none";});
document.getElementById("btn-close-modal-user").addEventListener("click",()=>document.getElementById("modal-add-user").classList.add("hidden"));
document.getElementById("modal-overlay-user").addEventListener("click",()=>document.getElementById("modal-add-user").classList.add("hidden"));
document.getElementById("btn-confirm-add-user").addEventListener("click",async()=>{
  const name=document.getElementById("input-user-name").value.trim();
  const role=document.getElementById("input-user-role").value;
  const pw=document.getElementById("input-user-password").value.trim();
  if(!name){showToast("กรอกชื่อก่อน","error");return;}
  const btn=document.getElementById("btn-confirm-add-user"); btn.disabled=true; btn.textContent="กำลังเพิ่ม...";
  try{const res=await api({action:"addUser",name:encodeURIComponent(name),role,password_hash:pw||""});if(res.success){showToast("✅ เพิ่มผู้ใช้แล้ว (รอ Admin เปิด)","success");document.getElementById("modal-add-user").classList.add("hidden");loadUserMgmt();}else showToast(res.message||"เพิ่มไม่ได้","error");}
  catch(e){showToast("เกิดข้อผิดพลาด","error");}
  btn.disabled=false; btn.textContent="เพิ่มผู้ใช้";
});

// ── Logout ──
function doLogout(){clearTimeout(state.autoLogoutTimer);localStorage.removeItem(K.SESSION);state.currentUser=null;state.repairs=[];state.pinBuffer="";showScreen("screen-login");document.getElementById("section-password").classList.add("hidden");document.getElementById("section-select-user").classList.remove("hidden");loadUserList();}
document.getElementById("btn-logout").addEventListener("click",()=>{if(!confirm("ออกจากระบบ?"))return;doLogout();});
