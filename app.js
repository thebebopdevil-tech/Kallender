/**
 * app.js — Kallender
 * Week-based calendar viewer for .ics files. No backend, no frameworks.
 */

// ── State ─────────────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

let calendars = []; // { id, name, color, events[], visible }
let currentWeekStart = getWeekStart(new Date());
let searchQuery = '';
let activePopupEvent = null;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  applyTheme(getSavedTheme());
  renderCalendarList();
  renderWeek();
  bindUI();
  scrollTo8am();
});

// ── Storage ───────────────────────────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('kallender_calendars');
    if (raw) {
      const parsed = JSON.parse(raw);
      // Rehydrate dates
      calendars = parsed.map(cal => ({
        ...cal,
        events: cal.events.map(ev => ({
          ...ev,
          start: new Date(ev.start),
          end: new Date(ev.end),
        })),
      }));
    }
  } catch (e) {
    calendars = [];
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
  if (btn) btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

// ── UI Bindings ───────────────────────────────────────────────────────────────

function bindUI() {
  // File picker
  document.getElementById('file-input').addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // Drag and drop on the whole grid area
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

  // Navigation
  document.getElementById('prev-week').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, -7);
    renderWeek();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, 7);
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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePopup();
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
        const id = 'cal_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const name = file.name.replace(/\.ics$/i, '');
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

// ── Week Rendering ────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function renderWeek() {
  updateWeekHeader();
  renderGrid();
}

function updateWeekHeader() {
  const weekNum = getISOWeekNumber(currentWeekStart);
  const yearStr = currentWeekStart.getFullYear() !== new Date().getFullYear()
    ? ` ${currentWeekStart.getFullYear()}` : '';
  document.getElementById('week-range').textContent = `Week ${weekNum}${yearStr}`;
}

function getISOWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function renderGrid() {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Day headers row
  const headerRow = document.createElement('div');
  headerRow.className = 'grid-header-row';
  headerRow.innerHTML = '<div class="time-gutter-header"></div>';

  for (let d = 0; d < 7; d++) {
    const day = addDays(currentWeekStart, d);
    const isToday = day.getTime() === today.getTime();
    const cell = document.createElement('div');
    cell.className = 'day-header' + (isToday ? ' today' : '');
    cell.innerHTML = `<span class="day-name">${DAY_NAMES[d]}</span><span class="day-num">${day.getDate()}</span>`;
    headerRow.appendChild(cell);
  }
  grid.appendChild(headerRow);

  // Body: time gutter + day columns
  const body = document.createElement('div');
  body.className = 'grid-body';
  body.id = 'grid-body';

  // Time gutter
  const gutter = document.createElement('div');
  gutter.className = 'time-gutter';
  HOURS.forEach(h => {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.textContent = String(h).padStart(2, '0') + ':00';
    gutter.appendChild(label);
  });
  body.appendChild(gutter);

  // Collect visible, filtered events for the current week
  const weekEvents = getWeekEvents();

  // Day columns
  for (let d = 0; d < 7; d++) {
    const day = addDays(currentWeekStart, d);
    const isToday = day.getTime() === today.getTime();
    const col = document.createElement('div');
    col.className = 'day-col' + (isToday ? ' today' : '');

    // Hour cells (background grid lines)
    HOURS.forEach(h => {
      const cell = document.createElement('div');
      cell.className = 'hour-cell';
      col.appendChild(cell);
    });

    // Events for this day
    const dayEvts = weekEvents.filter(ev => isSameDay(ev.event.start, day));
    const positioned = computeLayout(dayEvts);

    positioned.forEach(({ ev, left, width }) => {
      const block = createEventBlock(ev, left, width);
      col.appendChild(block);
    });

    body.appendChild(col);
  }

  grid.appendChild(body);
  scrollTo8am();
}

function getWeekEvents() {
  const result = [];
  const weekEnd = addDays(currentWeekStart, 7);

  calendars.forEach(cal => {
    if (!cal.visible) return;
    cal.events.forEach(ev => {
      if (!ev.start) return;
      // Check if event overlaps the current week
      const evStart = ev.start;
      const evEnd = ev.end || new Date(evStart.getTime() + 3600000);

      if (evEnd <= currentWeekStart || evStart >= weekEnd) return;

      // Search filter
      if (searchQuery) {
        const haystack = [ev.title, ev.location, ev.description].join(' ').toLowerCase();
        if (!haystack.includes(searchQuery)) return;
      }

      result.push({ event: ev, cal });
    });
  });

  return result;
}

function computeLayout(dayEvts) {
  if (!dayEvts.length) return [];

  // Sort by start
  dayEvts.sort((a, b) => a.event.start - b.event.start);

  // Simple overlap grouping
  const columns = [];
  const result = [];

  dayEvts.forEach(item => {
    const start = item.event.start;
    const end = item.event.end || new Date(start.getTime() + 3600000);

    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      const lastEnd = columns[c];
      if (start >= lastEnd) {
        columns[c] = end;
        result.push({ ev: item, colIdx: c });
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push(end);
      result.push({ ev: item, colIdx: columns.length - 1 });
    }
  });

  const totalCols = columns.length;
  return result.map(r => ({
    ev: r.ev,
    left: r.colIdx / totalCols,
    width: 1 / totalCols,
  }));
}

function createEventBlock({ event: ev, cal }, left, width) {
  const HOUR_HEIGHT = 60; // px per hour (matches CSS)
  const startMins = ev.start.getHours() * 60 + ev.start.getMinutes();
  const endDate = ev.end || new Date(ev.start.getTime() + 3600000);
  const endMins = endDate.getHours() * 60 + endDate.getMinutes() || 24 * 60;
  const duration = Math.max(endMins - startMins, 15);

  const top = (startMins / 60) * HOUR_HEIGHT;
  const height = (duration / 60) * HOUR_HEIGHT - 2;

  const block = document.createElement('div');
  block.className = 'event-block';
  block.style.cssText = `
    top: ${top}px;
    height: ${height}px;
    left: calc(${left * 100}% + 2px);
    width: calc(${width * 100}% - 4px);
    --ev-color: ${cal.color};
    background: ${hexToRgba(cal.color, 0.15)};
    border-left: 3px solid ${cal.color};
  `;

  const timeStr = formatTime(ev.start);
  block.innerHTML = `
    <span class="ev-time">${timeStr}</span>
    <span class="ev-title">${escapeHtml(ev.title || '(No title)')}</span>
  `;

  block.addEventListener('click', e => {
    e.stopPropagation();
    openPopup(ev, cal);
  });

  return block;
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function openPopup(ev, cal) {
  activePopupEvent = ev;
  const overlay = document.getElementById('event-popup-overlay');
  const popup = document.getElementById('event-popup');

  document.getElementById('popup-title').textContent = ev.title || '(No title)';
  document.getElementById('popup-cal-name').textContent = cal.name;
  document.getElementById('popup-cal-dot').style.background = cal.color;

  const startStr = formatDateTime(ev.start);
  const endStr = ev.end ? formatDateTime(ev.end) : '';
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

  overlay.classList.add('active');
  popup.classList.add('active');
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
  // Monday = 1, so offset = (day + 6) % 7
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTime(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' ' + formatTime(date);
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

function scrollTo8am() {
  const body = document.getElementById('grid-body');
  if (!body) return;
  const HOUR_HEIGHT = 60;
  body.scrollTop = 8 * HOUR_HEIGHT;
}
