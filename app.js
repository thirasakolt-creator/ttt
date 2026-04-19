// ============================================================
// มณีจันทร์รีสอร์ท - Maintenance App
// app.js - Core application logic
// ============================================================

// ===== CONFIG =====
// แก้ URL นี้หลังจาก Deploy Google Apps Script เสร็จแล้ว
const API_URL = window.APP_CONFIG?.apiUrl || 'YOUR_APPS_SCRIPT_WEB_APP_URL';

// ===== STATE =====
const state = {
  currentUser: null,
  currentShift: null,
  routineStatus: {},
  repairJobs: [],
  currentJob: null,
  selectedImages: [],
  isLoading: false,
};

// ===== API CLIENT =====
const api = {
  async get(action, params = {}) {
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Network error: ' + res.status);
    return res.json();
  },

  async post(body) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Network error: ' + res.status);
    return res.json();
  },
};

// ===== UI HELPERS =====
function showLoading(msg = 'กำลังโหลด...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');

  // Update bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageId);
  });
}

function updateHeader() {
  if (!state.currentUser) return;
  document.getElementById('header-username').textContent = state.currentUser.name;
  const roleMap = { technician: 'ช่าง', head_tech: 'หัวหน้าช่าง', manager: 'ผู้จัดการ', admin: 'แอดมิน' };
  document.getElementById('header-role').textContent = roleMap[state.currentUser.role] || state.currentUser.role;
  document.getElementById('header-shift').textContent = state.currentShift ? `กะ${shiftName(state.currentShift)}` : '';
}

function shiftName(shift) {
  const map = { morning: 'เช้า', afternoon: 'บ่าย', night: 'ดึก' };
  return map[shift] || shift;
}

function thaiDate(d) {
  return d ? d.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
}

// ===== LOGIN =====
async function initLogin() {
  showLoading('กำลังโหลดรายชื่อ...');
  try {
    const users = await api.get('getUsers');
    renderTechGrid(users);
    renderAdminSelect(users);
  } catch (e) {
    showToast('โหลดข้อมูลไม่ได้ กรุณาตรวจสอบ connection', 'error');
  } finally {
    hideLoading();
  }
}

function renderTechGrid(users) {
  const techs = users.filter(u => u.role === 'technician');
  const grid = document.getElementById('tech-grid');
  grid.innerHTML = techs.map(u => `
    <button class="tech-btn" onclick="loginAsTech('${u.user_id}', '${u.name}')">
      <div class="tech-avatar">${u.name.charAt(0)}</div>
      <span>${u.name}</span>
    </button>
  `).join('');
}

function renderAdminSelect(users) {
  const admins = users.filter(u => u.role !== 'technician');
  const sel = document.getElementById('admin-select');
  sel.innerHTML = '<option value="">-- เลือกผู้ใช้งาน --</option>' +
    admins.map(u => `<option value="${u.user_id}">${u.name} (${u.role})</option>`).join('');
}

async function loginAsTech(userId, name) {
  showLoading('กำลังเข้าสู่ระบบ...');
  try {
    const result = await api.post({ action: 'login', user_id: userId });
    if (result.success) {
      state.currentUser = result.user;
      await proceedToShiftSelect();
    } else {
      showToast(result.message || 'เข้าสู่ระบบไม่ได้', 'error');
    }
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

async function loginAsAdmin() {
  const userId = document.getElementById('admin-select').value;
  const password = document.getElementById('admin-password').value;
  if (!userId) { showToast('กรุณาเลือกผู้ใช้งาน', 'error'); return; }

  showLoading('กำลังเข้าสู่ระบบ...');
  try {
    const result = await api.post({ action: 'login', user_id: userId, password });
    if (result.success) {
      state.currentUser = result.user;
      await proceedToShiftSelect();
    } else {
      showToast(result.message || 'รหัสผ่านไม่ถูกต้อง', 'error');
    }
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ===== SHIFT SELECT =====
async function proceedToShiftSelect() {
  showPage('shift');
  updateHeader();
  renderShiftSelect();
}

async function renderShiftSelect() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = document.getElementById('shift-greeting');
  greeting.textContent = `สวัสดี, ${state.currentUser.name} 👋`;
  document.getElementById('shift-date').textContent = thaiDate(now);

  // Determine available shifts
  let availableShifts = [];
  if (hour >= 8 && hour < 15) {
    availableShifts = ['morning', 'afternoon'];
  } else {
    availableShifts = ['afternoon', 'night'];
  }

  // Fetch routine status for each shift
  showLoading('ตรวจสอบสถานะ...');
  try {
    for (const shift of ['morning', 'afternoon', 'night']) {
      const status = await api.get('getRoutineStatus', { shift });
      state.routineStatus[shift] = status;
    }
  } catch (e) {}
  hideLoading();

  const shiftData = {
    morning: { icon: '🌅', label: 'กะเช้า', time: '08:00 – 15:00' },
    afternoon: { icon: '☀️', label: 'กะบ่าย', time: '15:00 – 22:00' },
    night: { icon: '🌙', label: 'กะดึก', time: '22:00 – 08:00' },
  };

  const container = document.getElementById('shift-options');
  container.innerHTML = availableShifts.map(s => {
    const sd = shiftData[s];
    const done = state.routineStatus[s]?.isDone;
    return `
      <div class="shift-card ${done ? 'done' : ''}" onclick="selectShift('${s}')">
        <div class="shift-icon ${s}">${sd.icon}</div>
        <div class="shift-info">
          <div class="shift-name">${sd.label}</div>
          <div class="shift-time">${sd.time}</div>
          ${done ? `<div style="font-size:11px;color:var(--success);margin-top:4px">✓ บันทึกแล้ว โดย ${state.routineStatus[s].doneBy}</div>` : ''}
        </div>
        ${done ? '<span class="shift-done-badge">✓ เสร็จแล้ว</span>' : ''}
      </div>
    `;
  }).join('');
}

async function selectShift(shift) {
  state.currentShift = shift;
  updateHeader();

  // Log this login
  try {
    await api.post({ action: 'logShift', user_id: state.currentUser.user_id, name: state.currentUser.name, shift });
  } catch (e) {}

  // Check if routine done
  if (state.routineStatus[shift]?.isDone) {
    // Go directly to repair page
    showPage('main');
    loadRepairJobs();
    setNavPage('repair');
  } else if (shift === 'night') {
    // Night shift - skip routine (not implemented yet)
    showPage('main');
    loadRepairJobs();
    setNavPage('repair');
    showToast('กะดึก: ข้ามลูทีนไปหน้างานซ่อม');
  } else {
    // Show routine
    showPage('main');
    setNavPage('routine');
    initRoutinePage(shift);
  }
}

// ===== BOTTOM NAV =====
function setNavPage(name) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === name);
  });
  document.querySelectorAll('.main-tab-content').forEach(tab => {
    tab.classList.toggle('hidden', tab.dataset.tab !== name);
  });
}

// ===== ROUTINE PAGE =====
function initRoutinePage(shift) {
  const container = document.getElementById('routine-content');
  if (shift === 'morning') {
    container.innerHTML = buildMorningRoutine();
  } else if (shift === 'afternoon') {
    initAfternoonRoutine(container);
  }
}

function buildMorningRoutine() {
  return `
    <div class="routine-header">
      <div class="routine-title">🌅 ลูทีนกะเช้า</div>
      <div class="routine-shift">วัดค่าน้ำและสารเคมี</div>
    </div>

    <div class="pond-section">
      <div class="pond-title">💧 บ่อพักน้ำประปา</div>
      <div class="form-group">
        <label class="form-label">การยุบตัวของน้ำ</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.1" id="pond1_level" placeholder="0.0">
          <span class="form-unit">ซม.</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">ค่าคลอรีน</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.01" id="pond1_chlorine" placeholder="0.0">
          <span class="form-unit">จุด</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">คลอรีนที่ใส่</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.1" id="pond1_chlorine_kg" placeholder="0.0">
          <span class="form-unit">กก.</span>
        </div>
      </div>
    </div>

    <div class="pond-section">
      <div class="pond-title">🏊 บ่อพักน้ำสระว่ายน้ำ</div>
      <div class="form-group">
        <label class="form-label">การยุบตัวของน้ำ</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.1" id="pond2_level" placeholder="0.0">
          <span class="form-unit">ซม.</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">ค่า CL (คลอรีน)</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.01" id="pond2_cl" placeholder="0.0">
          <span class="form-unit">จุด</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">ค่า pH</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.01" id="pond2_ph" placeholder="0.0">
          <span class="form-unit">จุด</span>
        </div>
      </div>

      <div style="font-size:13px;font-weight:700;color:var(--text-secondary);margin-bottom:10px">สารเคมีที่ใส่</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group">
          <label class="form-label">คลอรีน</label>
          <div class="input-with-unit">
            <input class="form-input" type="number" step="0.1" id="pond2_chlorine_kg" placeholder="0">
            <span class="form-unit">กก.</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">โซดาแอช</label>
          <div class="input-with-unit">
            <input class="form-input" type="number" step="0.1" id="pond2_soda_kg" placeholder="0">
            <span class="form-unit">กก.</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">พูลเคลียร์</label>
          <div class="input-with-unit">
            <input class="form-input" type="number" step="0.1" id="pond2_poolclear_l" placeholder="0">
            <span class="form-unit">ล.</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">F-2000</label>
          <div class="input-with-unit">
            <input class="form-input" type="number" step="0.1" id="pond2_f2000_l" placeholder="0">
            <span class="form-unit">ล.</span>
          </div>
        </div>
      </div>
    </div>

    <button class="btn btn-primary btn-full btn-lg" onclick="submitMorningRoutine()">
      ✅ บันทึกลูทีนกะเช้า
    </button>
  `;
}

async function initAfternoonRoutine(container) {
  // Get chlorine rotation
  let rotation = { today_point: '...' };
  try {
    rotation = await api.get('getChlorineRotation');
  } catch (e) {}

  const today = new Date();
  const isMonday = today.getDay() === 1; // Monday

  container.innerHTML = `
    <div class="routine-header">
      <div class="routine-title">☀️ ลูทีนกะบ่าย</div>
      <div class="routine-shift">วัดระดับน้ำและคลอรีนปลายทาง</div>
    </div>

    <div class="pond-section">
      <div class="pond-title">💧 วัดระดับน้ำ (การยุบตัว)</div>
      <div class="form-group">
        <label class="form-label">บ่อพักน้ำประปา</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.1" id="aft_pond1_level" placeholder="0.0">
          <span class="form-unit">ซม.</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">บ่อพักน้ำสระว่ายน้ำ</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.1" id="aft_pond2_level" placeholder="0.0">
          <span class="form-unit">ซม.</span>
        </div>
      </div>
    </div>

    <div class="chlorine-point-display">
      <div class="chlorine-label">จุดวัดคลอรีนปลายทางวันนี้</div>
      <div class="chlorine-today">${rotation.today_point}</div>
      <div style="font-size:11px;opacity:0.7">เวียน: ครัวใหญ่ → ห้องอาหาร → สจ๊วต</div>
    </div>

    <div class="pond-section">
      <div class="pond-title">🧪 ตรวจคลอรีนปลายทาง</div>
      <div class="form-group">
        <label class="form-label">ค่าคลอรีน ณ ${rotation.today_point}</label>
        <div class="input-with-unit">
          <input class="form-input" type="number" step="0.01" id="aft_endpoint_cl" placeholder="0.0">
          <span class="form-unit">จุด</span>
        </div>
      </div>
      <input type="hidden" id="aft_endpoint_point" value="${rotation.today_point}">
    </div>

    ${isMonday ? `
    <div class="pond-section">
      <div class="pond-title">🔥 ตรวจแก๊ส (ประจำสัปดาห์ - วันจันทร์)</div>
      <div class="form-group">
        <label class="form-label">สถานะแก๊ส</label>
        <div class="gas-check">
          <div class="gas-option normal" id="gas-normal" onclick="selectGas('normal')">✓ ปกติ</div>
          <div class="gas-option abnormal" id="gas-abnormal" onclick="selectGas('abnormal')">⚠ ไม่ปกติ</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">รูปภาพยืนยันการตรวจแก๊ส (4-5 รูป)</label>
        <div class="image-upload-area" onclick="document.getElementById('gas-image-input').click()">
          <div style="font-size:24px;margin-bottom:4px">📷</div>
          <div style="font-size:13px;color:var(--text-muted)">แตะเพื่อถ่ายรูปหรือเลือกรูป</div>
        </div>
        <input type="file" id="gas-image-input" accept="image/*" multiple capture="environment" class="hidden" onchange="handleGasImages(this)">
        <div id="gas-image-preview" class="upload-preview"></div>
      </div>
    </div>
    ` : ''}

    <button class="btn btn-primary btn-full btn-lg" onclick="submitAfternoonRoutine()">
      ✅ บันทึกลูทีนกะบ่าย
    </button>
  `;
}

let selectedGas = '';
function selectGas(type) {
  selectedGas = type;
  document.getElementById('gas-normal')?.classList.toggle('selected', type === 'normal');
  document.getElementById('gas-abnormal')?.classList.toggle('selected', type === 'abnormal');
}

const gasImages = [];
function handleGasImages(input) {
  const files = Array.from(input.files);
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = e => {
      gasImages.push({ dataUrl: e.target.result, file: f });
      renderGasImagePreview();
    };
    reader.readAsDataURL(f);
  });
}

function renderGasImagePreview() {
  const preview = document.getElementById('gas-image-preview');
  if (!preview) return;
  preview.innerHTML = gasImages.map((img, i) => `
    <div class="upload-preview-item">
      <img src="${img.dataUrl}">
      <button class="remove-preview" onclick="removeGasImage(${i})">✕</button>
    </div>
  `).join('');
}

function removeGasImage(i) {
  gasImages.splice(i, 1);
  renderGasImagePreview();
}

async function submitMorningRoutine() {
  const data = {
    pond1_level_cm: document.getElementById('pond1_level')?.value || '',
    pond1_chlorine: document.getElementById('pond1_chlorine')?.value || '',
    pond1_chlorine_kg: document.getElementById('pond1_chlorine_kg')?.value || '',
    pond2_level_cm: document.getElementById('pond2_level')?.value || '',
    pond2_cl: document.getElementById('pond2_cl')?.value || '',
    pond2_ph: document.getElementById('pond2_ph')?.value || '',
    pond2_chlorine_kg: document.getElementById('pond2_chlorine_kg')?.value || '',
    pond2_soda_kg: document.getElementById('pond2_soda_kg')?.value || '',
    pond2_f2000_l: document.getElementById('pond2_f2000_l')?.value || '',
    pond2_poolclear_l: document.getElementById('pond2_poolclear_l')?.value || '',
  };
  await submitRoutine('morning', data);
}

async function submitAfternoonRoutine() {
  const data = {
    pond1_level_cm: document.getElementById('aft_pond1_level')?.value || '',
    pond2_level_cm: document.getElementById('aft_pond2_level')?.value || '',
    endpoint_cl: document.getElementById('aft_endpoint_cl')?.value || '',
    endpoint_point: document.getElementById('aft_endpoint_point')?.value || '',
    gas_status: selectedGas,
    photos: [],
  };

  // Upload gas images if any
  if (gasImages.length > 0) {
    showLoading('กำลังอัพโหลดรูปภาพ...');
    try {
      for (const img of gasImages) {
        const base64 = img.dataUrl.split(',')[1];
        const r = await api.post({
          action: 'uploadImage',
          base64data: base64,
          filename: img.file.name,
          mime_type: img.file.type,
        });
        if (r.success) data.photos.push(r.url);
      }
    } catch (e) {}
  }

  await submitRoutine('afternoon', data);
}

async function submitRoutine(shift, data) {
  showLoading('กำลังบันทึก...');
  try {
    const result = await api.post({
      action: 'saveRoutine',
      shift,
      done_by: state.currentUser.name,
      data,
    });
    if (result.success) {
      state.routineStatus[shift] = { isDone: true, doneBy: state.currentUser.name };
      showToast('บันทึกลูทีนสำเร็จ! ✅', 'success');
      // Go to repair page
      setTimeout(() => {
        setNavPage('repair');
        loadRepairJobs();
      }, 1000);
    } else {
      showToast(result.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ===== REPAIR PAGE =====
let currentFilter = 'all';

async function loadRepairJobs(filter = 'all') {
  currentFilter = filter;
  showLoading('โหลดงานซ่อม...');
  try {
    const result = await api.get('getRepairJobs', { filter });
    state.repairJobs = result.jobs || [];
    renderRepairJobs();
  } catch (e) {
    showToast('โหลดงานซ่อมไม่ได้', 'error');
  } finally {
    hideLoading();
  }
}

function renderRepairJobs() {
  // Update stats
  const total = state.repairJobs.length;
  const acknowledged = state.repairJobs.filter(j => j.simple_status === 'รับทราบ').length;
  const purchasing = state.repairJobs.filter(j => j.simple_status === 'รอจัดซื้ออุปกรณ์').length;
  const empty = state.repairJobs.filter(j => j.simple_status === 'ว่างเปล่า').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-acknowledged').textContent = acknowledged;
  document.getElementById('stat-purchasing').textContent = purchasing;

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === currentFilter);
  });

  // Job list
  const list = document.getElementById('repair-list');
  if (state.repairJobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <div class="empty-text">ไม่มีงานค้างอยู่</div>
        <div class="empty-sub">งานทั้งหมดเสร็จสิ้นแล้ว</div>
      </div>
    `;
    return;
  }

  const statusBadge = {
    'ว่างเปล่า': '<span class="badge badge-empty">ใหม่</span>',
    'รับทราบ': '<span class="badge badge-acknowledged">รับทราบ</span>',
    'รอจัดซื้ออุปกรณ์': '<span class="badge badge-purchasing">รอจัดซื้อ</span>',
    'ติดต่อช่างนอก': '<span class="badge badge-outside">ช่างนอก</span>',
  };

  list.innerHTML = state.repairJobs.map(job => `
    <div class="job-card" onclick="openJobDetail(${job.doc_no})">
      <div class="job-thumb">
        ${job.before_url ? `<img src="${job.before_url}" onerror="this.parentElement.innerHTML='🔧'" loading="lazy">` : '🔧'}
      </div>
      <div class="job-info">
        <div class="job-location">${job.location || '-'}</div>
        <div class="job-detail">${job.detail || '-'}</div>
        <div class="job-meta">
          <span class="job-date">📅 ${job.date}</span>
          ${statusBadge[job.simple_status] || ''}
        </div>
      </div>
    </div>
  `).join('');
}

async function openJobDetail(docNo) {
  showLoading('โหลดรายละเอียด...');
  try {
    const job = await api.get('getRepairJobById', { doc_no: docNo });
    state.currentJob = job;
    renderJobDetail(job);
    showPage('job-detail');
  } catch (e) {
    showToast('โหลดรายละเอียดไม่ได้', 'error');
  } finally {
    hideLoading();
  }
}

function renderJobDetail(job) {
  if (job.error) { showToast('ไม่พบงาน', 'error'); return; }

  // Image
  const imgSection = document.getElementById('detail-before-img');
  imgSection.innerHTML = job.before_url
    ? `<img src="${job.before_url}" alt="รูปก่อนซ่อม">`
    : `<div class="detail-image-placeholder">🔧</div>`;

  // Info
  document.getElementById('detail-location').textContent = job.location || '-';
  document.getElementById('detail-detail').textContent = job.detail || '-';
  document.getElementById('detail-dept').textContent = job.department || '-';
  document.getElementById('detail-reporter').textContent = job.reporter || '-';
  document.getElementById('detail-date').textContent = job.date || '-';
  document.getElementById('detail-type').textContent = job.type || '-';
  document.getElementById('detail-progress').textContent = job.progress || 'ว่างเปล่า';

  // Show/hide complete form
  const isCompleted = job.progress?.includes('ดำเนินการเรียบร้อย') || job.progress === 'ยกเลิกการซ่อม';
  document.getElementById('update-section').style.display = isCompleted ? 'none' : 'block';

  // Pre-fill main tech
  document.getElementById('main-tech-input').value = state.currentUser?.name || '';

  // Reset state
  selectedStatus = '';
  jobImages = [];
  document.querySelectorAll('.status-option').forEach(el => el.classList.remove('selected'));
  document.getElementById('complete-fields').classList.add('hidden');
  renderJobImagePreview();
}

let selectedStatus = '';
function selectStatus(status) {
  selectedStatus = status;
  document.querySelectorAll('.status-option').forEach(el => {
    el.classList.toggle('selected', el.dataset.status === status);
  });
  // Show complete fields only when "ดำเนินการเรียบร้อย"
  document.getElementById('complete-fields').classList.toggle('hidden', status !== 'ดำเนินการเรียบร้อย');
}

const jobImages = [];
function handleJobImage(input) {
  const files = Array.from(input.files);
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = e => {
      jobImages.push({ dataUrl: e.target.result, file: f });
      renderJobImagePreview();
    };
    reader.readAsDataURL(f);
  });
}

function renderJobImagePreview() {
  const preview = document.getElementById('job-image-preview');
  if (!preview) return;
  preview.innerHTML = jobImages.map((img, i) => `
    <div class="upload-preview-item">
      <img src="${img.dataUrl}">
      <button class="remove-preview" onclick="removeJobImage(${i})">✕</button>
    </div>
  `).join('');
}

function removeJobImage(i) {
  jobImages.splice(i, 1);
  renderJobImagePreview();
}

async function submitJobUpdate() {
  if (!selectedStatus) { showToast('กรุณาเลือกสถานะ', 'error'); return; }
  if (!state.currentJob) return;

  showLoading('กำลังบันทึก...');
  let afterImageUrl = '';

  // Upload image if completing
  if (selectedStatus === 'ดำเนินการเรียบร้อย' && jobImages.length > 0) {
    try {
      const img = jobImages[0];
      const base64 = img.dataUrl.split(',')[1];
      const r = await api.post({
        action: 'uploadImage',
        base64data: base64,
        filename: img.file.name,
        mime_type: img.file.type,
      });
      if (r.success) afterImageUrl = r.url;
    } catch (e) {}
  }

  try {
    const result = await api.post({
      action: 'updateRepairStatus',
      row_index: state.currentJob.row_index,
      status: selectedStatus,
      main_tech: document.getElementById('main-tech-input')?.value || '',
      assistant1: document.getElementById('asst1-input')?.value || '',
      assistant2: document.getElementById('asst2-input')?.value || '',
      after_image_url: afterImageUrl,
    });

    if (result.success) {
      showToast('อัพเดทสถานะสำเร็จ! ✅', 'success');
      setTimeout(() => {
        showPage('main');
        setNavPage('repair');
        loadRepairJobs(currentFilter);
      }, 1000);
    } else {
      showToast(result.error || 'บันทึกไม่สำเร็จ', 'error');
    }
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  } finally {
    hideLoading();
  }
}

// ===== LOGOUT =====
function logout() {
  if (!confirm('ออกจากระบบหรือไม่?')) return;
  state.currentUser = null;
  state.currentShift = null;
  state.repairJobs = [];
  state.routineStatus = {};
  showPage('login');
  initLogin();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  showPage('login');
  initLogin();
});
