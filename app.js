/**
 * app.js — Kallendar
 * Planner-style calendar viewer for .ics files.
 * No backend, no frameworks — plain vanilla JS.
 */

// ── State ─────────────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const WEEK_OPTIONS  = [1, 2, 3, 4, 5, 6, 8, 10, 12];
const DEFAULT_WEEKS = 5;
const BUFFER_WEEKS  = 12; // extra weeks rendered on each side of the visible range

let calendars      = [];
let preferredWeeks = DEFAULT_WEEKS;
let currentWeekStart = getWeekStart(new Date()); // leftmost visible week
let renderedStart    = null;  // leftmost rendered week (= currentWeekStart - BUFFER)
let colWidth         = 160;   // pixel width of one week column (recalculated on render)
let searchQuery      = '';
let activePopupEvent = null;
let _suppressScroll  = false; // ignore scroll events fired by programmatic scrollLeft changes

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  applyTheme(getSavedTheme());
  renderCalendarList();
  bindUI();
  bindScroll();
  bindResize();
  renderWeek();
});

// ── Mobile helpers ────────────────────────────────────────────────────────────

function isMobilePortrait() {
  return window.innerWidth < 768 && window.innerWidth < window.innerHeight;
}

function getMobileCap() {
  if (window.innerWidth >= 900) return 12;
  if (window.innerWidth < window.innerHeight) return 2; // portrait phone
  return 4;                                             // landscape phone / small tablet
}

function getNumWeeks() {
  return Math.min(preferredWeeks, getMobileCap());
}

function updateWeeksSelector() {
  const select = document.getElementById('weeks-select');
  if (!select) return;
  const cap = getMobileCap();
  Array.from(select.options).forEach(opt => {
    opt.disabled = parseInt(opt.value, 10) > cap;
  });
  select.value = String(getNumWeeks());
}

// ── Column geometry ───────────────────────────────────────────────────────────

function getLabelWidth() {
  return window.innerWidth < 768 ? 52 : 68;
}

function computeColWidth() {
  const grid = document.getElementById('week-grid');
  if (!grid) return 160;
  const available = grid.clientWidth - getLabelWidth();
  return Math.max(100, Math.floor(available / getNumWeeks()));
}

// ── Storage ───────────────────────────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('kallender_calendars');
    if (raw) {
      const parsed = JSON.parse(raw);
      calendars = parsed.map(cal => ({
        ...cal,
        events: cal.events.map(ev => ({
          ...ev,
          start: new Date(ev.start),
          end:   new Date(ev.end),
        })),
      }));
    }
  } catch (e) {
    calendars = [];
  }

  const savedWeeks = localStorage.getItem('kallendar_weeks');
  if (savedWeeks) {
    const n = parseInt(savedWeeks, 10);
    if (WEEK_OPTIONS.includes(n)) preferredWeeks = n;
  }
}

function saveToStorage() {
  localStorage.setItem('kallender_calendars', JSON.stringify(calendars));
}

function getSavedTheme() {
  const saved = localStorage.getItem('kallender_theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('kallender_theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀' : '☾';
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}

// ── Sidebar drawer (mobile) ───────────────────────────────────────────────────

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

// ── UI Bindings ───────────────────────────────────────────────────────────────

function bindUI() {
  // File import
  document.getElementById('file-input').addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  });
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // Drag-and-drop
  const dropZone = document.getElementById('app');
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', e => {
    if (!e.relatedTarget || e.relatedTarget === document.body) {
      document.body.classList.remove('drag-over');
    }
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.endsWith('.ics') || f.type === 'text/calendar'
    );
    if (files.length) handleFiles(files);
  });

  // Navigation arrows — jump by visible week count
  document.getElementById('prev-week').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, -7 * getNumWeeks());
    renderWeek();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, 7 * getNumWeeks());
    renderWeek();
  });
  document.getElementById('today-btn').addEventListener('click', () => {
    currentWeekStart = getWeekStart(new Date());
    renderWeek();
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    document.getElementById('search-clear').style.display = searchQuery ? 'flex' : 'none';
    renderWeek();
  });
  document.getElementById('search-clear').addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    document.getElementById('search-clear').style.display = 'none';
    renderWeek();
  });

  // Popup close
  document.getElementById('event-popup-overlay').addEventListener('click', closePopup);
  document.getElementById('popup-close').addEventListener('click', closePopup);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });

  // Weeks selector
  const weeksSelect = document.getElementById('weeks-select');
  weeksSelect.addEventListener('change', () => {
    preferredWeeks = parseInt(weeksSelect.value, 10);
    localStorage.setItem('kallendar_weeks', preferredWeeks);
    renderWeek();
  });
  updateWeeksSelector();

  // Mobile sidebar
  document.getElementById('hamburger-btn').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
}

// ── Scroll handling (infinite horizontal scroll) ───────────────────────────────

function bindScroll() {
  const grid = document.getElementById('week-grid');

  // Native scroll — tracks position, updates header, re-centres buffer when needed
  grid.addEventListener('scroll', () => {
    if (_suppressScroll) return;

    const scrollLeft = grid.scrollLeft;

    // Which week column is now at the left edge?
    const weekIdx = Math.round(scrollLeft / colWidth);
    const newStart = addDays(renderedStart, weekIdx * 7);
    if (!isSameDay(newStart, currentWeekStart)) {
      currentWeekStart = newStart;
      updateWeekHeader();
    }

    // Re-centre the buffer when within 6 columns of either edge
    const rightEdge  = grid.scrollWidth - grid.clientWidth;
    const threshold  = 6 * colWidth;
    if (scrollLeft < threshold || scrollLeft > rightEdge - threshold) {
      // currentWeekStart is already updated above — re-render centres on it
      renderGrid();
    }
  }, { passive: true });

  // Shift + mouse-wheel → horizontal scroll (trackpad horizontal is already native)
  grid.addEventListener('wheel', e => {
    if (e.shiftKey && Math.abs(e.deltaY) > 0) {
      e.preventDefault();
      grid.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}

// ── Resize / orientation change ───────────────────────────────────────────────

function bindResize() {
  let lastNumWeeks  = getNumWeeks();
  let lastInnerWidth = window.innerWidth;

  window.addEventListener('resize', () => {
    updateWeeksSelector();
    const nowWeeks = getNumWeeks();
    const widthChanged = window.innerWidth !== lastInnerWidth;
    if (nowWeeks !== lastNumWeeks || widthChanged) {
      lastNumWeeks   = nowWeeks;
      lastInnerWidth = window.innerWidth;
      renderWeek();
    }
  });
}

// ── File Handling ─────────────────────────────────────────────────────────────

function handleFiles(files) {
  let loaded = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const events = parseICS(e.target.result);
        const id    = 'cal_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const name  = file.name.replace(/\.ics$/i, '');
        const color = PALETTE[calendars.length % PALETTE.length];
        calendars.push({ id, name, color, events, visible: true });
        loaded++;
        if (loaded === files.length) {
          saveToStorage();
          renderCalendarList();
          renderWeek();
        }
      } catch (err) {
        console.error('Failed to parse', file.name, err);
      }
    };
    reader.readAsText(file);
  });
}

// ── Calendar List Sidebar ─────────────────────────────────────────────────────

function renderCalendarList() {
  const list = document.getElementById('calendar-list');
  list.innerHTML = '';

  if (calendars.length === 0) {
    list.innerHTML = '<li class="cal-empty">No calendars yet.<br>Import an .ics file.</li>';
    return;
  }

  calendars.forEach(cal => {
    const li = document.createElement('li');
    li.className = 'cal-item' + (cal.visible ? '' : ' cal-hidden');
    li.innerHTML = `
      <button class="cal-toggle" title="Toggle visibility" aria-pressed="${cal.visible}" style="--cal-color:${cal.color}">
        <span class="cal-dot"></span>
      </button>
      <span class="cal-name" title="${escapeHtml(cal.name)}">${escapeHtml(cal.name)}</span>
      <button class="cal-remove" title="Remove calendar" aria-label="Remove ${escapeHtml(cal.name)}">✕</button>
    `;
    li.querySelector('.cal-toggle').addEventListener('click', () => {
      cal.visible = !cal.visible;
      saveToStorage();
      renderCalendarList();
      renderWeek();
    });
    li.querySelector('.cal-remove').addEventListener('click', () => {
      calendars = calendars.filter(c => c.id !== cal.id);
      saveToStorage();
      renderCalendarList();
      renderWeek();
    });
    list.appendChild(li);
  });
}

// ── Planner Rendering ─────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function renderWeek() {
  updateWeekHeader();
  renderGrid();
}

function updateWeekHeader() {
  const numWeeks  = getNumWeeks();
  const weekEnd   = addDays(currentWeekStart, numWeeks * 7 - 1);
  const startWeek = getISOWeekNumber(currentWeekStart);
  const endWeek   = getISOWeekNumber(weekEnd);
  const yearStr   = currentWeekStart.getFullYear() !== new Date().getFullYear()
    ? ` ${currentWeekStart.getFullYear()}` : '';

  document.getElementById('week-range').textContent =
    (numWeeks === 1 || startWeek === endWeek)
      ? `Week ${startWeek}${yearStr}`
      : `Week ${startWeek}–${endWeek}${yearStr}`;
}

function renderGrid() {
  const container  = document.getElementById('week-grid');
  const today      = new Date();
  today.setHours(0, 0, 0, 0);

  const numVisible = getNumWeeks();
  const totalCols  = BUFFER_WEEKS + numVisible + BUFFER_WEEKS; // e.g. 12+5+12 = 29
  renderedStart    = addDays(currentWeekStart, -BUFFER_WEEKS * 7);
  colWidth         = computeColWidth();
  const labelW     = getLabelWidth();

  // ── Build grid ──
  const planner = document.createElement('div');
  planner.className = 'planner-grid';
  planner.style.gridTemplateColumns = `${labelW}px repeat(${totalCols}, ${colWidth}px)`;
  planner.style.width = `${labelW + totalCols * colWidth}px`;

  // Corner (sticky top-left)
  const corner = document.createElement('div');
  corner.className = 'planner-corner';
  planner.appendChild(corner);

  // Week header cells (sticky top)
  for (let w = 0; w < totalCols; w++) {
    const wkStart = addDays(renderedStart, w * 7);
    const wkEnd   = addDays(wkStart, 6);
    const wkNum   = getISOWeekNumber(wkStart);
    const cell    = document.createElement('div');
    cell.className = 'planner-week-header' + (w === totalCols - 1 ? ' last-header' : '');
    cell.innerHTML = `<span class="wh-num">Week ${wkNum}</span><span class="wh-range">${formatShortRange(wkStart, wkEnd)}</span>`;
    planner.appendChild(cell);
  }

  // 7 day rows
  for (let d = 0; d < 7; d++) {
    // Day label (sticky left)
    const label = document.createElement('div');
    label.className = 'planner-day-label' + (d >= 5 ? ' weekend' : '');
    label.textContent = DAY_NAMES[d];
    planner.appendChild(label);

    // One cell per rendered week
    for (let w = 0; w < totalCols; w++) {
      const date      = addDays(renderedStart, w * 7 + d);
      const isToday   = date.getTime() === today.getTime();
      const isWeekend = d >= 5;

      const cell = document.createElement('div');
      cell.className = [
        'planner-cell',
        isToday   ? 'today'    : '',
        isWeekend ? 'weekend'  : '',
        w === totalCols - 1 ? 'last-col' : '',
      ].filter(Boolean).join(' ');

      const dateNum = document.createElement('span');
      dateNum.className = 'cell-date' + (isToday ? ' today' : '');
      dateNum.textContent = date.getDate();
      cell.appendChild(dateNum);

      getEventsForDay(date).forEach(({ event: ev, cal }) => {
        cell.appendChild(createEventPill(ev, cal));
      });

      planner.appendChild(cell);
    }
  }

  container.innerHTML = '';
  container.appendChild(planner);

  // Position scroll so currentWeekStart is at the left edge
  _suppressScroll = true;
  container.scrollLeft = BUFFER_WEEKS * colWidth;
  setTimeout(() => { _suppressScroll = false; }, 50);
}

function getEventsForDay(date) {
  const result = [];
  calendars.forEach(cal => {
    if (!cal.visible) return;
    cal.events.forEach(ev => {
      if (!ev.start) return;
      if (!isSameDay(ev.start, date)) return;
      if (searchQuery) {
        const haystack = [ev.title, ev.location, ev.description].join(' ').toLowerCase();
        if (!haystack.includes(searchQuery)) return;
      }
      result.push({ event: ev, cal });
    });
  });
  result.sort((a, b) => a.event.start - b.event.start);
  return result;
}

function createEventPill(ev, cal) {
  const pill = document.createElement('div');
  pill.className = 'event-pill';
  pill.style.cssText = `background:${hexToRgba(cal.color, 0.18)};border-left:3px solid ${cal.color};`;
  pill.textContent = ev.title || '(No title)';
  pill.title       = ev.title || '(No title)';
  pill.addEventListener('click', e => { e.stopPropagation(); openPopup(ev, cal); });
  return pill;
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function openPopup(ev, cal) {
  activePopupEvent = ev;
  document.getElementById('popup-title').textContent    = ev.title || '(No title)';
  document.getElementById('popup-cal-name').textContent = cal.name;
  document.getElementById('popup-cal-dot').style.background = cal.color;

  const startStr = formatDateTime(ev.start);
  const endStr   = ev.end ? formatDateTime(ev.end) : '';
  document.getElementById('popup-time').textContent =
    endStr ? `${startStr} – ${endStr}` : startStr;

  const locRow = document.getElementById('popup-location-row');
  if (ev.location) {
    locRow.style.display = '';
    document.getElementById('popup-location').textContent = ev.location;
  } else {
    locRow.style.display = 'none';
  }

  const descRow = document.getElementById('popup-description-row');
  if (ev.description) {
    descRow.style.display = '';
    document.getElementById('popup-description').textContent = ev.description;
  } else {
    descRow.style.display = 'none';
  }

  document.getElementById('event-popup-overlay').classList.add('active');
  document.getElementById('event-popup').classList.add('active');
  document.getElementById('popup-close').focus();
}

function closePopup() {
  document.getElementById('event-popup-overlay').classList.remove('active');
  document.getElementById('event-popup').classList.remove('active');
  activePopupEvent = null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return d;
}

function getISOWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate()  === b.getDate();
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTime(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    + ' ' + formatTime(date);
}

function formatShortRange(start, end) {
  const s  = start.getDate();
  const e  = end.getDate();
  const sm = start.toLocaleDateString(undefined, { month: 'short' });
  const em = end.toLocaleDateString(undefined,   { month: 'short' });
  return sm === em ? `${s}–${e} ${sm}` : `${s} ${sm}–${e} ${em}`;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
