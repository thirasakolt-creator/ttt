// ============================================================
//  MANEECHAN RESORT — app.js
//  Version: 1.1  แก้ไข: routine ไม่มี template, VIP login, error handling
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbzX4_G2astabG-Njqbn3yEzMCnSSABRmaJvHE349FXazLwAckLLMLglOkeGFcjsMttt/exec";

const state = {
  currentUser:     null,
  currentShift:    null,
  repairs:         [],
  filter:          "all",
  selectedRepair:  null,
  selectedStatus:  null,
  pinBuffer:       "",
  vipData:         null,
  users:           [],
  routineHasItems: false,
};

const CACHE_KEY_REPAIRS = "mcr_repairs";
const CACHE_KEY_USERS   = "mcr_users";
const CACHE_KEY_SESSION = "mcr_session";

function saveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(e){}
}
function loadCache(key, maxAgeMs = 5 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > maxAgeMs) return null;
    return obj.data;
  } catch(e) { return null; }
}

async function apiGet(params) {
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}?${qs}`);
  return res.json();
}
async function apiPost(body) {
  const res = await fetch(API_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  return res.json();
}

function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = `toast ${type}`;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2800);
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
//  SPLASH
// ============================================================
window.addEventListener("DOMContentLoaded", async () => {
  const session = loadCache(CACHE_KEY_SESSION, 8 * 60 * 60 * 1000);
  await new Promise(r => setTimeout(r, 1900));
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
  grid.innerHTML = `<div class="user-loading"><div class="spinner"></div><span>กำลังโหลด...</span></div>`;

  let users = loadCache(CACHE_KEY_USERS, 10 * 60 * 1000);
  if (!users) {
    try {
      const res = await apiGet({ action: "getUsers" });
      if (res.success) { users = res.users; saveCache(CACHE_KEY_USERS, users); }
    } catch(e) {
      grid.innerHTML = `<div class="user-loading" style="grid-column:1/-1;color:var(--red)">⚠️ โหลดไม่ได้</div>`;
      return;
    }
  }
  state.users = users || [];
  const techs = state.users.filter(u => u.is_active && u.role === "technician");

  if (!techs.length) {
    grid.innerHTML = `<div class="user-loading" style="grid-column:1/-1;text-align:center;line-height:1.8">
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
  saveCache(CACHE_KEY_SESSION, user);
  enterApp();
}

// VIP PIN
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
  state.pinBuffer = state.pinBuffer.slice(0, -1);
  updatePinDisplay();
});
document.getElementById("btn-pin-ok").addEventListener("click", submitPin);

function updatePinDisplay() {
  document.querySelectorAll("#pin-display span").forEach((s, i) => {
    s.classList.toggle("filled", i < state.pinBuffer.length);
  });
}

async function submitPin() {
  if (state.pinBuffer.length < 4) { showPinError("กรอกรหัสผ่านให้ครบ"); return; }
  const okBtn = document.getElementById("btn-pin-ok");
  okBtn.disabled = true; okBtn.textContent = "...";

  // โหลด users ถ้ายังไม่มี
  if (!state.users.length) {
    try {
      const r = await apiGet({ action: "getUsers" });
      if (r.success) state.users = r.users;
    } catch(e) {}
  }

  const vipUsers = state.users.filter(u => isVIP(u.role) && u.is_active);
  let found = false;
  for (const u of vipUsers) {
    try {
      const res = await apiPost({ action:"verifyLogin", user_id:u.user_id, password:state.pinBuffer });
      if (res.success) {
        found = true;
        loginAs({ user_id:res.user_id, name:res.name, role:res.role });
        break;
      }
    } catch(e) {}
  }

  if (!found) {
    showPinError("รหัสผ่านไม่ถูกต้อง");
    state.pinBuffer = ""; updatePinDisplay();
  }
  okBtn.disabled = false; okBtn.textContent = "OK";
}

function showPinError(msg) {
  const el = document.getElementById("pin-error");
  el.textContent = msg;
  el.classList.remove("hidden");
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
  navigateTo("repairs");
}

function navigateTo(page) {
  if      (page === "repairs") checkRoutineThenLoad();
  else if (page === "water")   { ensureWaterScreen(); showMainPanel("screen-water"); }
  else if (page === "vip")     { showMainPanel("screen-vip"); loadVIPData(); }
}

function ensureWaterScreen() {
  if (document.getElementById("screen-water")) return;
  const el = document.createElement("div");
  el.id = "screen-water"; el.className = "main-content";
  el.innerHTML = `<div class="water-coming-soon">
    <div class="icon">💧</div>
    <p>บันทึกระดับน้ำ</p>
    <p style="font-size:0.75rem;opacity:0.5;margin-top:4px">จะเปิดให้ใช้งานเร็วๆ นี้</p>
  </div>`;
  document.getElementById("screen-app").insertBefore(el, document.getElementById("bottom-nav"));
}

// ============================================================
//  ROUTINE
// ============================================================
async function checkRoutineThenLoad() {
  showMainPanel("screen-routine");
  const shift = state.currentShift;
  const today = getTodayStr();

  document.getElementById("routine-icon").textContent     = getShiftIcon(shift);
  document.getElementById("routine-title").textContent    = `Routine ${getShiftLabel(shift)}`;
  document.getElementById("routine-subtitle").textContent = "กรุณาทำ routine ก่อนเข้างานซ่อม";
  document.getElementById("routine-done-banner").classList.add("hidden");
  document.getElementById("btn-submit-routine").style.display = "flex";
  document.getElementById("btn-submit-routine").disabled      = false;
  document.getElementById("btn-submit-routine").innerHTML     =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> บันทึก Routine และเข้าสู่งานซ่อม`;
  document.getElementById("btn-skip-routine").style.display   = "none";

  try {
    const res = await apiGet({ action:"getRoutineLog", shift, date:today });
    if (res.done) {
      document.getElementById("routine-done-banner").classList.remove("hidden");
      document.getElementById("routine-done-text").textContent =
        `✅ ทำแล้วโดย ${res.done_by}` + (res.timestamp ? ` เวลา ${res.timestamp.split(" ")[1]||""}` : "");
      document.getElementById("btn-skip-routine").style.display   = "flex";
      document.getElementById("btn-submit-routine").style.display = "none";
      document.getElementById("routine-form-container").innerHTML = "";
      state.routineHasItems = false;
      return;
    }
  } catch(e) {}

  await loadRoutineTemplate(shift);
}

async function loadRoutineTemplate(shift) {
  const container = document.getElementById("routine-form-container");
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลด...</span></div>`;
  state.routineHasItems = false;

  try {
    const res = await apiGet({ action:"getRoutineTemplate", shift });

    if (!res.success || !res.items || res.items.length === 0) {
      // ★ ไม่มี routine — ให้ผ่านได้เลย
      container.innerHTML = `
        <div class="empty-state" style="padding:24px 0">
          <div style="font-size:2.5rem;margin-bottom:10px">✅</div>
          <p>ไม่มี routine สำหรับกะนี้</p>
          <p style="font-size:0.75rem;opacity:0.5;margin-top:6px">กดปุ่มด้านล่างเพื่อเข้าสู่งานซ่อม</p>
        </div>`;
      document.getElementById("btn-submit-routine").innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg> เข้าสู่งานซ่อม`;
      return;
    }

    state.routineHasItems = true;
    const pond1 = res.items.filter(it => it.description.includes("บ่อพัก") || it.description.includes("ประปา"));
    const pond2 = res.items.filter(it => it.description.includes("สระ"));
    const other = res.items.filter(it => !pond1.includes(it) && !pond2.includes(it));

    let html = "";
    if (pond1.length) html += renderRoutineCard("🔵 บ่อพักน้ำประปา", pond1);
    if (pond2.length) html += renderRoutineCard("🟢 สระว่ายน้ำ", pond2);
    if (other.length) html += renderRoutineCard("📋 รายการอื่นๆ", other);
    container.innerHTML = html;

  } catch(e) {
    // ★ API ล้มเหลว — ยังให้ผ่านได้
    container.innerHTML = `
      <div class="empty-state" style="padding:24px 0;color:var(--yellow)">
        <div style="font-size:2.5rem;margin-bottom:10px">⚠️</div>
        <p>โหลด routine ไม่ได้</p>
        <p style="font-size:0.75rem;opacity:0.5;margin-top:6px">กดปุ่มด้านล่างเพื่อข้ามเข้าสู่งานซ่อม</p>
      </div>`;
    document.getElementById("btn-submit-routine").innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg> ข้ามเข้าสู่งานซ่อม`;
  }
}

function renderRoutineCard(title, items) {
  const rows = items.map(it => `
    <div class="routine-input-row">
      <label>${it.description}</label>
      <input class="routine-input" type="number" step="0.1" min="0"
        id="ri_${it.item_id}" placeholder="0" inputmode="decimal"/>
      <span class="routine-unit">${it.unit||""}</span>
    </div>`).join("");
  return `<div class="routine-card"><div class="routine-card-title">${title}</div>${rows}</div>`;
}

document.getElementById("btn-submit-routine").addEventListener("click", async () => {
  const shift = state.currentShift;
  const today = getTodayStr();
  const user  = state.currentUser;
  const btn   = document.getElementById("btn-submit-routine");

  // ไม่มี routine items — ผ่านได้เลย
  if (!state.routineHasItems) { loadRepairs(); return; }

  const waterData = {};
  document.querySelectorAll(".routine-input").forEach(inp => {
    waterData[inp.id.replace("ri_","")] = inp.value || "";
  });

  btn.disabled = true; btn.textContent = "กำลังบันทึก...";

  try {
    await apiPost({ action:"saveRoutineLog", shift, date:today, done_by:user.name });
    if (shift === "morning" || shift === "night") {
      await apiPost({
        action:"saveWaterLog", date:today, shift,
        pond1_level_cm:    waterData["T001"]||waterData["T008"]||"",
        pond1_chlorine:    waterData["T002"]||"",
        pond2_level_cm:    waterData["T003"]||waterData["T009"]||"",
        pond2_chlorine:    waterData["T004"]||"",
        pond2_soda_kg:     waterData["T005"]||"",
        pond2_chlorine_kg: waterData["T006"]||"",
        done_by:           user.name
      });
    }
    showToast("✅ บันทึก routine เรียบร้อย", "success");
    setTimeout(() => loadRepairs(), 600);
  } catch(e) {
    // ★ บันทึกไม่ได้ก็ยังผ่านไปได้
    showToast("⚠️ บันทึกไม่ได้ แต่เข้างานซ่อมได้", "");
    setTimeout(() => loadRepairs(), 1200);
  }
});

document.getElementById("btn-skip-routine").addEventListener("click", () => loadRepairs());

// ============================================================
//  REPAIRS
// ============================================================
async function loadRepairs() {
  showMainPanel("screen-repairs");
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.nav === "repairs");
  });

  const list = document.getElementById("repair-list");
  list.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลดงาน...</span></div>`;

  const cached = loadCache(CACHE_KEY_REPAIRS, 3 * 60 * 1000);
  if (cached) { state.repairs = cached; renderRepairs(); }

  try {
    const res = await apiGet({ action:"getRepairs" });
    if (res.success) {
      state.repairs = res.data;
      saveCache(CACHE_KEY_REPAIRS, res.data);
      renderRepairs();
    }
  } catch(e) {
    if (!cached) list.innerHTML = `<div class="empty-state" style="color:var(--red)">⚠️ โหลดงานไม่ได้</div>`;
  }
}

function renderRepairs() {
  const list  = document.getElementById("repair-list");
  let items   = state.repairs;
  if (state.filter !== "all") items = items.filter(r => r.status === state.filter);

  if (!items.length) { list.innerHTML = `<div class="empty-state">🎉 ไม่มีงานค้าง</div>`; return; }

  list.innerHTML = items.map(r => {
    const st  = r.status || "";
    const lbl = st === "" ? "ใหม่" : st;
    const cls = st === "" ? "new"  : st;
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

document.getElementById("btn-refresh").addEventListener("click", () => loadRepairs());

// ============================================================
//  REPAIR MODAL
// ============================================================
function openRepairModal(item) {
  state.selectedRepair = item;
  state.selectedStatus = item.status || null;
  document.getElementById("modal-doc-no").textContent   = `#${item.doc_no}`;
  document.getElementById("modal-location").textContent = item.location||"ไม่ระบุ";
  document.getElementById("modal-date").textContent     = item.date||"-";
  document.getElementById("modal-dept").textContent     = item.department||"-";
  document.getElementById("modal-reporter").textContent = item.reporter||"-";
  document.getElementById("modal-type").textContent     = item.problem_type||"-";
  document.getElementById("modal-desc").textContent     = item.description||"-";
  const techRow = document.getElementById("modal-tech-row");
  if (item.tech_main) {
    document.getElementById("modal-tech").textContent = item.tech_main;
    techRow.style.display = "flex";
  } else { techRow.style.display = "none"; }
  document.querySelectorAll(".status-btn").forEach(b => b.classList.toggle("selected", b.dataset.status === item.status));
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
  if (!state.selectedRepair || !state.selectedStatus) { showToast("กรุณาเลือกสถานะ","error"); return; }
  const btn = document.getElementById("btn-update-status");
  btn.disabled = true; btn.textContent = "กำลังบันทึก...";
  try {
    const res = await apiPost({
      action:"updateRepairStatus",
      row_index: state.selectedRepair.row_index,
      status:    state.selectedStatus,
      tech_main: state.currentUser.name,
      date_done: state.selectedStatus === "ดำเนินการเรียบร้อย" ? getTodayStr() : ""
    });
    if (res.success) {
      const idx = state.repairs.findIndex(r => r.doc_no === state.selectedRepair.doc_no);
      if (idx !== -1) { state.repairs[idx].status = state.selectedStatus; state.repairs[idx].tech_main = state.currentUser.name; }
      saveCache(CACHE_KEY_REPAIRS, state.repairs);
      showToast("✅ อัปเดตสถานะเรียบร้อย","success");
      closeRepairModal(); renderRepairs();
    } else {
      showToast("⚠️ "+(res.message||"เกิดข้อผิดพลาด"),"error");
      btn.disabled = false; btn.textContent = "บันทึกสถานะ";
    }
  } catch(e) {
    showToast("บันทึกไม่ได้ ลองใหม่","error");
    btn.disabled = false; btn.textContent = "บันทึกสถานะ";
  }
});

// ============================================================
//  VIP
// ============================================================
async function loadVIPData() {
  try {
    const res = await apiGet({ action:"getRepairsVIP" });
    if (res.success) {
      document.getElementById("badge-outsource").textContent = res.outsource.length;
      document.getElementById("badge-pending").textContent   = res.pending_score.length;
      renderVIPList("list-outsource", res.outsource, "ไม่มีงานติดต่อช่างนอก", "rgba(231,76,60,0.15)", "var(--red)", "ช่างนอก");
      renderVIPList("list-pending",   res.pending_score, "ไม่มีงานรอให้คะแนน",   "rgba(241,196,15,0.15)","var(--yellow)","รอคะแนน");
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
    const res = await apiGet({ action:"getUsers" });
    if (res.success) { state.users = res.users; renderUserMgmt(res.users); }
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
        await apiPost({ action:"updateUser", user_id:uid, is_active:newVal });
        showToast(newVal ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว","success");
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
    const res = await apiPost({ action:"addUser", name, role, password_hash:pw||"" });
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
  localStorage.removeItem(CACHE_KEY_SESSION);
  state.currentUser = null; state.repairs = []; state.pinBuffer = "";
  showScreen("screen-login");
  document.getElementById("section-password").classList.add("hidden");
  document.getElementById("section-select-user").classList.remove("hidden");
  loadUserList();
});
