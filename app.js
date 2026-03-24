/**
 * app.js — Kallender
 * Planner-style calendar viewer for .ics files. No backend, no frameworks.
 */

// ── State ─────────────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

let calendars = [];
let currentWeekStart = getWeekStart(new Date()); // Monday of first displayed week
let searchQuery = '';
let activePopupEvent = null;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  applyTheme(getSavedTheme());
  renderCalendarList();
  renderWeek();
  bindUI();
});

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
  document.getElementById('file-input').addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

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

  // Navigation moves 5 weeks at a time
  document.getElementById('prev-week').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, -35);
    renderWeek();
  });
  document.getElementById('next-week').addEventListener('click', () => {
    currentWeekStart = addDays(currentWeekStart, 35);
    renderWeek();
  });
  document.getElementById('today-btn').addEventListener('click', () => {
    currentWeekStart = getWeekStart(new Date());
    renderWeek();
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

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

// ── Planner Rendering ─────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function renderWeek() {
  updateWeekHeader();
  renderGrid();
}

function updateWeekHeader() {
  const weekEnd = addDays(currentWeekStart, 34);
  const startWeek = getISOWeekNumber(currentWeekStart);
  const endWeek = getISOWeekNumber(weekEnd);
  const yearStr = currentWeekStart.getFullYear() !== new Date().getFullYear()
    ? ` ${currentWeekStart.getFullYear()}` : '';
  document.getElementById('week-range').textContent = `Week ${startWeek}–${endWeek}${yearStr}`;
}

function renderGrid() {
  const container = document.getElementById('week-grid');
  container.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const planner = document.createElement('div');
  planner.className = 'planner-grid';

  // Corner (top-left)
  const corner = document.createElement('div');
  corner.className = 'planner-corner';
  planner.appendChild(corner);

  // 5 week header cells
  for (let w = 0; w < 5; w++) {
    const wkStart = addDays(currentWeekStart, w * 7);
    const wkEnd = addDays(wkStart, 6);
    const wkNum = getISOWeekNumber(wkStart);
    const cell = document.createElement('div');
    cell.className = 'planner-week-header';
    cell.innerHTML = `
      <span class="wh-num">Week ${wkNum}</span>
      <span class="wh-range">${formatShortRange(wkStart, wkEnd)}</span>
    `;
    planner.appendChild(cell);
  }

  // 7 day rows
  for (let d = 0; d < 7; d++) {
    // Day label (sticky left)
    const label = document.createElement('div');
    label.className = 'planner-day-label' + (d >= 5 ? ' weekend' : '');
    label.textContent = DAY_NAMES[d];
    planner.appendChild(label);

    // 5 cells for this day across weeks
    for (let w = 0; w < 5; w++) {
      const date = addDays(currentWeekStart, w * 7 + d);
      const isToday = date.getTime() === today.getTime();
      const isWeekend = d >= 5;

      const cell = document.createElement('div');
      cell.className = 'planner-cell'
        + (isToday ? ' today' : '')
        + (isWeekend ? ' weekend' : '');

      // Date number
      const dateNum = document.createElement('span');
      dateNum.className = 'cell-date' + (isToday ? ' today' : '');
      dateNum.textContent = date.getDate();
      cell.appendChild(dateNum);

      // Event pills
      const dayEvents = getEventsForDay(date);
      dayEvents.forEach(({ event: ev, cal }) => {
        cell.appendChild(createEventPill(ev, cal));
      });

      planner.appendChild(cell);
    }
  }

  container.appendChild(planner);
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
  pill.title = ev.title || '(No title)';
  pill.addEventListener('click', e => {
    e.stopPropagation();
    openPopup(ev, cal);
  });
  return pill;
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
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
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
    a.getDate() === b.getDate();
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateTime(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' ' + formatTime(date);
}

function formatShortRange(start, end) {
  const s = start.getDate();
  const e = end.getDate();
  const sm = start.toLocaleDateString(undefined, { month: 'short' });
  const em = end.toLocaleDateString(undefined, { month: 'short' });
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
