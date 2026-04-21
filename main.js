/* ============================================================
   Behaviour Board – main.js
   Version 0.5 (v0.4 + v0.5 layered, no regressions)
   ============================================================ */

/* =======================
   Constants (NEW v0.5)
   ======================= */
const MAX_POSITIVE = 5;
const MAX_NEGATIVE = 4;
const DOUBLE_TAP_DELAY = 300;

/* =======================
   Global state
   ======================= */
let classIsOpen = false;
let darkMode = false;
let highContrast = false;
let showSeatNumbers = true;
let rowLabels = {};

/* =======================
   Board safety
   ======================= */
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("selectionchange", () => {
  const sel = document.getSelection();
  if (sel && sel.rangeCount) sel.removeAllRanges();
});

/* =======================
   App bootstrap
   ======================= */
document.addEventListener("DOMContentLoaded", () => {
  loadPreferences();

  const request = indexedDB.open("behaviour-board-db", 5);

  request.onupgradeneeded = e => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains("seats")) {
      db.createObjectStore("seats", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("behaviourState")) {
      db.createObjectStore("behaviourState", { keyPath: "id" });
    }
  };

  request.onerror = e => {
    console.error("IndexedDB open error:", e.target.error);
    alert("Unable to open local database. Please refresh.");
  };

  request.onsuccess = e => loadAndRender(e.target.result);
});

/* =======================
   Preferences / themes
   ======================= */
function loadPreferences() {
  darkMode = localStorage.getItem("darkMode") === "true";
  highContrast = localStorage.getItem("highContrast") === "true";
  showSeatNumbers = localStorage.getItem("showSeatNumbers") !== "false";
  applyTheme();
}

function applyTheme() {
  if (highContrast) darkMode = false;
  document.body.classList.toggle("dark", darkMode);
  document.body.classList.toggle("high-contrast", highContrast);
}

/* =======================
   IndexedDB helpers
   ======================= */
function readAll(db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly")
      .objectStore(store)
      .getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function readBehaviour(db, id) {
  return new Promise(resolve => {
    const req = db.transaction("behaviourState", "readonly")
      .objectStore("behaviourState")
      .get(id);
    req.onsuccess = e =>
      resolve(e.target.result || { positiveCount: 0, negativeLevel: 0 });
  });
}

function writeBehaviour(db, id, pos, neg) {
  const tx = db.transaction("behaviourState", "readwrite");
  tx.objectStore("behaviourState").put({
    id,
    positiveCount: pos,
    negativeLevel: neg
  });
  tx.onerror = e => console.error("Behaviour write failed:", e.target.error);
  tx.oncomplete = () => loadAndRender(db);
}

/* =======================
   Load / render pipeline
   ======================= */
function loadAndRender(db) {
  Promise.all([
    readAll(db, "seats"),
    readAll(db, "behaviourState")
  ])
    .then(([seats, behaviour]) => renderLayout(db, seats, behaviour))
    .catch(err => {
      console.error("Load/render error:", err);
      alert("Unable to load data.");
    });
}

/* =======================
   Layout
   ======================= */
function renderLayout(db, seats, behaviour) {
  const app = document.getElementById("app");
  app.innerHTML = "";

  classIsOpen = seats.length > 0;

  app.appendChild(renderControls(db));
  app.appendChild(renderLegend());

  if (!seats.length) {
    const msg = document.createElement("div");
    msg.textContent = "No seating data loaded. Upload a CSV to begin.";
    msg.style.fontWeight = "bold";
    app.appendChild(msg);
    return;
  }

  app.appendChild(renderGridRows(db, seats, behaviour));
}

/* =======================
   Controls (grouped, v0.4)
   ======================= */
function renderControls(db) {
  const bar = document.createElement("div");
  bar.id = "controls";

  const viewGroup = document.createElement("div");
  viewGroup.className = "control-group view-group";

  const lessonGroup = document.createElement("div");
  lessonGroup.className = "control-group lesson-group";

  const dataGroup = document.createElement("div");
  dataGroup.className = "control-group data-group";

  viewGroup.appendChild(makeToggle(showSeatNumbers, "Seat numbers",
    v => { showSeatNumbers = v; localStorage.setItem("showSeatNumbers", v); loadAndRender(db); }
  ));

  viewGroup.appendChild(makeToggle(darkMode, "Dark mode",
    v => {
      darkMode = v; if (v) highContrast = false;
      localStorage.setItem("darkMode", darkMode);
      localStorage.setItem("highContrast", highContrast);
      applyTheme(); loadAndRender(db);
    }
  ));

  viewGroup.appendChild(makeToggle(highContrast, "High contrast",
    v => {
      highContrast = v; if (v) darkMode = false;
      localStorage.setItem("highContrast", highContrast);
      localStorage.setItem("darkMode", darkMode);
      applyTheme(); loadAndRender(db);
    }
  ));

  const reset = document.createElement("div");
  reset.textContent = "↺ Reset Class";
  reset.className = classIsOpen ? "" : "disabled";
  if (classIsOpen) addButtonBehavior(reset, () => {
    if (!confirm("Reset all behaviour?")) return;
    const tx = db.transaction("behaviourState", "readwrite");
    tx.objectStore("behaviourState").clear();
    tx.oncomplete = () => loadAndRender(db);
  });
  lessonGroup.appendChild(reset);

  const summary = document.createElement("div");
  summary.textContent = "≡ Lesson Summary";
  summary.className = classIsOpen ? "" : "disabled";
  if (classIsOpen) addButtonBehavior(summary, () => showSummary(db));
  lessonGroup.appendChild(summary);

  let csvInput = document.getElementById("csvInput");
  dataGroup.appendChild(makeSimpleControl("⬆ Upload CSV", () => csvInput.click()));
  dataGroup.appendChild(makeSimpleControl("⬇ Template CSV", downloadCSVTemplate));
  dataGroup.appendChild(makeSimpleControl("⬇ Export Seating", () => exportSeatingCSV(db)));
  dataGroup.appendChild(makeSimpleControl("⬇ Export Behaviour", () => exportBehaviourCSV(db)));
  dataGroup.appendChild(makeSimpleControl("⬇ Export Summary", () => exportSummaryCSV(db)));

  bar.append(viewGroup, lessonGroup, dataGroup);

  if (!csvInput) {
    csvInput = document.createElement("input");
    csvInput.type = "file";
    csvInput.id = "csvInput";
    csvInput.accept = ".csv";
    csvInput.style.display = "none";
    csvInput.addEventListener("change", e => handleCSVUpload(db, e));
    document.body.appendChild(csvInput);
  }

  return bar;
}

/* =======================
   Accessibility helpers
   ======================= */
function addButtonBehavior(el, fn) {
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.onclick = fn;
  el.onkeydown = e => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      fn();
    }
  };
}

function makeToggle(state, label, fn) {
  const el = document.createElement("div");
  el.className = "toggle-control";
  el.setAttribute("role", "switch");
  el.setAttribute("aria-checked", state);

  const labelEl = document.createElement("span");
  labelEl.className = "toggle-label";
  labelEl.textContent = label;

  const switchEl = document.createElement("span");
  switchEl.className = `toggle-switch${state ? " on" : ""}`;
  switchEl.innerHTML = `<span class="toggle-thumb"></span>`;

  el.append(labelEl, switchEl);
  addButtonBehavior(el, () => fn(!state));
  return el;
}

function makeSimpleControl(text, fn) {
  const el = document.createElement("div");
  el.textContent = text;
  addButtonBehavior(el, fn);
  return el;
}

/* =======================
   CSV import (v0.4)
   ======================= */
function handleCSVUpload(db, event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const seats = parseCSV(reader.result);
      replaceSeatsFromCSV(db, seats);
    } catch (err) {
      alert("CSV error: " + err.message);
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

/* =======================
   CSV parsing + storage
   ======================= */
function parseCSV(text) {
  const rows = text.trim().split(/\r?\n/)
    .map(r => r.split(",").map(c => c.trim()));

  rowLabels = {};
  const seats = [];
  let row = 0;

  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i][0].toUpperCase() === "SEAT") {
      row++;
      rowLabels[row] = rows[i + 1][0] || `Row ${row}`;
      let col = 1;
      for (let c = 1; c < rows[i].length && col <= 12; c++) {
        const num = Number(rows[i][c]);
        if (!num) continue;
        seats.push({
          id: `S${num}`,
          seatNumber: num,
          studentName: rows[i + 1][c] || "",
          row,
          col
        });
        col++;
      }
    }
  }

  if (!seats.length) throw new Error("No usable seating data.");
  return seats;
}

function replaceSeatsFromCSV(db, seats) {
  if (!confirm("Replace seating plan and clear all behaviour?")) return;

  const tx = db.transaction(["seats", "behaviourState"], "readwrite");
  tx.objectStore("seats").clear();
  tx.objectStore("behaviourState").clear();
  seats.forEach(s => tx.objectStore("seats").put(s));
  tx.oncomplete = () => loadAndRender(db);
}

/* =======================
   Grid rendering
   ======================= */
function renderGridRows(db, seats, behaviour) {
  const grid = document.createElement("div");
  grid.id = "grid-rows";

  const map = {};
  behaviour.forEach(b => map[b.id] = b);

  const rows = {};
  seats.forEach(s => (rows[s.row] ||= []).push(s));

  Object.entries(rows).forEach(([r, seats]) => {
    const rowEl = document.createElement("div");
    rowEl.className = "seat-row";

    const header = document.createElement("div");
    header.className = "row-header";
    header.textContent = rowLabels[r] || `Row ${r}`;
    rowEl.appendChild(header);

    seats.sort((a, b) => a.col - b.col)
      .forEach(s => rowEl.appendChild(renderSeat(db, s, map[s.id] || {})));

    grid.appendChild(rowEl);
  });

  return grid;
}

/* =======================
   Seat rendering
   ======================= */
function renderSeat(db, seat, state) {
  const el = document.createElement("div");
  el.className = "seat";
  el.dataset.seatId = seat.id;

  if (showSeatNumbers) {
    const n = document.createElement("div");
    n.className = "seat-number";
    n.textContent = seat.seatNumber;
    el.appendChild(n);
  }

  const name = document.createElement("div");
  name.className = "seat-name";
  name.textContent = seat.studentName;
  el.appendChild(name);

  el.appendChild(renderStars(state));
  el.appendChild(renderNegative(state));
  attachSeatGestures(db, el);

  return el;
}

function renderStars(state) {
  const box = document.createElement("div");
  box.className = "positives";
  for (let i = 0; i < state.positiveCount; i++) {
    box.appendChild(document.createTextNode("★"));
  }
  return box;
}

function renderNegative(state) {
  const el = document.createElement("div");
  if (!state.negativeLevel) {
    el.className = "empty-behaviour";
    return el;
  }
  el.className = `behaviour-dot behaviour-c${state.negativeLevel}`;
  return el;
}

/* =======================
   Gesture handling (v0.5)
   ======================= */
function attachSeatGestures(db, el) {
  let startY = 0;
  let y = 0;
  let pressTimer = null;
  let lastTap = 0;
  let longPress = false;

  const id = el.dataset.seatId;

  el.onpointerdown = e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    startY = y = e.clientY;
    longPress = false;

    pressTimer = setTimeout(() => {
      longPress = true;
      resetStudent(db, id);
      triggerSeatFeedback(el, "reset");
    }, 700);
  };

  el.onpointermove = e => y = e.clientY;

  el.onpointerup = e => {
    clearTimeout(pressTimer);
    el.releasePointerCapture(e.pointerId);

    if (longPress) return;

    const dy = y - startY;
    if (Math.abs(dy) > 30) {
      adjustNegative(db, id, dy < 0 ? 1 : -1, el);
      return;
    }

    const now = Date.now();
    if (now - lastTap < DOUBLE_TAP_DELAY) {
      addPositive(db, id, el);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  };
}

/* =======================
   Behaviour logic
   ======================= */
function addPositive(db, id, el) {
  readBehaviour(db, id).then(s => {
    if (s.positiveCount >= MAX_POSITIVE) {
      triggerSeatFeedback(el, "blocked");
      return;
    }
    writeBehaviour(db, id, s.positiveCount + 1, s.negativeLevel);
    triggerSeatFeedback(el, "positive");
  });
}

function adjustNegative(db, id, delta, el) {
  readBehaviour(db, id).then(s => {
    const next = Math.max(0, Math.min(MAX_NEGATIVE, s.negativeLevel + delta));
    if (next === s.negativeLevel) {
      triggerSeatFeedback(el, "blocked");
      return;
    }
    writeBehaviour(db, id, s.positiveCount, next);
    triggerSeatFeedback(el, delta > 0 ? "negative-up" : "negative-down");
  });
}

function resetStudent(db, id) {
  writeBehaviour(db, id, 0, 0);
}

/* =======================
   Visual feedback (Phase 1)
   ======================= */
function triggerSeatFeedback(el, type) {
  const cls = {
    positive: "seat-pulse-positive",
    "negative-up": "seat-pulse-negative",
    "negative-down": "seat-pulse-calm",
    reset: "seat-pulse-reset",
    blocked: "seat-pulse-blocked"
  }[type];

  if (!cls) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 450);
}

/* =======================
   Summary & exports (v0.4)
   ======================= */
function renderLegend() {
  const el = document.createElement("div");
  el.id = "legend";
  el.textContent = "Double‑tap = ★ | Swipe up/down = C‑levels | Hold = reset";
  return el;
}

function showSummary(db) {
  Promise.all([readAll(db, "seats"), readAll(db, "behaviourState")])
    .then(([seats, behaviour]) => {
      const map = {};
      behaviour.forEach(b => map[b.id] = b);

      const app = document.getElementById("app");
      app.innerHTML = "<h2>Lesson Summary</h2>";

      seats.forEach(s => {
        const b = map[s.id];
        if (!b || (!b.positiveCount && !b.negativeLevel)) return;
        app.appendChild(document.createTextNode(
          `${s.studentName} ★${b.positiveCount} C${b.negativeLevel}`
        ));
        app.appendChild(document.createElement("br"));
      });

      const close = document.createElement("div");
      close.className = "summary-close";
      close.textContent = "Close summary";
      close.onclick = () => loadAndRender(db);
      app.appendChild(close);
    });
}

function timestamp() {
  return new Date().toISOString().slice(0, 16).replace("T", "_");
}

function exportSeatingCSV(db) {
  readAll(db, "seats").then(seats => {
    const csv = buildRowBasedCSVExport(seats);
    downloadCSV(csv, `seating_${timestamp()}.csv`);
  });
}

function exportBehaviourCSV(db) {
  Promise.all([readAll(db, "seats"), readAll(db, "behaviourState")])
    .then(([seats, behaviour]) => {
      const map = {};
      behaviour.forEach(b => map[b.id] = b);
      const rows = ["Seat,Name,Positive,Negative"];
      seats.forEach(s => {
        const b = map[s.id] || {};
        rows.push(`${s.seatNumber},"${s.studentName}",${b.positiveCount || 0},${b.negativeLevel || 0}`);
      });
      downloadCSV(rows.join("\n"), `behaviour_${timestamp()}.csv`);
    });
}

function exportSummaryCSV(db) {
  Promise.all([readAll(db, "seats"), readAll(db, "behaviourState")])
    .then(([seats, behaviour]) => {
      const map = {};
      behaviour.forEach(b => map[b.id] = b);
      const rows = ["Seat,Name,Positive,Negative"];
      seats.forEach(s => {
        const b = map[s.id];
        if (!b || (!b.positiveCount && !b.negativeLevel)) return;
        rows.push(`${s.seatNumber},"${s.studentName}",${b.positiveCount},${b.negativeLevel}`);
      });
      downloadCSV(rows.join("\n"), `summary_${timestamp()}.csv`);
    });
}

function buildRowBasedCSVExport(seats) {
  const rows = [];
  const grouped = {};
  seats.forEach(s => (grouped[s.row] ||= []).push(s));
  Object.keys(grouped).sort((a, b) => a - b).forEach(r => {
    const row = grouped[r].sort((a, b) => a.col - b.col);
    rows.push(["SEAT", ...row.map(s => s.seatNumber)].join(","));
    rows.push([rowLabels[r] || `Row ${r}`, ...row.map(s => s.studentName)].join(","));
    rows.push("");
  });
  return rows.join("\n");
}

function downloadCSV(text, filename) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadCSVTemplate() {
  downloadCSV(
    "SEAT,1,2,3,4\nRow label here,,,,\n\nSEAT,5,6,7\nRow label here,,,\n\nSEAT,8,9\nRow label here,,",
    "seating_template.csv"
  );
}