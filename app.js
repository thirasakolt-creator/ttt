// ============================================================
//  MANEECHAN RESORT — app.js  v2.0
//  + รูปภาพ Drive, shift picker, ป้องกัน login ซ้ำ
//  + ฟอร์มปิดงาน (tech_main required, assist 1-2, รูปหลังซ่อม)
//  + ลบ user พร้อม permission hierarchy
//  + Admin ข้าม routine/shift
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbzX4_G2astabG-Njqbn3yEzMCnSSABRmaJvHE349FXazLwAckLLMLglOkeGFcjsMttt/exec";

// ============================================================
//  STATE
// ============================================================
const state = {
  currentUser:     null,
  currentShift:    null,
  repairs:         [],
  filter:          "all",
  selectedRepair:  null,
  selectedStatus:  null,
  pinBuffer:       "",
  users:           [],
  routineHasItems: false,
  afterPhotoB64:   null,   // รูปหลังซ่อมที่รอ upload
  imgUrlCache:     {},     // path → url
};

const K = {
  SESSION:      "mcr_session",
  REPAIRS:      "mcr_repairs_v2",
  USERS:        "mcr_users_v2",
  ROUTINE_DONE: "mcr_routine_done",
  QUEUE:        "mcr_queue",
  LOGGED_TODAY: "mcr_logged_today",   // { date, user_ids[] }
};

// ============================================================
//  STORAGE
// ============================================================
function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){} }
function load(key, def=null) {
  try { const r=localStorage.getItem(key); return r?JSON.parse(r):def; } catch(e){ return def; }
}

// ============================================================
//  QUEUE
// ============================================================
function enqueue(action, params) {
  const q = load(K.QUEUE, []);
  q.push({ action, params, ts: Date.now() });
  store(K.QUEUE, q);
}
async function flushQueue() {
  const q = load(K.QUEUE, []);
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      const res = await api({ action: item.action, ...item.params });
      if (!res.success && !res.duplicate) remaining.push(item);
    } catch(e) { remaining.push(item); }
  }
  store(K.QUEUE, remaining);
}

// ============================================================
//  API
// ============================================================
async function api(params) {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// upload รูปภาพ (POST multipart)
async function uploadPhotoAPI(b64, filename) {
  const body = new URLSearchParams({ action:"uploadPhoto", filename, data:b64 });
  const res  = await fetch(API_URL, { method:"POST", body });
  return res.json();
}

// ============================================================
//  UTILS
// ============================================================
function showToast(msg, type="") {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = `toast ${type}`;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.add("hidden"), 2500);
}
function getShiftLabel(s) {
  return {morning:"กะเช้า 🌅",afternoon:"กะเที่ยง ☀️",night:"กะดึก 🌙"}[s]||s;
}
function getShiftIcon(s) { return {morning:"🌅",afternoon:"☀️",night:"🌙"}[s]||"🔧"; }
function detectAvailableShifts() {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return ["morning","afternoon"];
  if (h >= 12 && h < 18) return ["afternoon","night"];
  if (h >= 18 && h < 24) return ["afternoon","night"];
  return ["night","morning"]; // ดึก-เช้า
}
function getTodayStr() {
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function roleLabel(r) {
  return {admin:"Admin",manager:"ผู้จัดการ",head_tech:"หัวหน้าช่าง",technician:"ช่าง"}[r]||r;
}
function isVIP(r) { return ["admin","manager","head_tech"].includes(r); }
function getInitial(n) { return n?n.charAt(0).toUpperCase():"?"; }

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s=>s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
function showMainPanel(id) {
  document.querySelectorAll(".main-content").forEach(p=>p.classList.add("hidden"));
  const el=document.getElementById(id); if(el) el.classList.remove("hidden");
}

// ============================================================
//  ROUTINE DONE (local per shift/date)
// ============================================================
function routineKey(shift,date){ return `${shift}_${date}`; }
function isRoutineDoneToday(shift){
  const done=load(K.ROUTINE_DONE,{});
  return !!done[routineKey(shift,getTodayStr())];
}
function markRoutineDone(shift,doneBy){
  const today=getTodayStr(), done=load(K.ROUTINE_DONE,{});
  done[routineKey(shift,today)]={done_by:doneBy,ts:Date.now()};
  const cutoff=Date.now()-7*86400000;
  Object.keys(done).forEach(k=>{if(done[k].ts<cutoff)delete done[k];});
  store(K.ROUTINE_DONE,done);
}

// ============================================================
//  LOGGED TODAY (local + sync)
// ============================================================
function getLoggedTodayLocal(){
  const obj=load(K.LOGGED_TODAY,{date:"",user_ids:[]});
  if(obj.date!==getTodayStr()) return [];
  return obj.user_ids||[];
}
function addLoggedTodayLocal(uid){
  const today=getTodayStr();
  const obj=load(K.LOGGED_TODAY,{date:today,user_ids:[]});
  if(obj.date!==today){ obj.date=today; obj.user_ids=[]; }
  if(!obj.user_ids.includes(uid)) obj.user_ids.push(uid);
  store(K.LOGGED_TODAY,obj);
}

// ============================================================
//  DRIVE IMAGE URL
// ============================================================
function getDriveUrl(path) {
  if (!path) return null;
  if (state.imgUrlCache[path]) return state.imgUrlCache[path];

  // แปลง Drive URL → thumbnail URL แสดงได้เลย ไม่ต้องผ่าน API
  // รองรับ: https://drive.google.com/uc?export=view&id=FILE_ID
  //         https://drive.google.com/file/d/FILE_ID/view
  let fileId = null;

  const m1 = path.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const m2 = path.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) fileId = m1[1];
  else if (m2) fileId = m2[1];

  if (!fileId) return null;

  // thumbnail URL — โหลดได้ทันที ไม่ติด CORS ไม่ต้อง login
  const url = `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  state.imgUrlCache[path] = url;
  return url;
}

// ============================================================
//  SPLASH
// ============================================================
window.addEventListener("DOMContentLoaded", async ()=>{
  const session=load(K.SESSION);
  await new Promise(r=>setTimeout(r,1500));
  document.getElementById("splash").style.display="none";
  if(session){ state.currentUser=session; enterApp(); }
  else { showScreen("screen-login"); loadUserList(); }
});

// ============================================================
//  LOGIN
// ============================================================
async function loadUserList(){
  const grid=document.getElementById("user-list");

  const cachedUsers=load(K.USERS,[]);
  state.users=cachedUsers;
  renderUserGrid(cachedUsers);

  // sync users เบื้องหลัง
  try {
    const res=await api({action:"getUsers"});
    if(res.success){ state.users=res.users; store(K.USERS,res.users); renderUserGrid(res.users); }
  } catch(e){}
}

function renderUserGrid(users){
  const grid=document.getElementById("user-list");
  const loggedToday=getLoggedTodayLocal();

  // กรองเฉพาะ technician ที่ active และยังไม่ได้ login วันนี้
  const techs=users.filter(u=>u.is_active && u.role==="technician" && !loggedToday.includes(u.user_id));

  if(!techs.length){
    grid.innerHTML=`<div class="user-loading" style="grid-column:1/-1;text-align:center;line-height:2">
      ไม่มีช่างที่รอ login<br><small style="opacity:0.5">ใช้ปุ่ม "เข้าด้วยรหัสผ่าน" สำหรับ VIP</small></div>`;
    return;
  }
  grid.innerHTML=techs.map(u=>`
    <div class="user-card" data-uid="${u.user_id}">
      <div class="uc-avatar">${getInitial(u.name)}</div>
      <div class="uc-name">${u.name}</div>
      <div class="uc-role">${roleLabel(u.role)}</div>
    </div>`).join("");

  grid.querySelectorAll(".user-card").forEach(card=>{
    card.addEventListener("click",()=>{
      const user=state.users.find(u=>u.user_id===card.dataset.uid);
      if(user) onUserSelected(user);
    });
  });
}

// เลือก user แล้วแสดง shift picker (ยกเว้น admin)
function onUserSelected(user){
  state.currentUser=user;
  if(user.role==="admin"){
    // admin ข้าม shift picker
    store(K.SESSION,user);
    enterApp(null);
    return;
  }
  showShiftPicker(user);
}

// ============================================================
//  SHIFT PICKER MODAL
// ============================================================
function showShiftPicker(user){
  const shifts    = detectAvailableShifts();
  const container = document.getElementById("shift-picker-btns");
  container.innerHTML = shifts.map(s=>`
    <button class="btn-primary shift-pick-btn" data-shift="${s}" style="flex:1">
      ${getShiftIcon(s)} ${getShiftLabel(s)}
    </button>`).join("");

  container.querySelectorAll(".shift-pick-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const shift=btn.dataset.shift;
      closeShiftPicker();
      finishLogin(user, shift);
    });
  });

  document.getElementById("modal-shift-picker").classList.remove("hidden");
}

function closeShiftPicker(){
  document.getElementById("modal-shift-picker").classList.add("hidden");
}

function finishLogin(user, shift){
  store(K.SESSION, { ...user, savedShift: shift, savedShiftDate: getTodayStr() });
  state.currentUser = { ...user, savedShift: shift };
  addLoggedTodayLocal(user.user_id);

  // mark login เบื้องหลัง
  api({ action:"markLogin", user_id:user.user_id, name:encodeURIComponent(user.name), shift, date:getTodayStr() }).catch(()=>{});

  enterApp(shift);
}

// ── VIP PIN ──
document.getElementById("btn-vip-login").addEventListener("click",()=>{
  state.pinBuffer=""; updatePinDisplay();
  document.getElementById("pin-error").classList.add("hidden");
  document.getElementById("section-select-user").classList.add("hidden");
  document.getElementById("section-password").classList.remove("hidden");
});
document.getElementById("btn-back-login").addEventListener("click",()=>{
  document.getElementById("section-password").classList.add("hidden");
  document.getElementById("section-select-user").classList.remove("hidden");
});
document.querySelectorAll(".num-btn[data-num]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(state.pinBuffer.length>=6) return;
    state.pinBuffer+=btn.dataset.num; updatePinDisplay();
  });
});
document.getElementById("btn-pin-clear").addEventListener("click",()=>{
  state.pinBuffer=state.pinBuffer.slice(0,-1); updatePinDisplay();
});
document.getElementById("btn-pin-ok").addEventListener("click", submitPin);

function updatePinDisplay(){
  document.querySelectorAll("#pin-display span").forEach((s,i)=>
    s.classList.toggle("filled", i<state.pinBuffer.length));
}

async function submitPin(){
  if(state.pinBuffer.length<4){ showPinError("กรอกรหัสผ่านให้ครบ"); return; }
  const okBtn=document.getElementById("btn-pin-ok");
  okBtn.disabled=true; okBtn.textContent="...";

  const vipUsers=state.users.filter(u=>isVIP(u.role)&&u.is_active);
  let found=false;
  for(const u of vipUsers){
    try{
      const res=await api({action:"verifyLogin",user_id:u.user_id,password:state.pinBuffer});
      if(res.success){
        found=true;
        onUserSelected({user_id:res.user_id,name:res.name,role:res.role});
        break;
      }
    }catch(e){}
  }
  if(!found){ showPinError("รหัสผ่านไม่ถูกต้อง"); state.pinBuffer=""; updatePinDisplay(); }
  okBtn.disabled=false; okBtn.textContent="OK";
}
function showPinError(msg){
  const el=document.getElementById("pin-error");
  el.textContent=msg; el.classList.remove("hidden");
}

// ============================================================
//  ENTER APP
// ============================================================
function enterApp(shift){
  const user=state.currentUser;
  if(!user){ showScreen("screen-login"); return; }

  // คืนค่า shift จาก session ถ้ามี
  if(!shift){
    const session=load(K.SESSION);
    if(session && session.savedShiftDate===getTodayStr()) shift=session.savedShift||null;
  }

  state.currentShift = shift || "morning"; // fallback
  showScreen("screen-app");

  document.getElementById("topbar-name").textContent = user.name||"ผู้ใช้";
  document.getElementById("topbar-role").textContent = roleLabel(user.role);
  document.getElementById("shift-badge").textContent = shift ? getShiftLabel(state.currentShift) : "Admin";
  document.getElementById("nav-vip").classList.toggle("hidden",!isVIP(user.role));

  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active"); navigateTo(btn.dataset.nav);
    });
  });

  flushQueue().catch(()=>{});
  navigateTo("repairs");
}

function navigateTo(page){
  if      (page==="repairs") checkRoutineGate();
  else if (page==="water")   { ensureWaterScreen(); showMainPanel("screen-water"); }
  else if (page==="vip")     { showMainPanel("screen-vip"); loadVIPData(); }
}

function ensureWaterScreen(){
  if(document.getElementById("screen-water")) return;
  const el=document.createElement("div");
  el.id="screen-water"; el.className="main-content";
  el.innerHTML=`<div class="water-coming-soon">
    <div class="icon">💧</div><p>บันทึกระดับน้ำ</p>
    <p style="font-size:0.75rem;opacity:0.5;margin-top:4px">จะเปิดให้ใช้งานเร็วๆ นี้</p></div>`;
  document.getElementById("screen-app").insertBefore(el,document.getElementById("bottom-nav"));
}

// ============================================================
//  ROUTINE GATE
// ============================================================
function checkRoutineGate(){
  const user=state.currentUser;
  // Admin ข้าม routine
  if(user.role==="admin"){ loadRepairsInstant(); return; }

  const shift=state.currentShift;
  if(isRoutineDoneToday(shift)){ loadRepairsInstant(); return; }
  showRoutineForm(shift);
}

function showRoutineForm(shift){
  showMainPanel("screen-routine");
  document.getElementById("routine-icon").textContent     = getShiftIcon(shift);
  document.getElementById("routine-title").textContent    = `Routine ${getShiftLabel(shift)}`;
  document.getElementById("routine-subtitle").textContent = "บันทึก routine แล้วเข้างานซ่อมได้เลย";
  document.getElementById("routine-done-banner").classList.add("hidden");
  document.getElementById("btn-skip-routine").style.display="none";

  const btn=document.getElementById("btn-submit-routine");
  btn.style.display="flex"; btn.disabled=false;
  btn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> บันทึก และเข้างานซ่อม`;

  // แสดง cache template ทันที
  const cached=load(`mcr_tmpl_${shift}`,null);
  if(cached) renderRoutineItems(cached);
  else document.getElementById("routine-form-container").innerHTML=
    `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลด...</span></div>`;

  // โหลด template เบื้องหลัง
  api({action:"getRoutineTemplate",shift}).then(res=>{
    if(res.success&&res.items){ store(`mcr_tmpl_${shift}`,res.items); renderRoutineItems(res.items); }
  }).catch(()=>{
    if(!cached){
      document.getElementById("routine-form-container").innerHTML=
        `<div class="empty-state" style="padding:24px 0"><div style="font-size:2rem">⚠️</div><p style="margin-top:8px">โหลดไม่ได้ กดผ่านได้เลย</p></div>`;
      btn.innerHTML=`เข้าสู่งานซ่อม`; state.routineHasItems=false;
    }
  });
}

function renderRoutineItems(items){
  state.routineHasItems=!!(items&&items.length);
  if(!state.routineHasItems){
    document.getElementById("routine-form-container").innerHTML=
      `<div class="empty-state" style="padding:24px 0"><div style="font-size:2.5rem">✅</div><p style="margin-top:8px">ไม่มี routine สำหรับกะนี้</p></div>`;
    document.getElementById("btn-submit-routine").innerHTML=`เข้าสู่งานซ่อม`; return;
  }
  const pond1=items.filter(it=>it.description.includes("บ่อพัก")||it.description.includes("ประปา"));
  const pond2=items.filter(it=>it.description.includes("สระ"));
  const other=items.filter(it=>!pond1.includes(it)&&!pond2.includes(it));
  let html="";
  if(pond1.length) html+=buildRoutineCard("🔵 บ่อพักน้ำประปา",pond1);
  if(pond2.length) html+=buildRoutineCard("🟢 สระว่ายน้ำ",pond2);
  if(other.length) html+=buildRoutineCard("📋 รายการอื่นๆ",other);
  document.getElementById("routine-form-container").innerHTML=html;
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

document.getElementById("btn-submit-routine").addEventListener("click",()=>{
  const shift=state.currentShift, today=getTodayStr(), user=state.currentUser;
  const waterData={};
  document.querySelectorAll(".routine-input").forEach(inp=>{
    waterData[inp.id.replace("ri_","")]=inp.value||"0";
  });

  markRoutineDone(shift,user.name);
  loadRepairsInstant();

  const doUpload=async()=>{
    try{ await api({action:"saveRoutineLog",shift,date:today,done_by:encodeURIComponent(user.name)}); }
    catch(e){ enqueue("saveRoutineLog",{shift,date:today,done_by:encodeURIComponent(user.name)}); }

    if(shift==="morning"||shift==="night"){
      const wp={date:today,shift,
        pond1_level_cm:waterData["T001"]||waterData["T008"]||"",
        pond1_chlorine:waterData["T002"]||"",
        pond2_level_cm:waterData["T003"]||waterData["T009"]||"",
        pond2_chlorine:waterData["T004"]||"",
        pond2_soda_kg:waterData["T005"]||"",
        pond2_chlorine_kg:waterData["T006"]||"",
        done_by:encodeURIComponent(user.name)
      };
      try{ await api({action:"saveWaterLog",...wp}); }
      catch(e){ enqueue("saveWaterLog",wp); }
    }
  };
  doUpload().catch(()=>{});
});
document.getElementById("btn-skip-routine").addEventListener("click",()=>loadRepairsInstant());

// ============================================================
//  REPAIRS — INSTANT
// ============================================================
function loadRepairsInstant(){
  showMainPanel("screen-repairs");
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.nav==="repairs"));

  const cached=load(K.REPAIRS,[]);
  if(cached.length){ state.repairs=cached; renderRepairs(); }
  else document.getElementById("repair-list").innerHTML=
    `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลดครั้งแรก...</span></div>`;

  syncRepairsBackground();
}

async function syncRepairsBackground(){
  try{
    const res=await api({action:"getRepairs"});
    if(!res.success) return;
    const fresh=res.data;
    let changed=false;
    if(fresh.length!==state.repairs.length) changed=true;
    else {
      const oldMap={};
      state.repairs.forEach(r=>{ oldMap[r.doc_no]=r; });
      fresh.forEach(r=>{ if(!oldMap[r.doc_no]||oldMap[r.doc_no].status!==r.status) changed=true; });
    }
    if(changed){ state.repairs=fresh; store(K.REPAIRS,fresh); renderRepairs(); }
  }catch(e){}
}

function renderRepairs(){
  const list=document.getElementById("repair-list");
  let items=state.repairs;
  if(state.filter!=="all") items=items.filter(r=>r.status===state.filter);
  if(!items.length){ list.innerHTML=`<div class="empty-state">🎉 ไม่มีงานค้าง</div>`; return; }

  list.innerHTML=items.map(r=>{
    const st=r.status||"", lbl=st===""?"ใหม่":st, cls=st===""?"new":st;
    const hasImg = r.img_before ? `<span class="rc-tag">📷 มีรูป</span>` : "";
    return `
      <div class="repair-card status-${cls}" data-docno="${r.doc_no}">
        <div class="rc-top">
          <div class="rc-location">${r.location||"ไม่ระบุสถานที่"}</div>
          <div class="rc-status s-${cls}">${lbl}</div>
        </div>
        <div class="rc-desc">${r.description||"-"}</div>
        <div class="rc-meta">
          <span class="rc-tag">${r.department||"-"}</span>
          <span class="rc-tag">${r.problem_type||"-"}</span>
          <span class="rc-tag">${r.date||""}</span>
          ${hasImg}
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".repair-card").forEach(card=>{
    card.addEventListener("click",()=>{
      const item=state.repairs.find(r=>r.doc_no===card.dataset.docno);
      if(item) openRepairModal(item);
    });
  });
}

document.getElementById("filter-tabs").addEventListener("click",e=>{
  const btn=e.target.closest(".tab-btn"); if(!btn) return;
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active"); state.filter=btn.dataset.filter; renderRepairs();
});
document.getElementById("btn-refresh").addEventListener("click",()=>{
  showToast("กำลัง sync...",""); syncRepairsBackground();
});

// ============================================================
//  REPAIR MODAL
// ============================================================
async function openRepairModal(item){
  state.selectedRepair=item; state.selectedStatus=item.status||null;
  state.afterPhotoB64=null;

  document.getElementById("modal-doc-no").textContent   = `#${item.doc_no}`;
  document.getElementById("modal-location").textContent = item.location||"ไม่ระบุ";
  document.getElementById("modal-date").textContent     = item.date||"-";
  document.getElementById("modal-dept").textContent     = item.department||"-";
  document.getElementById("modal-reporter").textContent = item.reporter||"-";
  document.getElementById("modal-type").textContent     = item.problem_type||"-";
  document.getElementById("modal-desc").textContent     = item.description||"-";

  // รูปก่อนซ่อม — แปลงเป็น thumbnail URL ทันที ไม่ต้องรอ
  const imgBefore=document.getElementById("modal-img-before");
  const urlBefore=getDriveUrl(item.img_before);
  if(urlBefore){
    imgBefore.src=urlBefore; imgBefore.style.display="block";
  } else { imgBefore.style.display="none"; }

  // รูปหลังซ่อม
  const imgAfter=document.getElementById("modal-img-after");
  const urlAfter=getDriveUrl(item.img_after);
  if(urlAfter){
    imgAfter.src=urlAfter; imgAfter.style.display="block";
    document.getElementById("img-after-section").style.display="block";
  } else {
    imgAfter.style.display="none";
    document.getElementById("img-after-section").style.display="none";
  }

  // ผู้ซ่อม
  document.getElementById("modal-tech").textContent = item.tech_main||"-";
  document.getElementById("modal-tech-row").style.display = item.tech_main?"flex":"none";

  // ฟอร์มอัปเดต
  document.getElementById("inp-tech-main").value    = item.tech_main||state.currentUser.name||"";
  document.getElementById("inp-tech-assist1").value = item.tech_assist1||"";
  document.getElementById("inp-tech-assist2").value = item.tech_assist2||"";
  document.getElementById("after-photo-preview").src="";
  document.getElementById("after-photo-preview").style.display="none";
  document.getElementById("after-photo-label").textContent="📷 ถ่ายรูป / เลือกรูปหลังซ่อม";

  document.querySelectorAll(".status-btn").forEach(b=>
    b.classList.toggle("selected",b.dataset.status===item.status));
  updateTechRequired(item.status);

  document.getElementById("btn-update-status").disabled=false;
  document.getElementById("btn-update-status").textContent="บันทึกสถานะ";
  document.getElementById("modal-repair").classList.remove("hidden");
}

// แสดง/ซ่อน required ของ tech_main ตามสถานะ
function updateTechRequired(status){
  const techGroup=document.getElementById("group-tech-main");
  const required  = status==="ดำเนินการเรียบร้อย";
  techGroup.querySelector("label").innerHTML = required
    ? "ผู้ซ่อมหลัก <span style='color:var(--red)'>*</span>"
    : "ผู้ซ่อมหลัก";
  document.getElementById("inp-tech-main").required=required;

  // แสดงส่วน after photo เฉพาะตอนปิดงาน
  document.getElementById("group-after-photo").style.display=required?"block":"none";
  document.getElementById("group-assistants").style.display=required?"block":"none";
}

document.querySelectorAll(".status-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".status-btn").forEach(b=>b.classList.remove("selected"));
    btn.classList.add("selected"); state.selectedStatus=btn.dataset.status;
    updateTechRequired(btn.dataset.status);
  });
});

document.getElementById("btn-close-modal").addEventListener("click",  closeRepairModal);
document.getElementById("modal-overlay").addEventListener("click",     closeRepairModal);
function closeRepairModal(){
  document.getElementById("modal-repair").classList.add("hidden");
  state.selectedRepair=null; state.afterPhotoB64=null;
}

// ── after photo input ──
document.getElementById("after-photo-input").addEventListener("change", function(){
  const file=this.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const b64=e.target.result.split(",")[1];
    state.afterPhotoB64=b64;
    const prev=document.getElementById("after-photo-preview");
    prev.src=e.target.result; prev.style.display="block";
    document.getElementById("after-photo-label").textContent="✅ เลือกรูปแล้ว";
  };
  reader.readAsDataURL(file);
});

// ── บันทึกสถานะ ──
document.getElementById("btn-update-status").addEventListener("click", async()=>{
  if(!state.selectedRepair||!state.selectedStatus){ showToast("กรุณาเลือกสถานะ","error"); return; }

  const techMain   = document.getElementById("inp-tech-main").value.trim();
  const techAssist1= document.getElementById("inp-tech-assist1").value.trim();
  const techAssist2= document.getElementById("inp-tech-assist2").value.trim();

  // validate: ถ้าปิดงานต้องมีผู้ซ่อมหลัก
  if(state.selectedStatus==="ดำเนินการเรียบร้อย"&&!techMain){
    showToast("กรุณาระบุผู้ซ่อมหลัก","error"); return;
  }

  const btn=document.getElementById("btn-update-status");
  btn.disabled=true; btn.textContent="กำลังบันทึก...";

  const params={
    row_index:  state.selectedRepair.row_index,
    status:     state.selectedStatus,
    tech_main:  encodeURIComponent(techMain),
    tech_assist1: encodeURIComponent(techAssist1),
    tech_assist2: encodeURIComponent(techAssist2),
    date_done:  state.selectedStatus==="ดำเนินการเรียบร้อย"?getTodayStr():"",
    img_after:  ""
  };

  // อัปเดต local ทันที
  const idx=state.repairs.findIndex(r=>r.doc_no===state.selectedRepair.doc_no);
  if(idx!==-1){
    state.repairs[idx].status      = state.selectedStatus;
    state.repairs[idx].tech_main   = techMain;
    state.repairs[idx].tech_assist1= techAssist1;
    state.repairs[idx].tech_assist2= techAssist2;
    if(["ดำเนินการเรียบร้อย","ติดต่อช่างนอก"].includes(state.selectedStatus))
      state.repairs.splice(idx,1);
  }
  store(K.REPAIRS,state.repairs);
  closeRepairModal(); renderRepairs();
  showToast("✅ บันทึกแล้ว กำลัง sync...","success");
  btn.disabled=false; btn.textContent="บันทึกสถานะ";

  // upload เบื้องหลัง
  const doUpload=async()=>{
    // upload รูปหลังซ่อมถ้ามี
    if(state.afterPhotoB64){
      try{
        const fname=`after_${state.selectedRepair.doc_no}_${Date.now()}.jpg`;
        const upRes=await uploadPhotoAPI(state.afterPhotoB64, fname);
        if(upRes.success) params.img_after=encodeURIComponent(upRes.path||upRes.url||"");
      }catch(e){}
    }
    try{
      const res=await api({action:"updateRepairFull",...params});
      if(!res.success) enqueue("updateRepairFull",params);
    }catch(e){ enqueue("updateRepairFull",params); }
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
      document.getElementById("badge-outsource").textContent=res.outsource.length;
      document.getElementById("badge-pending").textContent  =res.pending_score.length;
      renderVIPList("list-outsource",res.outsource,    "ไม่มีงานติดต่อช่างนอก","rgba(231,76,60,0.15)","var(--red)","ช่างนอก");
      renderVIPList("list-pending",  res.pending_score,"ไม่มีงานรอให้คะแนน",  "rgba(241,196,15,0.15)","var(--yellow)","รอคะแนน");
    }
  }catch(e){ showToast("โหลดข้อมูล VIP ไม่ได้","error"); }
  loadUserMgmt();
}
function renderVIPList(elId,items,emptyMsg,bg,color,label){
  const list=document.getElementById(elId);
  if(!items.length){ list.innerHTML=`<div class="empty-state">${emptyMsg}</div>`; return; }
  list.innerHTML=items.map(r=>`
    <div class="repair-card">
      <div class="rc-top">
        <div class="rc-location">${r.location||"-"}</div>
        <div class="rc-status" style="background:${bg};color:${color}">${label}</div>
      </div>
      <div class="rc-desc">${r.description||"-"}</div>
      <div class="rc-meta">
        <span class="rc-tag">${r.department||"-"}</span>
        <span class="rc-tag">${r.date||""}</span>
        ${r.tech_main?`<span class="rc-tag">👷 ${r.tech_main}</span>`:""}
      </div>
    </div>`).join("");
}
document.querySelectorAll(".vip-tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    document.querySelectorAll(".vip-tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".vip-panel").forEach(p=>p.classList.add("hidden"));
    document.getElementById(`vip-${tab.dataset.vip}`).classList.remove("hidden");
  });
});

// ============================================================
//  USER MANAGEMENT
// ============================================================
async function loadUserMgmt(){
  const list=document.getElementById("user-mgmt-list");
  list.innerHTML=`<div class="loading-state"><div class="spinner"></div></div>`;
  try{
    const res=await api({action:"getUsers"});
    if(res.success){ state.users=res.users; store(K.USERS,res.users); renderUserMgmt(res.users); }
  }catch(e){ list.innerHTML=`<div class="empty-state" style="color:var(--red)">โหลดไม่ได้</div>`; }
}

function canDelete(requesterRole, targetRole){
  if(targetRole==="admin") return false;
  if(targetRole==="manager") return requesterRole==="admin";
  if(targetRole==="head_tech") return ["admin","manager"].includes(requesterRole);
  return ["admin","manager","head_tech"].includes(requesterRole);
}

function renderUserMgmt(users){
  const list=document.getElementById("user-mgmt-list");
  const myRole=state.currentUser?.role||"";
  if(!users.length){ list.innerHTML=`<div class="empty-state">ยังไม่มีผู้ใช้</div>`; return; }

  list.innerHTML=users.map(u=>`
    <div class="user-mgmt-card">
      <div class="umc-avatar">${getInitial(u.name)}</div>
      <div class="umc-info">
        <div class="umc-name">${u.name}</div>
        <div class="umc-role">${roleLabel(u.role)}</div>
      </div>
      <div class="umc-actions">
        <div class="toggle ${u.is_active?"on":""}" data-uid="${u.user_id}" title="เปิด/ปิด"></div>
        ${canDelete(myRole,u.role)?`<button class="btn-icon btn-delete-user" data-uid="${u.user_id}" data-name="${u.name}" style="color:var(--red)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>`:""}
      </div>
    </div>`).join("");

  list.querySelectorAll(".toggle").forEach(tog=>{
    tog.addEventListener("click",async()=>{
      const uid=tog.dataset.uid, wasOn=tog.classList.contains("on"), newVal=!wasOn;
      tog.classList.toggle("on",newVal);
      try{
        await api({action:"updateUser",user_id:uid,is_active:String(newVal)});
        showToast(newVal?"เปิดใช้งานแล้ว":"ปิดใช้งานแล้ว","success");
      }catch(e){ tog.classList.toggle("on",wasOn); showToast("อัปเดตไม่ได้","error"); }
    });
  });

  list.querySelectorAll(".btn-delete-user").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const uid=btn.dataset.uid, name=btn.dataset.name;
      if(!confirm(`ลบ "${name}" ออกจากระบบ?`)) return;
      try{
        const res=await api({action:"deleteUser",user_id:uid,requester_role:state.currentUser.role});
        if(res.success){ showToast(`ลบ ${name} แล้ว`,"success"); loadUserMgmt(); }
        else showToast(res.message||"ลบไม่ได้","error");
      }catch(e){ showToast("เกิดข้อผิดพลาด","error"); }
    });
  });
}

document.getElementById("btn-add-user").addEventListener("click",()=>{
  document.getElementById("input-user-name").value="";
  document.getElementById("input-user-role").value="technician";
  document.getElementById("input-user-password").value="";
  document.getElementById("group-password").style.display="none";
  document.getElementById("modal-add-user").classList.remove("hidden");
});
document.getElementById("input-user-role").addEventListener("change",function(){
  document.getElementById("group-password").style.display=
    ["head_tech","manager","admin"].includes(this.value)?"block":"none";
});
document.getElementById("btn-close-modal-user").addEventListener("click",()=>
  document.getElementById("modal-add-user").classList.add("hidden"));
document.getElementById("modal-overlay-user").addEventListener("click",()=>
  document.getElementById("modal-add-user").classList.add("hidden"));

document.getElementById("btn-confirm-add-user").addEventListener("click",async()=>{
  const name=document.getElementById("input-user-name").value.trim();
  const role=document.getElementById("input-user-role").value;
  const pw=document.getElementById("input-user-password").value.trim();
  if(!name){ showToast("กรอกชื่อก่อน","error"); return; }
  const btn=document.getElementById("btn-confirm-add-user");
  btn.disabled=true; btn.textContent="กำลังเพิ่ม...";
  try{
    const res=await api({action:"addUser",name:encodeURIComponent(name),role,password_hash:pw||""});
    if(res.success){
      showToast("✅ เพิ่มผู้ใช้แล้ว (รอ Admin เปิด)","success");
      document.getElementById("modal-add-user").classList.add("hidden");
      loadUserMgmt();
    } else showToast(res.message||"เพิ่มไม่ได้","error");
  }catch(e){ showToast("เกิดข้อผิดพลาด","error"); }
  btn.disabled=false; btn.textContent="เพิ่มผู้ใช้";
});

// ============================================================
//  LOGOUT
// ============================================================
document.getElementById("btn-logout").addEventListener("click",()=>{
  if(!confirm("ออกจากระบบ?")) return;
  localStorage.removeItem(K.SESSION);
  state.currentUser=null; state.repairs=[]; state.pinBuffer="";
  showScreen("screen-login");
  document.getElementById("section-password").classList.add("hidden");
  document.getElementById("section-select-user").classList.remove("hidden");
  loadUserList();
});
