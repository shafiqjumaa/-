/* ==========================================================
   ملف مفتوح — منطق اللعبة الرئيسي
   ========================================================== */

const SAVE_KEY = "malaf_maftuh_save_v1";

let state = null;
let currentTab = "hub";
let currentSuspectId = null;
let currentDialogueMode = "questions"; // questions | confront
let currentLocation = "loc-scene";
let boardLinking = null; // evidence id currently being linked from
let audioCtx = null;

/* ---------------- الحالة الافتراضية ---------------- */
function freshState() {
  const trust = {};
  SUSPECTS.forEach((s) => (trust[s.id] = s.trustStart));
  return {
    discovered: [],
    interrogated: [],
    asked: {}, // suspectId -> [qIndex]
    confronted: {}, // suspectId -> [evId]
    trust,
    connections: [], // [ [evA, evB], ... ]
    positions: {}, // evId -> {x,y} on board (percent)
    hints: 0,
    mistakes: 0,
    startTime: Date.now(),
    accusationDone: false,
    lastSuspect: null,
    lastEvidenceSet: [],
    aiMessages: [],
    ended: false,
  };
}

/* ---------------- الحفظ ---------------- */
function saveState() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("تعذر الحفظ", e);
  }
}
function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function clearState() {
  localStorage.removeItem(SAVE_KEY);
}

/* ---------------- صوت (Web Audio API) ---------------- */
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
    }
  }
}
function playSound(type) {
  ensureAudio();
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g);
  g.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  let freq = 440,
    dur = 0.1,
    wave = "sine";
  if (type === "click") { freq = 520; dur = 0.05; }
  if (type === "discover") { freq = 660; dur = 0.22; wave = "triangle"; }
  if (type === "open") { freq = 380; dur = 0.12; }
  if (type === "connect") { freq = 800; dur = 0.15; wave = "square"; }
  if (type === "contradiction") { freq = 200; dur = 0.3; wave = "sawtooth"; }
  if (type === "success") { freq = 700; dur = 0.4; wave = "triangle"; }
  if (type === "fail") { freq = 160; dur = 0.5; wave = "sawtooth"; }
  o.type = wave;
  o.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.start(now);
  o.stop(now + dur + 0.05);
  if (type === "success") {
    setTimeout(() => playSound2(880, 0.3), 180);
  }
}
function playSound2(freq, dur) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  o.type = "triangle";
  o.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.start(now); o.stop(now + dur + 0.05);
}

/* ---------------- أدوات مساعدة ---------------- */
function getEvidence(id) { return EVIDENCE.find((e) => e.id === id); }
function getSuspect(id) { return SUSPECTS.find((s) => s.id === id); }
function isDiscovered(id) { return state.discovered.includes(id); }
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("show"), 2600);
}
function showModal(html) {
  document.getElementById("modal-box").innerHTML = html;
  document.getElementById("modal-overlay").classList.add("active");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("active");
}
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});

/* ---------------- التنقل بين الشاشات ---------------- */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

/* ==========================================================
   شاشة البداية
   ========================================================== */
function initStartScreen() {
  const saved = loadState();
  const continueBtn = document.getElementById("btn-continue");
  const hint = document.getElementById("save-hint");
  if (saved) {
    continueBtn.disabled = false;
    const pct = Math.round((saved.discovered.length / EVIDENCE.length) * 100);
    hint.textContent = `يوجد تحقيق محفوظ — نسبة الاكتمال ${pct}%`;
  } else {
    continueBtn.disabled = true;
    hint.textContent = "لا يوجد تحقيق محفوظ حالياً";
  }

  continueBtn.onclick = () => {
    playSound("click");
    state = loadState() || freshState();
    enterGame();
  };
  document.getElementById("btn-newgame").onclick = () => {
    playSound("click");
    if (loadState() && !confirm("لديك تحقيق محفوظ، هل تريد بدء قضية جديدة والكتابة فوقه؟")) return;
    state = freshState();
    saveState();
    showScreen("screen-caseintro");
    renderCaseIntro();
  };
  document.getElementById("btn-reset").onclick = () => {
    playSound("click");
    if (confirm("سيتم مسح كل تقدّم اللعبة المحفوظ. متابعة؟")) {
      clearState();
      toast("تم مسح التقدّم");
      initStartScreen();
    }
  };
}

function renderCaseIntro() {
  document.getElementById("intro-title").textContent = `${CASE.title} — ${CASE.city}`;
  document.getElementById("intro-body").textContent = CASE.intro;
  document.getElementById("intro-victim").innerHTML = `
    <b>الضحية:</b> ${VICTIM.name} (${VICTIM.age} عاماً) — ${VICTIM.job}<br>
    <b>الحالة:</b> ${VICTIM.status}<br><br>${VICTIM.details}`;
  document.getElementById("btn-start-investigation").onclick = () => {
    playSound("open");
    enterGame();
  };
}

function enterGame() {
  showScreen("screen-game");
  switchTab("hub");
}

/* ==========================================================
   الشريط العلوي والتبويبات
   ========================================================== */
function renderTopbarStats() {
  const pct = Math.round((state.discovered.length / EVIDENCE.length) * 100);
  const elapsedMin = Math.max(1, Math.round((Date.now() - state.startTime) / 60000));
  document.getElementById("topbar-stats").innerHTML = `
    <span>الأدلة: <b>${state.discovered.length}/${EVIDENCE.length}</b></span>
    <span>الاكتمال: <b>${pct}%</b></span>
    <span>التلميحات: <b>${state.hints}</b></span>
    <span>الأخطاء: <b>${state.mistakes}</b></span>
    <span>الوقت: <b>${elapsedMin} د</b></span>
  `;
}

document.getElementById("tabbar").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  playSound("click");
  switchTab(btn.dataset.tab);
});

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderTopbarStats();
  const map = {
    hub: renderHub,
    scene: renderSceneTab,
    locations: renderLocationsTab,
    board: renderBoard,
    suspects: renderSuspects,
    timeline: renderTimeline,
    ai: renderAI,
    accuse: renderAccuse,
  };
  (map[tab] || renderHub)();
  saveState();
}

/* ==========================================================
   المكتب (Hub)
   ========================================================== */
function renderHub() {
  const c = document.getElementById("tab-content");
  const pct = Math.round((state.discovered.length / EVIDENCE.length) * 100);
  c.innerHTML = `
    <div class="victim-card">
      <div class="victim-avatar">🕯️</div>
      <div>
        <h4>${VICTIM.name} — ${VICTIM.age} عاماً</h4>
        <p>${VICTIM.job}</p>
        <p>${VICTIM.status}</p>
      </div>
    </div>
    <div class="section-title">مرحباً أيها المحقق</div>
    <div class="section-sub">اختر من أين تريد متابعة التحقيق. نسبة اكتمال الملف: ${pct}%</div>
    <div class="hub-grid">
      <div class="hub-card" data-tab="scene">
        <span class="hub-badge">${state.discovered.filter(id=>getEvidence(id).location==='loc-scene').length}/${EVIDENCE.filter(e=>e.location==='loc-scene').length}</span>
        <span class="hc-icon">🏠</span><h4>مسرح الجريمة</h4><p>افحص شقة الضحية بحثاً عن أدلة مادية.</p>
      </div>
      <div class="hub-card" data-tab="locations">
        <span class="hc-icon">📍</span><h4>مواقع أخرى</h4><p>مكتب الشركة، مدخل البناء، والمختبر الجنائي.</p>
      </div>
      <div class="hub-card" data-tab="suspects">
        <span class="hub-badge">${state.interrogated.length}/${SUSPECTS.length}</span>
        <span class="hc-icon">🕵️</span><h4>المشتبه بهم</h4><p>استجوب الأشخاص المرتبطين بالضحية.</p>
      </div>
      <div class="hub-card" data-tab="board">
        <span class="hc-icon">📌</span><h4>لوحة الأدلة</h4><p>اربط الأدلة ببعضها لكشف الصورة الكاملة.</p>
      </div>
      <div class="hub-card" data-tab="timeline">
        <span class="hc-icon">⏱️</span><h4>الخط الزمني</h4><p>رتّب أحداث ليلة الجريمة بالتسلسل الصحيح.</p>
      </div>
      <div class="hub-card" data-tab="ai">
        <span class="hc-icon">🤖</span><h4>مساعد التحقيق</h4><p>استشر المساعد الذكي في تحليل القضية.</p>
      </div>
    </div>
  `;
  c.querySelectorAll(".hub-card").forEach((el) => {
    el.onclick = () => {
      playSound("click");
      switchTab(el.dataset.tab);
    };
  });
}

/* ==========================================================
   مسرح الجريمة الرئيسي + المواقع الأخرى (نفس المحرك)
   ========================================================== */
function renderSceneTab() {
  currentLocation = "loc-scene";
  renderLocationStage(document.getElementById("tab-content"), true);
}

function renderLocationsTab() {
  const ids = Object.keys(LOCATIONS).filter((id) => id !== "loc-scene");
  if (!ids.includes(currentLocation)) currentLocation = ids[0];
  const c = document.getElementById("tab-content");
  c.innerHTML = `<div class="scene-picker" id="loc-picker"></div><div id="loc-stage-wrap"></div>`;
  const picker = document.getElementById("loc-picker");
  ids.forEach((id) => {
    const btn = document.createElement("button");
    btn.textContent = LOCATIONS[id].name;
    btn.className = currentLocation === id ? "active" : "";
    btn.onclick = () => {
      playSound("click");
      currentLocation = id;
      renderLocationsTab();
    };
    picker.appendChild(btn);
  });
  renderLocationStage(document.getElementById("loc-stage-wrap"), false);
}

function renderLocationStage(container, isSceneTab) {
  const loc = LOCATIONS[currentLocation];
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="section-title">${loc.name}</div>
    <div class="section-sub">${loc.desc}</div>
    <div class="scene-stage" id="scene-stage"></div>
  `;
  if (isSceneTab) container.innerHTML = "";
  container.appendChild(wrap);
  const stage = wrap.querySelector("#scene-stage");
  loc.hotspots.forEach((h) => {
    const el = document.createElement("div");
    const found = isDiscovered(h.evidence);
    el.className = "hotspot" + (found ? " found" : "");
    el.style.left = h.x + "%";
    el.style.top = h.y + "%";
    el.innerHTML = `${h.icon}<span class="hotspot-label">${h.label}</span>`;
    el.onclick = () => handleHotspotClick(h.evidence);
    stage.appendChild(el);
  });
}

function handleHotspotClick(evId) {
  const ev = getEvidence(evId);
  if (isDiscovered(evId)) {
    playSound("open");
    openEvidenceModal(evId);
    return;
  }
  // بوابة الأدلة المشروطة (تحتاج تحليل مخبري لاحق)
  if (ev.hiddenUntil && !ev.hiddenUntil.every((req) => isDiscovered(req))) {
    playSound("click");
    toast("لا يوجد ما يستدعي التحليل حالياً — اجمع أدلة أخرى أولاً.");
    return;
  }
  playSound("discover");
  state.discovered.push(evId);
  saveState();
  toast(`دليل جديد: ${ev.name}`);
  showModal(`
    <h3>${ev.icon} ${ev.name}</h3>
    <p>${ev.desc}</p>
    <p style="margin-top:10px; color:var(--brass-bright); font-size:13px;">تمت إضافته إلى لوحة الأدلة.</p>
    <div class="modal-close-row"><button class="btn btn-primary btn-sm" onclick="closeModal(); refreshCurrentTab();">حسناً</button></div>
  `);
  if (currentTab === "scene") renderSceneTab();
  else if (currentTab === "locations") renderLocationsTab();
}

function refreshCurrentTab() {
  switchTab(currentTab);
}

function openEvidenceModal(evId) {
  const ev = getEvidence(evId);
  const relatedNames = (ev.related || []).filter(isDiscovered).map((id) => getEvidence(id).name);
  showModal(`
    <h3>${ev.icon} ${ev.name}</h3>
    <p>${ev.desc}</p>
    <p style="margin-top:10px;"><b style="color:var(--brass-bright)">تحليل تفصيلي:</b><br>${ev.detail}</p>
    ${relatedNames.length ? `<p style="margin-top:10px; font-size:12px; color:var(--text-2)">مرتبط بـ: ${relatedNames.join("، ")}</p>` : ""}
    <div class="modal-close-row"><button class="btn btn-ghost btn-sm" onclick="closeModal()">إغلاق</button></div>
  `);
}

/* ==========================================================
   لوحة الأدلة (Evidence Board)
   ========================================================== */
function ensurePositions() {
  const cols = 5;
  state.discovered.forEach((id, i) => {
    if (!state.positions[id]) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      state.positions[id] = { x: 8 + col * 18, y: 10 + row * 24 };
    }
  });
}

function renderBoard() {
  ensurePositions();
  const c = document.getElementById("tab-content");
  c.innerHTML = `
    <div class="section-title">لوحة الأدلة</div>
    <div class="section-sub">اسحب الأدلة لترتيبها، واضغط «ربط» على بطاقتين متتاليتين لتوصيلهما بخيط استنتاج.</div>
    <div class="board-toolbar">
      <button class="btn btn-ghost btn-sm" id="board-clear-links">مسح كل الروابط</button>
      <span style="font-size:12px; color:var(--text-2); font-family:var(--font-mono)">الروابط: ${state.connections.length}</span>
    </div>
    <div class="board-stage" id="board-stage">
      <svg class="board-svg" id="board-svg"></svg>
    </div>
  `;
  const stage = document.getElementById("board-stage");
  if (state.discovered.length === 0) {
    stage.innerHTML += `<p style="padding:40px; color:var(--text-2); text-align:center;">لم تُجمع أي أدلة بعد. توجّه إلى مسرح الجريمة أو المواقع الأخرى.</p>`;
    return;
  }
  state.discovered.forEach((id) => {
    const ev = getEvidence(id);
    const pos = state.positions[id];
    const card = document.createElement("div");
    card.className = "evidence-card";
    card.style.left = pos.x + "%";
    card.style.top = pos.y + "%";
    card.dataset.id = id;
    card.innerHTML = `
      <div class="ec-pin"></div>
      <div class="ec-icon">${ev.icon}</div>
      <div class="ec-name">${ev.name}</div>
      <div class="ec-imp">${"★".repeat(ev.importance)}</div>
      <button class="link-btn" data-link="${id}">🔗 ربط</button>
    `;
    stage.appendChild(card);
    makeDraggable(card, id);
  });
  document.getElementById("board-clear-links").onclick = () => {
    state.connections = [];
    saveState();
    renderBoard();
  };
  stage.querySelectorAll("[data-link]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      handleLinkClick(btn.dataset.link);
    };
  });
  drawConnections();
}

function makeDraggable(card, id) {
  let dragging = false, offX = 0, offY = 0;
  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".link-btn")) return;
    dragging = true;
    card.setPointerCapture(e.pointerId);
    const rect = card.parentElement.getBoundingClientRect();
    offX = e.clientX - (rect.left + (state.positions[id].x / 100) * rect.width);
    offY = e.clientY - (rect.top + (state.positions[id].y / 100) * rect.height);
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = card.parentElement.getBoundingClientRect();
    let x = ((e.clientX - offX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - offY - rect.top) / rect.height) * 100;
    x = Math.max(0, Math.min(85, x));
    y = Math.max(0, Math.min(85, y));
    state.positions[id] = { x, y };
    card.style.left = x + "%";
    card.style.top = y + "%";
    drawConnections();
  });
  card.addEventListener("pointerup", () => { dragging = false; saveState(); });
  card.addEventListener("pointercancel", () => { dragging = false; });
}

function handleLinkClick(evId) {
  playSound("click");
  if (!boardLinking) {
    boardLinking = evId;
    document.querySelector(`.evidence-card[data-id="${evId}"]`).classList.add("linking");
    toast("اختر دليلاً آخر لربطه بهذا الدليل");
    return;
  }
  if (boardLinking === evId) {
    document.querySelector(`.evidence-card[data-id="${evId}"]`).classList.remove("linking");
    boardLinking = null;
    return;
  }
  const a = boardLinking, b = evId;
  boardLinking = null;
  document.querySelectorAll(".evidence-card.linking").forEach((el) => el.classList.remove("linking"));
  const exists = state.connections.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (exists) { toast("هذا الرابط موجود بالفعل"); return; }
  state.connections.push([a, b]);
  saveState();
  const evA = getEvidence(a), evB = getEvidence(b);
  const correct = (evA.related || []).includes(b) || (evB.related || []).includes(a);
  if (correct) {
    playSound("connect");
    toast("✅ ربط منطقي! هذا يقوّي الصورة العامة للقضية.");
  } else {
    playSound("contradiction");
    state.mistakes++;
    toast("⚠️ لا يبدو أن هذين الدليلين مرتبطان مباشرة، لكن لا بأس بالاستكشاف.");
  }
  saveState();
  drawConnections();
}

function drawConnections() {
  const svg = document.getElementById("board-svg");
  if (!svg) return;
  svg.innerHTML = "";
  state.connections.forEach(([a, b]) => {
    const pa = state.positions[a], pb = state.positions[b];
    if (!pa || !pb) return;
    const evA = getEvidence(a), evB = getEvidence(b);
    const correct = (evA.related || []).includes(b) || (evB.related || []).includes(a);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", pa.x + 8 + "%");
    line.setAttribute("y1", pa.y + 6 + "%");
    line.setAttribute("x2", pb.x + 8 + "%");
    line.setAttribute("y2", pb.y + 6 + "%");
    line.setAttribute("stroke", correct ? "#c9a15a" : "#b4483c");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", correct ? "0" : "4,4");
    svg.appendChild(line);
  });
}

/* ==========================================================
   المشتبه بهم + الاستجواب
   ========================================================== */
function renderSuspects() {
  const c = document.getElementById("tab-content");
  c.innerHTML = `
    <div class="section-title">المشتبه بهم</div>
    <div class="section-sub">اضغط على أي شخص لبدء أو متابعة استجوابه.</div>
    <div class="suspects-grid" id="suspects-grid"></div>
  `;
  const grid = document.getElementById("suspects-grid");
  SUSPECTS.forEach((s) => {
    const trust = state.trust[s.id];
    const el = document.createElement("div");
    el.className = "suspect-card";
    el.innerHTML = `
      <div class="suspect-avatar">${s.avatar}</div>
      <h4>${s.name}</h4>
      <div class="s-job">${s.job}</div>
      <div class="trust-bar"><div class="trust-bar-fill" style="width:${trust}%"></div></div>
      <div class="s-status">${state.interrogated.includes(s.id) ? "تم استجوابه" : "لم يُستجوَب بعد"}</div>
    `;
    el.onclick = () => { playSound("click"); openInterrogation(s.id); };
    grid.appendChild(el);
  });
}

function openInterrogation(suspectId) {
  currentSuspectId = suspectId;
  currentDialogueMode = "questions";
  if (!state.interrogated.includes(suspectId)) state.interrogated.push(suspectId);
  if (!state.asked[suspectId]) state.asked[suspectId] = [];
  if (!state.confronted[suspectId]) state.confronted[suspectId] = [];
  saveState();
  renderInterrogation();
}

function renderInterrogation() {
  const s = getSuspect(currentSuspectId);
  const c = document.getElementById("tab-content");
  c.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="back-to-suspects">→ العودة لقائمة المشتبه بهم</button>
    <div class="interrogation-wrap" style="margin-top:14px;">
      <div class="suspect-profile">
        <div class="suspect-avatar">${s.avatar}</div>
        <h4 style="margin-top:10px;">${s.name}</h4>
        <div class="profile-row"><span>العمر</span><b>${s.age}</b></div>
        <div class="profile-row"><span>المهنة</span><b>${s.job}</b></div>
        <div class="profile-row"><span>العلاقة</span><b>${s.relation}</b></div>
        <div class="profile-row"><span>الحالة النفسية</span><b>${s.psych}</b></div>
        <div class="profile-row"><span>مستوى الثقة</span><b>${state.trust[s.id]}%</b></div>
      </div>
      <div class="dialogue-box">
        <div class="dialogue-tabs">
          <button data-mode="questions" class="${currentDialogueMode === "questions" ? "active" : ""}">أسئلة عامة</button>
          <button data-mode="confront" class="${currentDialogueMode === "confront" ? "active" : ""}">مواجهة بدليل</button>
        </div>
        <div class="dialogue-log" id="dialogue-log"></div>
        <div id="dialogue-controls"></div>
      </div>
    </div>
  `;
  document.getElementById("back-to-suspects").onclick = () => { playSound("click"); switchTab("suspects"); };
  c.querySelectorAll(".dialogue-tabs button").forEach((b) => {
    b.onclick = () => { playSound("click"); currentDialogueMode = b.dataset.mode; renderInterrogation(); };
  });
  renderDialogueLog();
  if (currentDialogueMode === "questions") renderQuestionOptions();
  else renderConfrontOptions();
}

function renderDialogueLog() {
  const log = document.getElementById("dialogue-log");
  const s = getSuspect(currentSuspectId);
  let html = "";
  (state.asked[s.id] || []).forEach((qi) => {
    const q = s.questions[qi];
    html += `<div class="msg msg-detective">${q.q}</div>`;
    html += `<div class="msg msg-suspect">${q.a}</div>`;
  });
  (state.confronted[s.id] || []).forEach((evId) => {
    const ev = getEvidence(evId);
    const reaction = s.confront[evId] || s.confront.default;
    html += `<div class="msg msg-system">— عرضت دليل: ${ev.name} —</div>`;
    html += `<div class="msg msg-suspect">${reaction.text}</div>`;
  });
  if (!html) html = `<div class="msg msg-system">ابدأ الاستجواب باختيار سؤال أو تقديم دليل.</div>`;
  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
}

function renderQuestionOptions() {
  const s = getSuspect(currentSuspectId);
  const wrap = document.getElementById("dialogue-controls");
  wrap.innerHTML = `<div class="q-options" id="q-options"></div>`;
  const opts = document.getElementById("q-options");
  s.questions.forEach((q, i) => {
    const asked = (state.asked[s.id] || []).includes(i);
    const btn = document.createElement("button");
    btn.className = "q-btn";
    btn.textContent = q.q;
    if (asked) btn.disabled = true;
    btn.onclick = () => {
      playSound("click");
      state.asked[s.id].push(i);
      state.trust[s.id] = Math.max(0, Math.min(100, state.trust[s.id] + q.trust));
      if (q.unlock && !isDiscovered(q.unlock)) {
        state.discovered.push(q.unlock);
        toast(`دليل جديد من الاستجواب: ${getEvidence(q.unlock).name}`);
        playSound("discover");
      }
      saveState();
      renderInterrogation();
    };
    opts.appendChild(btn);
  });
}

function renderConfrontOptions() {
  const wrap = document.getElementById("dialogue-controls");
  if (state.discovered.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-2); font-size:13px;">لا تملك أي أدلة بعد لمواجهته بها.</p>`;
    return;
  }
  wrap.innerHTML = `<div class="evidence-picker" id="ev-picker"></div>`;
  const picker = document.getElementById("ev-picker");
  const s = getSuspect(currentSuspectId);
  state.discovered.forEach((id) => {
    const ev = getEvidence(id);
    const used = (state.confronted[s.id] || []).includes(id);
    const btn = document.createElement("button");
    btn.className = "ev-pick-btn";
    btn.innerHTML = `${ev.icon}<br>${ev.name}`;
    if (used) btn.disabled = true;
    btn.onclick = () => {
      playSound("open");
      state.confronted[s.id].push(id);
      const reaction = s.confront[id] || s.confront.default;
      state.trust[s.id] = Math.max(0, Math.min(100, state.trust[s.id] + reaction.trust));
      if (reaction.trust < 0) state.mistakes++;
      saveState();
      renderInterrogation();
    };
    picker.appendChild(btn);
  });
}

/* ==========================================================
   الخط الزمني
   ========================================================== */
const TIMELINE_EVENTS = [
  { req: "ev06", time: "~23:00", text: "الجار سامر يسمع صوت جدال خافت في شقة الضحية." },
  { req: "ev05", time: "23:05", text: "شخص يرتدي سترة داكنة يدخل مبنى الضحية (سجل الكاميرا)." },
  { req: "ev09", time: "23:00–23:30", text: "سيارة داكنة اللون متوقفة قرب مدخل البناء." },
  { req: "ev01", time: "~23:15", text: "إعداد فنجان قهوة يحتوي على جرعة زائدة من دواء قلبي." },
  { req: "ev11", time: "23:47", text: "توقف ساعة يد الضحية — اللحظة التقديرية للوفاة." },
  { req: "ev05", time: "23:40", text: "الشخص نفسه يغادر المبنى (سجل الكاميرا)." },
];

function renderTimeline() {
  const c = document.getElementById("tab-content");
  const available = TIMELINE_EVENTS.filter((t) => isDiscovered(t.req));
  c.innerHTML = `
    <div class="section-title">الخط الزمني لليلة الحادثة</div>
    <div class="section-sub">يتكوّن الخط الزمني تلقائياً كلما جمعت أدلة جديدة ترتبط بتوقيت محدد.</div>
    <div class="timeline-track" id="timeline-track"></div>
  `;
  const track = document.getElementById("timeline-track");
  if (available.length === 0) {
    track.innerHTML = `<p style="color:var(--text-2)">لا توجد أحداث زمنية موثّقة بعد. اجمع المزيد من الأدلة.</p>`;
    return;
  }
  const sorted = [...available].sort((a, b) => (a.time > b.time ? 1 : -1));
  sorted.forEach((t) => {
    const item = document.createElement("div");
    item.className = "timeline-item";
    item.innerHTML = `<div class="ti-time">${t.time}</div><div class="ti-text">${t.text}</div>`;
    track.appendChild(item);
  });
}

/* ==========================================================
   مساعد التحقيق (AI محلي قائم على القواعد)
   ========================================================== */
function renderAI() {
  const c = document.getElementById("tab-content");
  c.innerHTML = `
    <div class="ai-wrap">
      <div class="ai-header">
        <div class="ai-avatar">🤖</div>
        <div>
          <h4 style="margin-bottom:2px;">مساعد التحقيق</h4>
          <p style="font-size:12px; color:var(--text-2); margin:0;">تحليل محلي مبني على الأدلة المكتشفة حتى الآن</p>
        </div>
      </div>
      <div class="ai-log" id="ai-log"></div>
      <div class="ai-suggestions" id="ai-suggestions"></div>
      <div class="ai-input-row">
        <input type="text" id="ai-input" placeholder="اسأل عن دليل، شخصية، أو اطلب تلميحاً...">
        <button class="btn btn-primary btn-sm" id="ai-send">إرسال</button>
      </div>
    </div>
  `;
  if (state.aiMessages.length === 0) {
    pushAI("assistant", "مرحباً أيها المحقق. أنا هنا لمساعدتك على تحليل القضية. اسألني عن ملخص الأدلة، التناقضات، أو من يستحق الاستجواب.");
  }
  renderAILog();
  const chips = [
    ["لخّص الأدلة المكتشفة", "summary"],
    ["ما هي التناقضات؟", "contradictions"],
    ["من يستحق الاستجواب؟", "suggest"],
    ["حلّل الخط الزمني", "timeline"],
    ["أعطني تلميحاً", "hint"],
  ];
  const chipWrap = document.getElementById("ai-suggestions");
  chips.forEach(([label, key]) => {
    const b = document.createElement("button");
    b.className = "ai-chip";
    b.textContent = label;
    b.onclick = () => { playSound("click"); handleAIQuery(key); };
    chipWrap.appendChild(b);
  });
  document.getElementById("ai-send").onclick = sendAIFreeText;
  document.getElementById("ai-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendAIFreeText();
  });
}

function sendAIFreeText() {
  const input = document.getElementById("ai-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  pushAI("user", text);
  handleAIQuery("freeform", text);
}

function pushAI(role, text) {
  state.aiMessages.push({ role, text });
  saveState();
}

function renderAILog() {
  const log = document.getElementById("ai-log");
  log.innerHTML = state.aiMessages
    .map((m) => `<div class="msg ${m.role === "user" ? "msg-detective" : "msg-suspect"}">${m.text}</div>`)
    .join("");
  log.scrollTop = log.scrollHeight;
}

function handleAIQuery(key, freeText) {
  let reply = "";
  if (key === "summary") {
    if (state.discovered.length === 0) {
      reply = "لم تُكتشف أي أدلة بعد. توجّه إلى مسرح الجريمة للبدء.";
    } else {
      const items = state.discovered.map((id) => `• ${getEvidence(id).name}`).join("<br>");
      reply = `لديك حتى الآن ${state.discovered.length} دليلاً من أصل ${EVIDENCE.length}:<br>${items}`;
    }
  } else if (key === "contradictions") {
    const found = [];
    SUSPECTS.forEach((s) => {
      if (!state.interrogated.includes(s.id)) return;
      (s.statements || []).forEach((st) => {
        if (isDiscovered(st.contradictsWith)) {
          found.push(`تصريح ${s.name}: "${st.text}" يتعارض مع دليل «${getEvidence(st.contradictsWith).name}».`);
        }
      });
    });
    reply = found.length
      ? "رصدتُ التناقضات التالية:<br>" + found.map((f) => "⚠️ " + f).join("<br>")
      : "لم أرصد تناقضات واضحة بعد. استجوب المزيد من المشتبه بهم واجمع أدلة إضافية.";
  } else if (key === "suggest") {
    const notYet = SUSPECTS.filter((s) => !state.interrogated.includes(s.id));
    const lowTrust = SUSPECTS.filter((s) => state.interrogated.includes(s.id) && state.trust[s.id] >= 65)
      .sort((a, b) => b.trust - a.trust);
    if (notYet.length) {
      reply = `لم تستجوب بعد: ${notYet.map((s) => s.name).join("، ")}. أنصحك بالبدء بهم.`;
    } else if (lowTrust.length) {
      reply = `من واجهته بأدلة قوية وارتفع توتره أكثر من غيره: ${lowTrust.slice(0,2).map((s) => s.name).join("، ")}. قد يستحق مزيداً من المواجهة.`;
    } else {
      reply = "لقد استجوبت جميع المشتبه بهم. راجع لوحة الأدلة لتحديد من يملك أقوى دافع ومكان تواجد غير مؤكد.";
    }
  } else if (key === "timeline") {
    const avail = TIMELINE_EVENTS.filter((t) => isDiscovered(t.req));
    reply = avail.length
      ? `الخط الزمني الحالي يضم ${avail.length} أحداث موثّقة، وتشير جميعها إلى نافذة زمنية بين الساعة 23:00 و23:47 تقريباً — وهي اللحظة الأهم في القضية.`
      : "لا تتوفر أحداث زمنية كافية بعد. اجمع أدلة من مسرح الجريمة ومدخل البناء.";
  } else if (key === "hint") {
    reply = getNextHint();
  } else if (key === "freeform") {
    reply = analyzeFreeText(freeText);
  }
  pushAI("assistant", reply);
  renderAILog();
  saveState();
}

function getNextHint() {
  const tier = Math.min(state.hints, AI_HINTS.length - 1);
  state.hints++;
  saveState();
  renderTopbarStats();
  const strongHint = state.hints >= AI_HINTS.length;
  if (strongHint && state.discovered.length >= 6) {
    return "بناءً على كل ما جمعته: الدافع المالي، البصمات، وسجل الكاميرا تشير جميعها إلى نفس الاتجاه. من في القضية يجمع بين مشكلة مالية موثّقة، ووجود مادي مؤكد في مسرح الجريمة؟";
  }
  return "💡 " + AI_HINTS[tier];
}

function analyzeFreeText(text) {
  const t = text.toLowerCase();
  // البحث عن أدلة مطابقة بالاسم
  for (const ev of EVIDENCE) {
    if (t.includes(ev.name.split(" ")[0]) && isDiscovered(ev.id)) {
      return `بخصوص «${ev.name}»: ${ev.detail}`;
    }
  }
  // البحث عن أسماء مشتبه بهم
  for (const s of SUSPECTS) {
    if (t.includes(s.name.split(" ")[0])) {
      if (!state.interrogated.includes(s.id)) {
        return `لم تستجوب ${s.name} بعد. يُفضّل زيارته في قسم «المشتبه بهم».`;
      }
      return `${s.name}: مستوى الثقة الحالي معه ${state.trust[s.id]}%. ${s.motive}`;
    }
  }
  if (t.includes("قاتل") || t.includes("من هو") || t.includes("الحل")) {
    return "لا يمكنني الكشف عن الحل مباشرة، لكن يمكنني مساعدتك بتلميحات تدريجية إن احتجت ذلك.";
  }
  return "لم أفهم سؤالك بدقة. جرّب اختيار أحد الاقتراحات أعلاه، أو اسأل عن اسم دليل أو شخصية محددة.";
}

/* ==========================================================
   شاشة الاتهام النهائي
   ========================================================== */
let accuseSelectedSuspect = null;
let accuseSelectedEvidence = [];

function renderAccuse() {
  accuseSelectedSuspect = null;
  accuseSelectedEvidence = [];
  const c = document.getElementById("tab-content");
  c.innerHTML = `
    <div class="accuse-wrap">
      <div class="section-title">⚖️ إغلاق القضية</div>
      <div class="section-sub">اختر الشخص الذي تعتقد أنه القاتل، ثم حدّد الأدلة الداعمة لاتهامك. هذا القرار نهائي.</div>
      <h4 style="margin:18px 0 10px;">1. اختر المتهم</h4>
      <div class="accuse-suspect-list" id="accuse-suspects"></div>
      <h4 style="margin:18px 0 10px;">2. اختر الأدلة الداعمة (3 على الأقل)</h4>
      <div class="accuse-evidence-list" id="accuse-evidence"></div>
      <button class="btn btn-danger" id="accuse-submit">تقديم الاتهام وإغلاق القضية</button>
    </div>
  `;
  const sList = document.getElementById("accuse-suspects");
  SUSPECTS.forEach((s) => {
    const el = document.createElement("div");
    el.className = "accuse-radio";
    el.innerHTML = `<span>${s.avatar}</span><span>${s.name} — ${s.job}</span>`;
    el.onclick = () => {
      playSound("click");
      accuseSelectedSuspect = s.id;
      document.querySelectorAll(".accuse-radio").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
    };
    sList.appendChild(el);
  });
  const eList = document.getElementById("accuse-evidence");
  if (state.discovered.length === 0) {
    eList.innerHTML = `<p style="color:var(--text-2); font-size:13px;">لم تجمع أي أدلة بعد.</p>`;
  }
  state.discovered.forEach((id) => {
    const ev = getEvidence(id);
    const el = document.createElement("div");
    el.className = "accuse-ev-item";
    el.innerHTML = `${ev.icon}<br>${ev.name}`;
    el.onclick = () => {
      playSound("click");
      if (accuseSelectedEvidence.includes(id)) {
        accuseSelectedEvidence = accuseSelectedEvidence.filter((x) => x !== id);
        el.classList.remove("selected");
      } else {
        accuseSelectedEvidence.push(id);
        el.classList.add("selected");
      }
    };
    eList.appendChild(el);
  });
  document.getElementById("accuse-submit").onclick = submitAccusation;
}

function submitAccusation() {
  if (!accuseSelectedSuspect) { toast("اختر متهماً أولاً"); return; }
  if (accuseSelectedEvidence.length < CASE.minEvidenceToAccuse) {
    toast(`اختر ${CASE.minEvidenceToAccuse} أدلة على الأقل لدعم الاتهام`);
    return;
  }
  if (!confirm("هذا القرار نهائي ولا يمكن التراجع عنه. هل أنت متأكد؟")) return;
  state.accusationDone = true;
  state.lastSuspect = accuseSelectedSuspect;
  state.lastEvidenceSet = [...accuseSelectedEvidence];
  saveState();
  evaluateEnding();
}

function evaluateEnding() {
  const correctSuspect = accuseSelectedSuspect === CASE.killerId;
  const keyMatches = CASE.keyEvidenceForWin.filter((id) => accuseSelectedEvidence.includes(id)).length;
  const enoughEvidence = keyMatches >= 2;

  let outcome;
  if (correctSuspect && enoughEvidence) outcome = "correct";
  else if (correctSuspect && !enoughEvidence) outcome = "insufficientEvidence";
  else outcome = "wrongSuspect";

  // حساب النقاط
  let score = 60;
  score += state.discovered.length * 3;
  score += state.connections.length * 2;
  score -= state.hints * 5;
  score -= state.mistakes * 6;
  if (outcome === "correct") score += 20;
  if (outcome === "wrongSuspect") score -= 30;
  score = Math.max(0, Math.min(100, score));

  const rank = RANKS.find((r) => score >= r.min);
  playSound(outcome === "correct" ? "success" : "fail");
  renderEndScreen(outcome, score, rank);
}

function renderEndScreen(outcome, score, rank) {
  const ending = ENDINGS[outcome];
  const suspectName = getSuspect(accuseSelectedSuspect).name;
  const elapsedMin = Math.round((Date.now() - state.startTime) / 60000);
  showScreen("screen-end");
  document.getElementById("end-wrap").innerHTML = `
    <div class="end-icon">${ending.icon}</div>
    <div class="end-title">${ending.title}</div>
    <p class="end-text">${ending.text(suspectName)}</p>
    <div class="rank-badge">${rank.icon} <b>${rank.title}</b></div>
    <div class="end-stats">
      <div class="end-stat"><b>${score}</b><span>النقاط</span></div>
      <div class="end-stat"><b>${state.discovered.length}/${EVIDENCE.length}</b><span>الأدلة</span></div>
      <div class="end-stat"><b>${elapsedMin} د</b><span>الوقت</span></div>
    </div>
    <div class="end-actions">
      <button class="btn btn-secondary" id="end-review">مراجعة الملف</button>
      <button class="btn btn-primary" id="end-newgame">قضية جديدة</button>
    </div>
  `;
  document.getElementById("end-review").onclick = () => {
    showScreen("screen-game");
    switchTab("board");
  };
  document.getElementById("end-newgame").onclick = () => {
    clearState();
    state = freshState();
    saveState();
    showScreen("screen-caseintro");
    renderCaseIntro();
  };
}

/* ==========================================================
   تهيئة عامة
   ========================================================== */
window.closeModal = closeModal;
window.refreshCurrentTab = refreshCurrentTab;

document.addEventListener("DOMContentLoaded", () => {
  initStartScreen();
});
