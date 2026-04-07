// ============================================================
//  MANEECHAN RESORT — app.js
//  Version: 1.0
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbzX4_G2astabG-Njqbn3yEzMCnSSABRmaJvHE349FXazLwAckLLMLglOkeGFcjsMttt/exec";

// ============================================================
//  STATE
// ============================================================
const state = {
  currentUser:  null,   // { user_id, name, role }
  currentShift: null,   // "morning" | "afternoon" | "night"
  repairs:      [],
  filter:       "all",
  selectedRepair: null,
  selectedStatus: null,
  pinBuffer:    "",
  pinTarget:    null,   // "vip" | user_id
  vipData:      null,
  users:        [],
};

// ============================================================
//  CACHE HELPERS
// ============================================================
const CACHE_KEY_REPAIRS  = "mcr_repairs";
const CACHE_KEY_USERS    = "mcr_users";
const CACHE_KEY_SESSION  = "mcr_session";

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

// ============================================================
//  API HELPERS
// ============================================================
async function apiGet(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}?${qs}`);
  return res.json();
}
async function apiPost(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ============================================================
//  UTILS
// ============================================================
function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), 2800);
}

function getShiftLabel(shift) {
  return { morning: "กะเช้า 🌅", afternoon: "กะเที่ยง ☀️", night: "กะดึก 🌙" }[shift] || shift;
}
function getShiftIcon(shift) {
  return { morning: "🌅", afternoon: "☀️", night: "🌙" }[shift] || "🔧";
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

function roleLabel(role) {
  return { admin: "Admin", manager: "ผู้จัดการ", head_tech: "หัวหน้าช่าง", technician: "ช่าง" }[role] || role;
}
function isVIP(role) {
  return ["admin","manager","head_tech"].includes(role);
}

function getInitial(name) {
  return name ? name.charAt(0).toUpperCase() : "?";
}

// ============================================================
//  SHOW / HIDE SCREENS
// ============================================================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
function showMainPanel(id) {
  document.querySelectorAll(".main-content").forEach(p => p.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ============================================================
//  SPLASH
// ============================================================
window.addEventListener("DOMContentLoaded", async () => {
  // restore session
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
//  LOGIN — LOAD USER LIST
// ============================================================
async function loadUserList() {
  const grid = document.getElementById("user-list");

  // try cache first
  let users = loadCache(CACHE_KEY_USERS, 10 * 60 * 1000);
  if (!users) {
    try {
      const res = await apiGet({ action: "getUsers" });
      if (res.success) {
        users = res.users;
        saveCache(CACHE_KEY_USERS, users);
      }
    } catch(e) {
      grid.innerHTML = `<div class="user-loading" style="grid-column:1/-1;color:#e74c3c">โหลดไม่ได้ ลองใหม่</div>`;
      return;
    }
  }

  state.users = users;
  // แสดงเฉพาะ active technician
  const techs = users.filter(u => u.is_active && u.role === "technician");

  if (techs.length === 0) {
    grid.innerHTML = `<div class="user-loading" style="grid-column:1/-1">ยังไม่มีช่างในระบบ</div>`;
    return;
  }

  grid.innerHTML = techs.map(u => `
    <div class="user-card" data-uid="${u.user_id}">
      <div class="uc-avatar">${getInitial(u.name)}</div>
      <div class="uc-name">${u.name}</div>
      <div class="uc-role">${roleLabel(u.role)}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".user-card").forEach(card => {
    card.addEventListener("click", () => {
      const uid  = card.dataset.uid;
      const user = users.find(u => u.user_id === uid);
      loginAs(user);
    });
  });
}

// ============================================================
//  LOGIN — TECHNICIAN (no PIN)
// ============================================================
function loginAs(user) {
  state.currentUser = user;
  saveCache(CACHE_KEY_SESSION, user);
  enterApp();
}

// ============================================================
//  LOGIN — VIP (PIN)
// ============================================================
document.getElementById("btn-vip-login").addEventListener("click", () => {
  state.pinBuffer = "";
  state.pinTarget = "vip";
  document.getElementById("password-label").textContent = "กรอกรหัสผ่าน";
  document.getElementById("pin-error").classList.add("hidden");
  updatePinDisplay();
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
  const spans = document.querySelectorAll("#pin-display span");
  spans.forEach((s, i) => {
    s.classList.toggle("filled", i < state.pinBuffer.length);
  });
}

async function submitPin() {
  if (state.pinBuffer.length < 4) {
    showPinError("กรอกรหัสผ่านให้ครบ");
    return;
  }
  // ค้นหา user ที่รหัสตรง
  try {
    const res = await apiPost({
      action:   "verifyLogin",
      user_id:  "find_by_password",
      password: state.pinBuffer
    });
    // fallback: ค้นหาจาก users ที่โหลดแล้ว
    const matched = state.users.find(u =>
      isVIP(u.role) && u.is_active
    );
    // ลองส่งตรงๆ ทีละ user
    await loginVIP(state.pinBuffer);
  } catch(e) {
    showPinError("เกิดข้อผิดพลาด");
  }
}

async function loginVIP(pin) {
  // ค้นหา VIP users แล้วทดสอบรหัส
  const vipUsers = state.users.filter(u => isVIP(u.role) && u.is_active);
  for (const u of vipUsers) {
    const res = await apiPost({ action: "verifyLogin", user_id: u.user_id, password: pin });
    if (res.success) {
      loginAs(res);
      return;
    }
  }
  showPinError("รหัสผ่านไม่ถูกต้อง");
  state.pinBuffer = "";
  updatePinDisplay();
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
  state.currentShift = detectShift();

  showScreen("screen-app");

  // set topbar
  document.getElementById("topbar-name").textContent = user.name || "ผู้ใช้";
  document.getElementById("topbar-role").textContent = roleLabel(user.role);
  document.getElementById("shift-badge").textContent = getShiftLabel(state.currentShift);

  // show VIP nav if needed
  if (isVIP(user.role)) {
    document.getElementById("nav-vip").classList.remove("hidden");
  }

  // setup bottom nav
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      navigateTo(btn.dataset.nav);
    });
  });

  // go to routine check first
  navigateTo("repairs");
}

// ============================================================
//  NAVIGATION
// ============================================================
function navigateTo(page) {
  if (page === "repairs") {
    checkRoutineThenLoad();
  } else if (page === "water") {
    showMainPanel("screen-water") || showWaterPlaceholder();
  } else if (page === "vip") {
    showMainPanel("screen-vip");
    loadVIPData();
  }
}

function showWaterPlaceholder() {
  // สร้าง water screen ถ้ายังไม่มี
  if (!document.getElementById("screen-water")) {
    const el = document.createElement("div");
    el.id = "screen-water";
    el.className = "main-content";
    el.innerHTML = `
      <div class="water-coming-soon">
        <div class="icon">💧</div>
        <p>บันทึกระดับน้ำ</p>
        <p style="font-size:0.75rem;opacity:0.5">หน้านี้จะเปิดเร็วๆ นี้</p>
      </div>`;
    document.getElementById("screen-app").insertBefore(
      el, document.getElementById("bottom-nav")
    );
  }
  showMainPanel("screen-water");
}

// ============================================================
//  ROUTINE CHECK
// ============================================================
async function checkRoutineThenLoad() {
  showMainPanel("screen-routine");

  const shift = state.currentShift;
  const today = getTodayStr();

  document.getElementById("routine-icon").textContent  = getShiftIcon(shift);
  document.getElementById("routine-title").textContent = `Routine ${getShiftLabel(shift)}`;

  // เช็ค routine log ว่ามีคนทำแล้วหรือยัง
  try {
    const res = await apiGet({ action: "getRoutineLog", shift, date: today });
    if (res.done) {
      // มีคนทำแล้ว — ข้ามได้เลย
      document.getElementById("routine-done-banner").classList.remove("hidden");
      document.getElementById("routine-done-text").textContent =
        `✅ ${getShiftLabel(shift)} ทำแล้วโดย ${res.done_by} เวลา ${res.timestamp ? res.timestamp.split(" ")[1] : ""}`;
      document.getElementById("btn-skip-routine").style.display = "flex";
      document.getElementById("routine-form-container").innerHTML = "";
      document.getElementById("btn-submit-routine").style.display = "none";
    } else {
      document.getElementById("routine-done-banner").classList.add("hidden");
      document.getElementById("btn-submit-routine").style.display = "flex";
      document.getElementById("btn-skip-routine").style.display = "none";
      await loadRoutineTemplate(shift);
    }
  } catch(e) {
    // offline — แสดง form เลย
    await loadRoutineTemplate(shift);
  }
}

// ============================================================
//  ROUTINE TEMPLATE
// ============================================================
async function loadRoutineTemplate(shift) {
  const container = document.getElementById("routine-form-container");
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลด...</span></div>`;

  try {
    const res = await apiGet({ action: "getRoutineTemplate", shift });
    if (!res.success || res.items.length === 0) {
      container.innerHTML = `<div class="empty-state">ไม่มี routine สำหรับกะนี้</div>`;
      document.getElementById("btn-submit-routine").textContent = "เข้าสู่งานซ่อมเลย";
      return;
    }

    // กลุ่ม: บ่อ 1, บ่อ 2, อื่นๆ
    const pond1 = res.items.filter(it => it.description.includes("บ่อพัก") || it.description.includes("ประปา"));
    const pond2 = res.items.filter(it => it.description.includes("สระ"));
    const other = res.items.filter(it => !pond1.includes(it) && !pond2.includes(it));

    let html = "";
    if (pond1.length) html += renderRoutineCard("🔵 บ่อพักน้ำประปา", pond1);
    if (pond2.length) html += renderRoutineCard("🟢 สระว่ายน้ำ", pond2);
    if (other.length) html += renderRoutineCard("📋 รายการอื่นๆ", other);

    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">โหลดไม่ได้</div>`;
  }
}

function renderRoutineCard(title, items) {
  const rows = items.map(it => `
    <div class="routine-input-row">
      <label>${it.description}</label>
      <input class="routine-input" type="number" step="0.1" min="0"
        id="ri_${it.item_id}" placeholder="0" />
      <span class="routine-unit">${it.unit || ""}</span>
    </div>
  `).join("");
  return `
    <div class="routine-card">
      <div class="routine-card-title">${title}</div>
      ${rows}
    </div>`;
}

// ============================================================
//  ROUTINE SUBMIT
// ============================================================
document.getElementById("btn-submit-routine").addEventListener("click", async () => {
  const shift = state.currentShift;
  const today = getTodayStr();
  const user  = state.currentUser;

  // เก็บค่า water log
  const waterData = {};
  document.querySelectorAll(".routine-input").forEach(inp => {
    waterData[inp.id.replace("ri_", "")] = inp.value || "";
  });

  const btn = document.getElementById("btn-submit-routine");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    // บันทึก routine log
    const logRes = await apiPost({
      action:   "saveRoutineLog",
      shift, date: today, done_by: user.name
    });

    // บันทึก water log (ถ้ากะที่มีการวัด)
    if (shift === "morning" || shift === "night") {
      await apiPost({
        action:           "saveWaterLog",
        date:             today,
        shift,
        pond1_level_cm:   waterData["T001"] || waterData["T008"] || "",
        pond1_chlorine:   waterData["T002"] || "",
        pond2_level_cm:   waterData["T003"] || waterData["T009"] || "",
        pond2_chlorine:   waterData["T004"] || "",
        pond2_soda_kg:    waterData["T005"] || "",
        pond2_chlorine_kg:waterData["T006"] || "",
        done_by:          user.name
      });
    }

    showToast("✅ บันทึก routine เรียบร้อย", "success");
    setTimeout(() => {
      loadRepairs();
    }, 800);
  } catch(e) {
    showToast("บันทึกไม่ได้ ลองใหม่", "error");
    btn.disabled = false;
    btn.textContent = "บันทึก Routine และเข้าสู่งานซ่อม";
  }
});

document.getElementById("btn-skip-routine").addEventListener("click", () => {
  loadRepairs();
});

// ============================================================
//  LOAD REPAIRS
// ============================================================
async function loadRepairs() {
  showMainPanel("screen-repairs");
  const list = document.getElementById("repair-list");
  list.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>กำลังโหลดงาน...</span></div>`;

  // ลองโหลดจาก cache ก่อน
  const cached = loadCache(CACHE_KEY_REPAIRS, 3 * 60 * 1000);
  if (cached) {
    state.repairs = cached;
    renderRepairs();
  }

  // โหลดใหม่จาก API
  try {
    const res = await apiGet({ action: "getRepairs" });
    if (res.success) {
      state.repairs = res.data;
      saveCache(CACHE_KEY_REPAIRS, res.data);
      renderRepairs();
    }
  } catch(e) {
    if (!cached) {
      list.innerHTML = `<div class="empty-state" style="color:var(--red)">โหลดงานไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต</div>`;
    }
  }
}

function renderRepairs() {
  const list   = document.getElementById("repair-list");
  const filter = state.filter;

  let items = state.repairs;
  if (filter !== "all") {
    items = items.filter(r => r.status === filter);
  }

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">🎉 ไม่มีงานค้าง</div>`;
    return;
  }

  list.innerHTML = items.map(r => {
    const statusClass = r.status === "" ? "new" : r.status;
    const statusLabel = r.status === "" ? "ใหม่" : r.status;
    return `
      <div class="repair-card status-${statusClass}" data-docno="${r.doc_no}">
        <div class="rc-top">
          <div class="rc-location">${r.location || "ไม่ระบุสถานที่"}</div>
          <div class="rc-status s-${statusClass}">${statusLabel}</div>
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

// ============================================================
//  FILTER TABS
// ============================================================
document.getElementById("filter-tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  state.filter = btn.dataset.filter;
  renderRepairs();
});

// ============================================================
//  REFRESH
// ============================================================
document.getElementById("btn-refresh").addEventListener("click", () => {
  loadRepairs();
});

// ============================================================
//  REPAIR MODAL
// ============================================================
function openRepairModal(item) {
  state.selectedRepair = item;
  state.selectedStatus = item.status || null;

  document.getElementById("modal-doc-no").textContent  = `#${item.doc_no}`;
  document.getElementById("modal-location").textContent = item.location || "ไม่ระบุ";
  document.getElementById("modal-date").textContent     = item.date || "-";
  document.getElementById("modal-dept").textContent     = item.department || "-";
  document.getElementById("modal-reporter").textContent = item.reporter || "-";
  document.getElementById("modal-type").textContent     = item.problem_type || "-";
  document.getElementById("modal-desc").textContent     = item.description || "-";

  if (item.tech_main) {
    document.getElementById("modal-tech").textContent = item.tech_main;
    document.getElementById("modal-tech-row").style.display = "flex";
  } else {
    document.getElementById("modal-tech-row").style.display = "none";
  }

  // set selected status button
  document.querySelectorAll(".status-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.status === item.status);
  });

  document.getElementById("modal-repair").classList.remove("hidden");
}

document.getElementById("btn-close-modal").addEventListener("click", closeRepairModal);
document.getElementById("modal-overlay").addEventListener("click", closeRepairModal);
function closeRepairModal() {
  document.getElementById("modal-repair").classList.add("hidden");
  state.selectedRepair = null;
}

// เลือกสถานะ
document.querySelectorAll(".status-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".status-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    state.selectedStatus = btn.dataset.status;
  });
});

// บันทึกสถานะ
document.getElementById("btn-update-status").addEventListener("click", async () => {
  if (!state.selectedRepair || !state.selectedStatus) {
    showToast("กรุณาเลือกสถานะ", "error");
    return;
  }

  const btn = document.getElementById("btn-update-status");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    const res = await apiPost({
      action:     "updateRepairStatus",
      row_index:  state.selectedRepair.row_index,
      status:     state.selectedStatus,
      tech_main:  state.currentUser.name,
      date_done:  state.selectedStatus === "ดำเนินการเรียบร้อย" ? getTodayStr() : ""
    });

    if (res.success) {
      // อัปเดต state local
      const idx = state.repairs.findIndex(r => r.doc_no === state.selectedRepair.doc_no);
      if (idx !== -1) {
        state.repairs[idx].status = state.selectedStatus;
        state.repairs[idx].tech_main = state.currentUser.name;
      }
      saveCache(CACHE_KEY_REPAIRS, state.repairs);

      showToast("✅ อัปเดตสถานะเรียบร้อย", "success");
      closeRepairModal();
      renderRepairs();
    } else {
      showToast("เกิดข้อผิดพลาด: " + res.message, "error");
    }
  } catch(e) {
    showToast("บันทึกไม่ได้ ลองใหม่", "error");
  }

  btn.disabled = false;
  btn.textContent = "บันทึกสถานะ";
});

// ============================================================
//  VIP DATA
// ============================================================
async function loadVIPData() {
  try {
    const res = await apiGet({ action: "getRepairsVIP" });
    if (res.success) {
      state.vipData = res;
      document.getElementById("badge-outsource").textContent = res.outsource.length;
      document.getElementById("badge-pending").textContent   = res.pending_score.length;
      renderVIPOutsource(res.outsource);
      renderVIPPending(res.pending_score);
    }
  } catch(e) {
    showToast("โหลดข้อมูล VIP ไม่ได้", "error");
  }

  // load users for management
  loadUserMgmt();
}

function renderVIPOutsource(items) {
  const list = document.getElementById("list-outsource");
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">ไม่มีงานติดต่อช่างนอก</div>`;
    return;
  }
  list.innerHTML = items.map(r => `
    <div class="repair-card">
      <div class="rc-top">
        <div class="rc-location">${r.location || "-"}</div>
        <div class="rc-status" style="background:rgba(231,76,60,0.15);color:var(--red)">ช่างนอก</div>
      </div>
      <div class="rc-desc">${r.description || "-"}</div>
      <div class="rc-meta">
        <span class="rc-tag">${r.department || "-"}</span>
        <span class="rc-tag">${r.date || ""}</span>
        ${r.tech_main ? `<span class="rc-tag">👷 ${r.tech_main}</span>` : ""}
      </div>
    </div>`).join("");
}

function renderVIPPending(items) {
  const list = document.getElementById("list-pending");
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">ไม่มีงานรอให้คะแนน</div>`;
    return;
  }
  list.innerHTML = items.map(r => `
    <div class="repair-card">
      <div class="rc-top">
        <div class="rc-location">${r.location || "-"}</div>
        <div class="rc-status" style="background:rgba(241,196,15,0.15);color:var(--yellow)">รอคะแนน</div>
      </div>
      <div class="rc-desc">${r.description || "-"}</div>
      <div class="rc-meta">
        <span class="rc-tag">${r.department || "-"}</span>
        <span class="rc-tag">${r.date || ""}</span>
        ${r.tech_main ? `<span class="rc-tag">👷 ${r.tech_main}</span>` : ""}
      </div>
    </div>`).join("");
}

// ============================================================
//  VIP TABS
// ============================================================
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
    const res = await apiGet({ action: "getUsers" });
    if (res.success) {
      state.users = res.users;
      renderUserMgmt(res.users);
    }
  } catch(e) {
    list.innerHTML = `<div class="empty-state" style="color:var(--red)">โหลดไม่ได้</div>`;
  }
}

function renderUserMgmt(users) {
  const list = document.getElementById("user-mgmt-list");
  if (users.length === 0) {
    list.innerHTML = `<div class="empty-state">ยังไม่มีผู้ใช้</div>`;
    return;
  }
  list.innerHTML = users.map(u => `
    <div class="user-mgmt-card">
      <div class="umc-avatar">${getInitial(u.name)}</div>
      <div class="umc-info">
        <div class="umc-name">${u.name}</div>
        <div class="umc-role">${roleLabel(u.role)}</div>
      </div>
      <div class="umc-actions">
        <div class="toggle ${u.is_active ? "on" : ""}" data-uid="${u.user_id}" title="${u.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}"></div>
      </div>
    </div>`).join("");

  list.querySelectorAll(".toggle").forEach(tog => {
    tog.addEventListener("click", async () => {
      const uid     = tog.dataset.uid;
      const isOn    = tog.classList.contains("on");
      const newVal  = !isOn;
      tog.classList.toggle("on", newVal);

      try {
        await apiPost({ action: "updateUser", user_id: uid, is_active: newVal });
        showToast(newVal ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว", "success");
      } catch(e) {
        tog.classList.toggle("on", isOn); // revert
        showToast("อัปเดตไม่ได้", "error");
      }
    });
  });
}

// Add user modal
document.getElementById("btn-add-user").addEventListener("click", () => {
  document.getElementById("input-user-name").value = "";
  document.getElementById("input-user-role").value = "technician";
  document.getElementById("input-user-password").value = "";
  document.getElementById("group-password").style.display = "none";
  document.getElementById("modal-add-user").classList.remove("hidden");
});

document.getElementById("input-user-role").addEventListener("change", function() {
  const needsPw = ["head_tech","manager","admin"].includes(this.value);
  document.getElementById("group-password").style.display = needsPw ? "block" : "none";
});

document.getElementById("btn-close-modal-user").addEventListener("click", () => {
  document.getElementById("modal-add-user").classList.add("hidden");
});
document.getElementById("modal-overlay-user").addEventListener("click", () => {
  document.getElementById("modal-add-user").classList.add("hidden");
});

document.getElementById("btn-confirm-add-user").addEventListener("click", async () => {
  const name = document.getElementById("input-user-name").value.trim();
  const role = document.getElementById("input-user-role").value;
  const pw   = document.getElementById("input-user-password").value.trim();

  if (!name) { showToast("กรอกชื่อก่อน", "error"); return; }

  const btn = document.getElementById("btn-confirm-add-user");
  btn.disabled = true;
  btn.textContent = "กำลังเพิ่ม...";

  try {
    const res = await apiPost({
      action:        "addUser",
      name, role,
      password_hash: pw || ""
    });

    if (res.success) {
      showToast("✅ เพิ่มผู้ใช้แล้ว (รอ Admin เปิด)", "success");
      document.getElementById("modal-add-user").classList.add("hidden");
      loadUserMgmt();
    } else {
      showToast(res.message || "เพิ่มไม่ได้", "error");
    }
  } catch(e) {
    showToast("เกิดข้อผิดพลาด", "error");
  }

  btn.disabled = false;
  btn.textContent = "เพิ่มผู้ใช้";
});

// ============================================================
//  LOGOUT
// ============================================================
document.getElementById("btn-logout").addEventListener("click", () => {
  if (!confirm("ออกจากระบบ?")) return;
  localStorage.removeItem(CACHE_KEY_SESSION);
  state.currentUser = null;
  state.repairs = [];
  state.pinBuffer = "";
  showScreen("screen-login");
  document.getElementById("section-password").classList.add("hidden");
  document.getElementById("section-select-user").classList.remove("hidden");
  loadUserList();
});
