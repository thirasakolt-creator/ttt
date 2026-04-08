// ============================================================
//  MANEECHAN RESORT — app.js  v2.0
//  Offline-First: แสดงจาก cache ทันที, sync เบื้องหลัง
//  Routine: ทำแค่ครั้งเดียวต่อกะต่อวัน (เก็บใน localStorage)
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbzX4_G2astabG-Njqbn3yEzMCnSSABRmaJvHE349FXazLwAckLLMLglOkeGFcjsMttt/exec";

// ============================================================
//  STATE
// ============================================================
const state = {
  currentUser:     null,
  currentShift:    null,
  repairs:         [],       // งานซ่อมที่แสดงอยู่ (จาก cache)
  filter:          "all",
  selectedRepair:  null,
  selectedStatus:  null,
  pinBuffer:       "",
  users:           [],
  routineHasItems: false,
  syncTimer:       null,
};

// ============================================================
//  STORAGE KEYS
// ============================================================
const K = {
  SESSION:      "mcr_session",       // user ที่ login อยู่
  REPAIRS:      "mcr_repairs_v2",    // cache งานซ่อม (array)
  REPAIRS_TS:   "mcr_repairs_ts",    // timestamp ล่าสุดที่ sync
  USERS:        "mcr_users_v2",      // cache users
  ROUTINE_DONE: "mcr_routine_done",  // { "morning_2026-04-08": {done_by,ts}, ... }
  QUEUE:        "mcr_queue",         // คิว action ที่รอ upload
};

// ============================================================
//  STORAGE HELPERS
// ============================================================
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){}
}
function load(key, def = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch(e) { return def; }
}

// ============================================================
//  QUEUE — บันทึก action ที่รอ upload
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
//  API — GET เท่านั้น (แก้ CORS)
// ============================================================
async function api(params) {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============================================================
//  UTILS
// ============================================================
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = `toast ${type}`;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2500);
}
function getShiftLabel(s) {
  return { morning:"กะเช้า 🌅", afternoon:"กะเที่ยง ☀️", night:"กะดึก 🌙" }[s] || s;
}
function getShiftIcon(s) {
  return { morning:"🌅", afternoon:"☀️", night:"🌙" }[s] || "🔧";
}
function detectShift() {
  const h = new Date().getHours();
  if (h >= 6  && h < 14) return "morning";
  if (h >= 14 && h < 22) return "afternoon";
  return "night";
}
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function roleLabel(r) {
  return { admin:"Admin", manager:"ผู้จัดการ", head_tech:"หัวหน้าช่าง", technician:"ช่าง" }[r] || r;
}
function isVIP(r) { return ["admin","manager","head_tech"].includes(r); }
function getInitial(n) { return n ? n.charAt(0).toUpperCase() : "?"; }

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
function showMainPanel(id) {
  document.querySelectorAll(".main-content").forEach(p => p.classList.add("hidden"));
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}

// ============================================================
//  ROUTINE DONE KEY  เช่น "morning_2026-04-08"
// ============================================================
function routineKey(shift, date) { return `${shift}_${date}`; }

function isRoutineDoneToday(shift) {
  const today = getTodayStr();
  const done  = load(K.ROUTINE_DONE, {});
  return !!done[routineKey(shift, today)];
}

function markRoutineDone(shift, doneBy) {
  const today = getTodayStr();
  const done  = load(K.ROUTINE_DONE, {});
  done[routineKey(shift, today)] = { done_by: doneBy, ts: Date.now() };
  store(K.ROUTINE_DONE, done);

  // ล้าง key เก่า (เก็บแค่ 7 วัน)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  Object.keys(done).forEach(k => { if (done[k].ts < cutoff) delete done[k]; });
  store(K.ROUTINE_DONE, done);
}

function getRoutineDoneBy(shift) {
  const today = getTodayStr();
  const done  = load(K.ROUTINE_DONE, {});
  return done[routineKey(shift, today)]?.done_by || "";
}

// ============================================================
//  SPLASH
// ============================================================
window.addEventListener("DOMContentLoaded", async () => {
  const session = load(K.SESSION);
  await new Promise(r => setTimeout(r, 1500));
  document.getElementById("splash").style.display = "none";

  if (session) {
    state.currentUser = session;
    enterApp();
  } else {
    showScreen("screen-login");
    loadUserList();
  }
});

// ============================================================
//  LOGIN
// ============================================================
async function loadUserList() {
  const grid = document.getElementById("user-list");

  // แสดง cache ทันที
  const cached = load(K.USERS, []);
  state.users  = cached;
  renderUserGrid(cached);

  // โหลดใหม่เบื้องหลัง
  try {
    const res = await api({ action: "getUsers" });
    if (res.success) {
      state.users = res.users;
      store(K.USERS, res.users);
      renderUserGrid(res.users);
    }
  } catch(e) {
    if (!cached.length) {
      grid.innerHTML = `<div class="user-loading" style="grid-column:1/-1;color:var(--red)">⚠️ โหลดไม่ได้</div>`;
    }
  }
}

function renderUserGrid(users) {
  const grid  = document.getElementById("user-list");
  const techs = users.filter(u => u.is_active && u.role === "technician");

  if (!techs.length) {
    grid.innerHTML = `<div class="user-loading" style="grid-column:1/-1;text-align:center;line-height:2">
      ยังไม่มีช่างในระบบ<br>
      <small style="opacity:0.5">ใช้ปุ่ม "เข้าด้วยรหัสผ่าน" ด้านล่าง</small></div>`;
    return;
  }

  grid.innerHTML = techs.map(u => `
    <div class="user-card" data-uid="${u.user_id}">
      <div class="uc-avatar">${getInitial(u.name)}</div>
      <div class="uc-name">${u.name}</div>
      <div class="uc-role">${roleLabel(u.role)}</div>
    </div>`).join("");

  grid.querySelectorAll(".user-card").forEach(card => {
    card.addEventListener("click", () => {
      const user = state.users.find(u => u.user_id === card.dataset.uid);
      if (user) loginAs(user);
    });
  });
}

function loginAs(user) {
  state.currentUser = user;
  store(K.SESSION, user);
  enterApp();
}

// ── VIP PIN ──
document.getElementById("btn-vip-login").addEventListener("click", () => {
  state.pinBuffer = "";
  updatePinDisplay();
  document.getElementById("pin-error").classList.add("hidden");
  document.getElementById("password-label").textContent = "กรอกรหัสผ่าน";
  document.getElementById("section-select-user").classList.add("hidden");
  document.getElementById("section-password").classList.remove("hidden");
});
document.getElementById("btn-back-login").addEventListener("click", () => {
  document.getElementById("section-password").classList.add("hidden");
  document.getElementById("section-select-user").classList.remove("hidden");
});
document.querySelectorAll(".num-btn[data-num]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (state.pinBuffer.length >= 6) return;
    state.pinBuffer += btn.dataset.num;
    updatePinDisplay();
  });
});
document.getElementById("btn-pin-clear").addEventListener("click", () => {
  state.pinBuffer = state.pinBuffer.slice(0,-1); updatePinDisplay();
});
document.getElementById("btn-pin-ok").addEventListener("click", submitPin);

function updatePinDisplay() {
  document.querySelectorAll("#pin-display span").forEach((s,i) =>
    s.classList.toggle("filled", i < state.pinBuffer.length));
}

async function submitPin() {
  if (state.pinBuffer.length < 4) { showPinError("กรอกรหัสผ่านให้ครบ"); return; }
  const okBtn = document.getElementById("btn-pin-ok");
  okBtn.disabled = true; okBtn.textContent = "...";

  const vipUsers = state.users.filter(u => isVIP(u.role) && u.is_active);
  let found = false;
  for (const u of vipUsers) {
    try {
      const res = await api({ action:"verifyLogin", user_id:u.user_id, password:state.pinBuffer });
      if (res.success) { found = true; loginAs({ user_id:res.user_id, name:res.name, role:res.role }); break; }
    } catch(e) {}
  }
  if (!found) { showPinError("รหัสผ่านไม่ถูกต้อง"); state.pinBuffer=""; updatePinDisplay(); }
  okBtn.disabled = false; okBtn.textContent = "OK";
}
function showPinError(msg) {
  const el = document.getElementById("pin-error");
  el.textContent = msg; el.classList.remove("hidden");
}

// ============================================================
//  ENTER APP
// ============================================================
function enterApp() {
  const user = state.currentUser;
  if (!user) { showScreen("screen-login"); return; }

  state.currentShift = detectShift();
  showScreen("screen-app");

  document.getElementById("topbar-name").textContent = user.name || "ผู้ใช้";
  document.getElementById("topbar-role").textContent = roleLabel(user.role);
  document.getElementById("shift-badge").textContent = getShiftLabel(state.currentShift);
  document.getElementById("nav-vip").classList.toggle("hidden", !isVIP(user.role));

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      navigateTo(btn.dataset.nav);
    });
  });

  // flush queue เบื้องหลัง
  flushQueue().catch(()=>{});

  navigateTo("repairs");
}

function navigateTo(page) {
  if      (page === "repairs") checkRoutineGate();
  else if (page === "water")   { ensureWaterScreen(); showMainPanel("screen-water"); }
  else if (page === "vip")     { showMainPanel("screen-vip"); loadVIPData(); }
}

function ensureWaterScreen() {
  if (document.getElementById("screen-water")) return;
  const el = document.createElement("div");
  el.id = "screen-water"; el.className = "main-content";
  el.innerHTML = `<div class="water-coming-soon">
    <div class="icon">💧</div><p>บันทึกระดับน้ำ</p>
    <p style="font-size:0.75rem;opacity:0.5;margin-top:4px">จะเปิดให้ใช้งานเร็วๆ นี้</p></div>`;
  document.getElementById("screen-app").insertBefore(el, document.getElementById("bottom-nav"));
}

// ============================================================
//  ROUTINE GATE — ตรวจสอบแบบ instant จาก cache
// ============================================================
function checkRoutineGate() {
  const shift = state.currentShift;

  // ★ เช็คจาก localStorage ทันที ไม่รอ API
  if (isRoutineDoneToday(shift)) {
    // routine ทำแล้ววันนี้ → ข้ามไปงานซ่อมทันที
    loadRepairsInstant();
    return;
  }

  // ยังไม่ได้ทำ → แสดงหน้า routine
  showRoutineForm(shift);
}

// ============================================================
//  ROUTINE FORM — แสดงทันทีจาก template ใน cache
// ============================================================
function showRoutineForm(shift) {
  showMainPanel("screen-routine");

  document.getElementById("routine-icon").textContent     = getShiftIcon(shift);
  document.getElementById("routine-title").textContent    = `Routine ${getShiftLabel(shift)}`;
  document.getElementById("routine-subtitle").textContent = "บันทึก routine แล้วเข้างานซ่อมได้เลย";
  document.getElementById("routine-done-banner").classList.add("hidden");
  document.getElementById("btn-skip-routine").style.display   = "none";

  const submitBtn = document.getElementById("btn-submit-routine");
  submitBtn.style.display = "flex";
  submitBtn.disabled      = false;
  submitBtn.innerHTML     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> บันทึก และเข้างานซ่อม`;

  // โหลด template จาก cache ก่อนทันที
  const cachedTemplate = load(`mcr_tmpl_${shift}`, null);
  if (cachedTemplate) {
    renderRoutineItems(cachedTemplate);
  } else {
    document.getElementById("routine-form-container").innerHTML =
      `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลด...</span></div>`;
  }

  // โหลด template จาก API เบื้องหลัง
  api({ action:"getRoutineTemplate", shift }).then(res => {
    if (res.success && res.items) {
      store(`mcr_tmpl_${shift}`, res.items);
      renderRoutineItems(res.items);
    }
  }).catch(()=>{
    if (!cachedTemplate) {
      // ไม่มี cache, API ล้มเหลว → ให้ผ่านได้เลย
      document.getElementById("routine-form-container").innerHTML =
        `<div class="empty-state" style="padding:24px 0">
          <div style="font-size:2.5rem;margin-bottom:10px">✅</div>
          <p>โหลด routine ไม่ได้</p>
          <p style="font-size:0.75rem;opacity:0.5;margin-top:6px">กดปุ่มด้านล่างเพื่อเข้างานซ่อม</p>
        </div>`;
      submitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg> เข้าสู่งานซ่อม`;
      state.routineHasItems = false;
    }
  });
}

function renderRoutineItems(items) {
  state.routineHasItems = items && items.length > 0;

  if (!state.routineHasItems) {
    document.getElementById("routine-form-container").innerHTML =
      `<div class="empty-state" style="padding:24px 0">
        <div style="font-size:2.5rem;margin-bottom:10px">✅</div>
        <p>ไม่มี routine สำหรับกะนี้</p>
      </div>`;
    document.getElementById("btn-submit-routine").innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg> เข้าสู่งานซ่อม`;
    return;
  }

  const pond1 = items.filter(it => it.description.includes("บ่อพัก") || it.description.includes("ประปา"));
  const pond2 = items.filter(it => it.description.includes("สระ"));
  const other = items.filter(it => !pond1.includes(it) && !pond2.includes(it));

  let html = "";
  if (pond1.length) html += buildRoutineCard("🔵 บ่อพักน้ำประปา", pond1);
  if (pond2.length) html += buildRoutineCard("🟢 สระว่ายน้ำ", pond2);
  if (other.length) html += buildRoutineCard("📋 รายการอื่นๆ", other);
  document.getElementById("routine-form-container").innerHTML = html;
}

function buildRoutineCard(title, items) {
  const rows = items.map(it => `
    <div class="routine-input-row">
      <label>${it.description}</label>
      <input class="routine-input" type="number" step="0.1" min="0"
        id="ri_${it.item_id}" placeholder="0" inputmode="decimal"/>
      <span class="routine-unit">${it.unit||""}</span>
    </div>`).join("");
  return `<div class="routine-card"><div class="routine-card-title">${title}</div>${rows}</div>`;
}

// ============================================================
//  ROUTINE SUBMIT — บันทึก local ก่อน → ไปหน้างาน → upload เบื้องหลัง
// ============================================================
document.getElementById("btn-submit-routine").addEventListener("click", () => {
  const shift = state.currentShift;
  const today = getTodayStr();
  const user  = state.currentUser;

  if (!state.routineHasItems) {
    // ไม่มี item — mark done แล้วผ่าน
    markRoutineDone(shift, user.name);
    loadRepairsInstant(); return;
  }

  // เก็บค่า inputs
  const waterData = {};
  document.querySelectorAll(".routine-input").forEach(inp => {
    waterData[inp.id.replace("ri_","")] = inp.value || "0";
  });

  // ★ 1. mark done ใน local ทันที
  markRoutineDone(shift, user.name);

  // ★ 2. ไปหน้างานซ่อมทันที
  loadRepairsInstant();

  // ★ 3. upload เบื้องหลัง
  const uploadRoutine = async () => {
    try {
      const logRes = await api({ action:"saveRoutineLog", shift, date:today, done_by:user.name });
      if (!logRes.success && !logRes.duplicate) enqueue("saveRoutineLog", { shift, date:today, done_by:user.name });
    } catch(e) { enqueue("saveRoutineLog", { shift, date:today, done_by:user.name }); }

    if (shift === "morning" || shift === "night") {
      const wParams = {
        date:today, shift,
        pond1_level_cm:    waterData["T001"]||waterData["T008"]||"",
        pond1_chlorine:    waterData["T002"]||"",
        pond2_level_cm:    waterData["T003"]||waterData["T009"]||"",
        pond2_chlorine:    waterData["T004"]||"",
        pond2_soda_kg:     waterData["T005"]||"",
        pond2_chlorine_kg: waterData["T006"]||"",
        done_by:           user.name
      };
      try {
        const wRes = await api({ action:"saveWaterLog", ...wParams });
        if (!wRes.success) enqueue("saveWaterLog", wParams);
      } catch(e) { enqueue("saveWaterLog", wParams); }
    }
  };
  uploadRoutine().catch(()=>{});
});

document.getElementById("btn-skip-routine").addEventListener("click", () => loadRepairsInstant());

// ============================================================
//  REPAIRS — INSTANT LOAD (จาก cache ก่อนเสมอ)
// ============================================================
function loadRepairsInstant() {
  showMainPanel("screen-repairs");
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.nav === "repairs"));

  // ★ แสดง cache ทันที
  const cached = load(K.REPAIRS, []);
  if (cached.length) {
    state.repairs = cached;
    renderRepairs();
  } else {
    document.getElementById("repair-list").innerHTML =
      `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลดครั้งแรก...</span></div>`;
  }

  // ★ sync เบื้องหลัง
  syncRepairsBackground();
}

// ============================================================
//  BACKGROUND SYNC — diff แล้วอัปเดตเฉพาะที่เปลี่ยน
// ============================================================
async function syncRepairsBackground() {
  try {
    const res = await api({ action:"getRepairs" });
    if (!res.success) return;

    const fresh     = res.data;           // ข้อมูลใหม่จาก API
    const oldMap    = {};
    state.repairs.forEach(r => { oldMap[r.doc_no] = r; });

    const freshMap  = {};
    fresh.forEach(r => { freshMap[r.doc_no] = r; });

    // เพิ่มใหม่ / อัปเดต
    let changed = false;
    fresh.forEach(r => {
      const old = oldMap[r.doc_no];
      if (!old || old.status !== r.status || old.tech_main !== r.tech_main) changed = true;
    });

    // ลบที่หายไป (ปิดงานแล้ว)
    const oldCount = state.repairs.length;
    if (fresh.length !== oldCount) changed = true;

    if (changed) {
      state.repairs = fresh;
      store(K.REPAIRS, fresh);
      renderRepairs();
      // แสดง badge เบาๆ ว่ามีการอัปเดต
      showSyncBadge();
    }
  } catch(e) { /* ไม่แสดง error ถ้า sync ล้มเหลว */ }
}

function showSyncBadge() {
  const el = document.getElementById("btn-refresh");
  if (!el) return;
  el.style.color = "var(--gold)";
  setTimeout(() => { el.style.color = ""; }, 2000);
}

// ============================================================
//  RENDER REPAIRS
// ============================================================
function renderRepairs() {
  const list  = document.getElementById("repair-list");
  let   items = state.repairs;
  if (state.filter !== "all") items = items.filter(r => r.status === state.filter);

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">🎉 ไม่มีงานค้าง</div>`;
    return;
  }

  list.innerHTML = items.map(r => {
    const st  = r.status || "";
    const lbl = st === "" ? "ใหม่" : st;
    const cls = st === "" ? "new"  : st;
    return `
      <div class="repair-card status-${cls}" data-docno="${r.doc_no}">
        <div class="rc-top">
          <div class="rc-location">${r.location || "ไม่ระบุสถานที่"}</div>
          <div class="rc-status s-${cls}">${lbl}</div>
        </div>
        <div class="rc-desc">${r.description || "-"}</div>
        <div class="rc-meta">
          <span class="rc-tag">${r.department || "-"}</span>
          <span class="rc-tag">${r.problem_type || "-"}</span>
          <span class="rc-tag">${r.date || ""}</span>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".repair-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = state.repairs.find(r => r.doc_no === card.dataset.docno);
      if (item) openRepairModal(item);
    });
  });
}

document.getElementById("filter-tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.filter = btn.dataset.filter;
  renderRepairs();
});

document.getElementById("btn-refresh").addEventListener("click", () => {
  showToast("กำลัง sync...", "");
  syncRepairsBackground();
});

// ============================================================
//  REPAIR MODAL
// ============================================================
function openRepairModal(item) {
  state.selectedRepair = item;
  state.selectedStatus = item.status || null;

  document.getElementById("modal-doc-no").textContent   = `#${item.doc_no}`;
  document.getElementById("modal-location").textContent = item.location || "ไม่ระบุ";
  document.getElementById("modal-date").textContent     = item.date || "-";
  document.getElementById("modal-dept").textContent     = item.department || "-";
  document.getElementById("modal-reporter").textContent = item.reporter || "-";
  document.getElementById("modal-type").textContent     = item.problem_type || "-";
  document.getElementById("modal-desc").textContent     = item.description || "-";

  const techRow = document.getElementById("modal-tech-row");
  if (item.tech_main) {
    document.getElementById("modal-tech").textContent = item.tech_main;
    techRow.style.display = "flex";
  } else { techRow.style.display = "none"; }

  document.querySelectorAll(".status-btn").forEach(b =>
    b.classList.toggle("selected", b.dataset.status === item.status));
  document.getElementById("btn-update-status").disabled    = false;
  document.getElementById("btn-update-status").textContent = "บันทึกสถานะ";
  document.getElementById("modal-repair").classList.remove("hidden");
}

document.getElementById("btn-close-modal").addEventListener("click",  closeRepairModal);
document.getElementById("modal-overlay").addEventListener("click",     closeRepairModal);
function closeRepairModal() {
  document.getElementById("modal-repair").classList.add("hidden");
  state.selectedRepair = null;
}

document.querySelectorAll(".status-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".status-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    state.selectedStatus = btn.dataset.status;
  });
});

document.getElementById("btn-update-status").addEventListener("click", async () => {
  if (!state.selectedRepair || !state.selectedStatus) {
    showToast("กรุณาเลือกสถานะ","error"); return;
  }
  const btn = document.getElementById("btn-update-status");
  btn.disabled = true; btn.textContent = "กำลังบันทึก...";

  const params = {
    row_index: state.selectedRepair.row_index,
    status:    state.selectedStatus,
    tech_main: state.currentUser.name,
    date_done: state.selectedStatus === "ดำเนินการเรียบร้อย" ? getTodayStr() : ""
  };

  // ★ อัปเดต local ทันที
  const idx = state.repairs.findIndex(r => r.doc_no === state.selectedRepair.doc_no);
  if (idx !== -1) {
    state.repairs[idx].status    = state.selectedStatus;
    state.repairs[idx].tech_main = state.currentUser.name;
    // ถ้าปิดงาน → เอาออกจาก list
    if (["ดำเนินการเรียบร้อย","ติดต่อช่างนอก"].includes(state.selectedStatus)) {
      state.repairs.splice(idx, 1);
    }
  }
  store(K.REPAIRS, state.repairs);
  closeRepairModal();
  renderRepairs();
  showToast("✅ บันทึกแล้ว (กำลัง sync...)", "success");
  btn.disabled = false; btn.textContent = "บันทึกสถานะ";

  // ★ upload เบื้องหลัง
  try {
    const res = await api({ action:"updateRepairStatus", ...params });
    if (!res.success) enqueue("updateRepairStatus", params);
  } catch(e) { enqueue("updateRepairStatus", params); }
});

// ============================================================
//  VIP
// ============================================================
async function loadVIPData() {
  try {
    const res = await api({ action:"getRepairsVIP" });
    if (res.success) {
      document.getElementById("badge-outsource").textContent = res.outsource.length;
      document.getElementById("badge-pending").textContent   = res.pending_score.length;
      renderVIPList("list-outsource", res.outsource,     "ไม่มีงานติดต่อช่างนอก", "rgba(231,76,60,0.15)",  "var(--red)",    "ช่างนอก");
      renderVIPList("list-pending",   res.pending_score, "ไม่มีงานรอให้คะแนน",   "rgba(241,196,15,0.15)", "var(--yellow)", "รอคะแนน");
    }
  } catch(e) { showToast("โหลดข้อมูล VIP ไม่ได้","error"); }
  loadUserMgmt();
}

function renderVIPList(elId, items, emptyMsg, bg, color, label) {
  const list = document.getElementById(elId);
  if (!items.length) { list.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; return; }
  list.innerHTML = items.map(r => `
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

document.querySelectorAll(".vip-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".vip-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".vip-panel").forEach(p => p.classList.add("hidden"));
    document.getElementById(`vip-${tab.dataset.vip}`).classList.remove("hidden");
  });
});

// ============================================================
//  USER MANAGEMENT
// ============================================================
async function loadUserMgmt() {
  const list = document.getElementById("user-mgmt-list");
  list.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  try {
    const res = await api({ action:"getUsers" });
    if (res.success) { state.users = res.users; store(K.USERS, res.users); renderUserMgmt(res.users); }
  } catch(e) { list.innerHTML = `<div class="empty-state" style="color:var(--red)">โหลดไม่ได้</div>`; }
}

function renderUserMgmt(users) {
  const list = document.getElementById("user-mgmt-list");
  if (!users.length) { list.innerHTML = `<div class="empty-state">ยังไม่มีผู้ใช้</div>`; return; }
  list.innerHTML = users.map(u => `
    <div class="user-mgmt-card">
      <div class="umc-avatar">${getInitial(u.name)}</div>
      <div class="umc-info">
        <div class="umc-name">${u.name}</div>
        <div class="umc-role">${roleLabel(u.role)}</div>
      </div>
      <div class="umc-actions">
        <div class="toggle ${u.is_active?"on":""}" data-uid="${u.user_id}"></div>
      </div>
    </div>`).join("");

  list.querySelectorAll(".toggle").forEach(tog => {
    tog.addEventListener("click", async () => {
      const uid    = tog.dataset.uid;
      const wasOn  = tog.classList.contains("on");
      const newVal = !wasOn;
      tog.classList.toggle("on", newVal);
      try {
        await api({ action:"updateUser", user_id:uid, is_active:String(newVal) });
        showToast(newVal?"เปิดใช้งานแล้ว":"ปิดใช้งานแล้ว","success");
      } catch(e) { tog.classList.toggle("on", wasOn); showToast("อัปเดตไม่ได้","error"); }
    });
  });
}

document.getElementById("btn-add-user").addEventListener("click", () => {
  document.getElementById("input-user-name").value     = "";
  document.getElementById("input-user-role").value     = "technician";
  document.getElementById("input-user-password").value = "";
  document.getElementById("group-password").style.display = "none";
  document.getElementById("modal-add-user").classList.remove("hidden");
});
document.getElementById("input-user-role").addEventListener("change", function() {
  document.getElementById("group-password").style.display =
    ["head_tech","manager","admin"].includes(this.value) ? "block" : "none";
});
document.getElementById("btn-close-modal-user").addEventListener("click", () =>
  document.getElementById("modal-add-user").classList.add("hidden"));
document.getElementById("modal-overlay-user").addEventListener("click", () =>
  document.getElementById("modal-add-user").classList.add("hidden"));

document.getElementById("btn-confirm-add-user").addEventListener("click", async () => {
  const name = document.getElementById("input-user-name").value.trim();
  const role = document.getElementById("input-user-role").value;
  const pw   = document.getElementById("input-user-password").value.trim();
  if (!name) { showToast("กรอกชื่อก่อน","error"); return; }
  const btn = document.getElementById("btn-confirm-add-user");
  btn.disabled = true; btn.textContent = "กำลังเพิ่ม...";
  try {
    const res = await api({ action:"addUser", name, role, password_hash:pw||"" });
    if (res.success) {
      showToast("✅ เพิ่มผู้ใช้แล้ว (รอ Admin เปิด)","success");
      document.getElementById("modal-add-user").classList.add("hidden");
      loadUserMgmt();
    } else { showToast(res.message||"เพิ่มไม่ได้","error"); }
  } catch(e) { showToast("เกิดข้อผิดพลาด","error"); }
  btn.disabled = false; btn.textContent = "เพิ่มผู้ใช้";
});

// ============================================================
//  LOGOUT
// ============================================================
document.getElementById("btn-logout").addEventListener("click", () => {
  if (!confirm("ออกจากระบบ?")) return;
  localStorage.removeItem(K.SESSION);
  state.currentUser = null; state.repairs = []; state.pinBuffer = "";
  showScreen("screen-login");
  document.getElementById("section-password").classList.add("hidden");
  document.getElementById("section-select-user").classList.remove("hidden");
  loadUserList();
});
