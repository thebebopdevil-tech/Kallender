/**
 * app.js — Kallendar
 * Planner-style calendar viewer for .ics files.
 * No backend, no frameworks — plain vanilla JS.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const WEEK_OPTIONS      = [1, 2, 3, 4, 5, 6, 8, 10, 12];
const DEFAULT_WEEKS     = 5;
const BUFFER_WEEKS      = 12;
const PROXY_URL         = '/api/proxy';
const SYNC_INTERVAL_MS  = 30 * 1000; // 30 seconds (testing)

// SVG icon strings ─────────────────────────────────────────────────────────────

const SVG_SUN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

const SVG_MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const SVG_REFRESH = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;

const SVG_SPINNER = `<svg class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;

const SVG_WARN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

// ── State ─────────────────────────────────────────────────────────────────────

let calendars        = [];
let preferredWeeks   = DEFAULT_WEEKS;
let currentWeekStart = getWeekStart(new Date());
let renderedStart    = null;
let colWidth         = 160;
let searchQuery      = '';
let activePopupEvent = null;
let _suppressScroll  = false;

const syncingIds     = new Set(); // cal ids currently being fetched
let subSelectedColor = PALETTE[0]; // colour chosen in subscribe dialog

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  importFromURL();       // must run before first render so shared cals are included
  applyTheme(getSavedTheme());
  renderCalendarList();
  bindUI();
  bindScroll();
  bindResize();
  renderWeek();
  // Sync all URL subscriptions on load, then every 30 min
  syncAllSubscribed();
  setInterval(syncAllSubscribed, SYNC_INTERVAL_MS);
});

// ── Mobile helpers ────────────────────────────────────────────────────────────

function isMobilePortrait() {
  return window.innerWidth < 768 && window.innerWidth < window.innerHeight;
}

function getMobileCap() {
  if (window.innerWidth >= 900) return 12;
  if (window.innerWidth < window.innerHeight) return 2;
  return 4;
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
    // Use SVG icons so size & color are consistent on all screen sizes
    btn.innerHTML = theme === 'dark' ? SVG_SUN : SVG_MOON;
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
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

// ── Subscribe dialog ──────────────────────────────────────────────────────────

function openSubscribeDialog() {
  // Pick the next palette colour as default
  subSelectedColor = PALETTE[calendars.length % PALETTE.length];

  // Reset form
  document.getElementById('sub-url').value  = '';
  document.getElementById('sub-name').value = '';
  document.getElementById('sub-url-err').textContent = '';
  document.getElementById('sub-btn-label').textContent = 'Subscribe';
  document.getElementById('sub-submit').disabled = false;
  renderColorPicker();

  document.getElementById('subscribe-overlay').classList.add('active');
  document.getElementById('subscribe-dialog').classList.add('active');
  document.getElementById('sub-url').focus();
}

function closeSubscribeDialog() {
  document.getElementById('subscribe-overlay').classList.remove('active');
  document.getElementById('subscribe-dialog').classList.remove('active');
}

function renderColorPicker() {
  const wrap = document.getElementById('sub-colors');
  if (!wrap) return;
  wrap.innerHTML = PALETTE.map(c => `
    <button type="button"
            class="color-swatch${c === subSelectedColor ? ' selected' : ''}"
            style="--c:${c}"
            data-color="${c}"
            aria-label="Colour ${c}"
            aria-pressed="${c === subSelectedColor}">
    </button>
  `).join('');
  wrap.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      subSelectedColor = btn.dataset.color;
      renderColorPicker();
    });
  });
}

function normalizeCalURL(url) {
  // webcal:// → https:// for CORS-proxy fetching
  return url.trim().replace(/^webcal:\/\//i, 'https://');
}

function extractCalName(icsText) {
  const m = icsText.match(/^X-WR-CALNAME:(.+)$/m);
  return m ? m[1].trim() : null;
}

function submitSubscription() {
  const urlInput  = document.getElementById('sub-url');
  const nameInput = document.getElementById('sub-name');
  const errEl     = document.getElementById('sub-url-err');

  let url = normalizeCalURL(urlInput.value);
  errEl.textContent = '';

  if (!url) {
    errEl.textContent = 'Please enter an iCal URL.';
    urlInput.focus();
    return;
  }

  try { new URL(url); }
  catch {
    errEl.textContent = 'That doesn\'t look like a valid URL.';
    urlInput.focus();
    return;
  }

  const protocol = new URL(url).protocol;
  if (!['http:', 'https:'].includes(protocol)) {
    errEl.textContent = 'Only http:// and https:// (or webcal://) URLs are supported.';
    urlInput.focus();
    return;
  }

  const name = nameInput.value.trim();
  const id   = 'cal_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const cal  = {
    id,
    name: name || '',   // blank → auto-detected from X-WR-CALNAME during sync
    color: subSelectedColor,
    events: [],
    visible: true,
    type: 'url',
    url,
    lastSynced: null,
    syncError: false,
  };

  calendars.push(cal);
  saveToStorage();
  renderCalendarList();
  renderWeek();
  closeSubscribeDialog();

  // Sync immediately in the background
  syncCalendar(cal);
}

// ── URL subscription sync ─────────────────────────────────────────────────────

async function syncCalendar(cal) {
  if (!cal.url || syncingIds.has(cal.id)) return;

  syncingIds.add(cal.id);
  renderCalendarList(); // show spinner

  try {
    // cache:'no-store' prevents the browser from serving a cached response;
    // the service worker is also patched to never cache /api/ paths.
    const res = await fetch(
      `${PROXY_URL}?url=${encodeURIComponent(cal.url)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const icsText = await res.text();

    cal.events    = parseICS(icsText);
    cal.lastSynced = Date.now();
    cal.syncError  = false;

    // Auto-detect name from calendar data if the user left it blank
    if (!cal.name) {
      cal.name = extractCalName(icsText) || new URL(cal.url).hostname;
    }

    saveToStorage();
    renderWeek();
    console.log(`[Kallendar] Synced "${cal.name}" — ${cal.events.length} events`);
  } catch (err) {
    console.warn('[Kallendar] Sync failed:', cal.name || cal.url, err.message);
    cal.syncError = true;
    saveToStorage();
    renderWeek(); // update grid even on failure so error state is reflected
  } finally {
    // always clear the lock and refresh the sidebar, even if an unexpected
    // exception fires — prevents syncingIds from getting permanently stuck
    syncingIds.delete(cal.id);
    renderCalendarList();
  }
}

function syncAllSubscribed() {
  const subs = calendars.filter(c => c.url);
  console.log(`[Kallendar] Auto-sync tick — ${subs.length} subscribed calendar(s)`);
  subs.forEach(syncCalendar);
}

function formatLastSynced(ts) {
  if (!ts) return 'Never synced';
  const diff = Date.now() - ts;
  if (diff < 60_000)        return 'Just now';
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Toast notification ────────────────────────────────────────────────────────

function showToast(msg) {
  const existing = document.getElementById('kallendar-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id        = 'kallendar-toast';
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  // Trigger animation on next frame
  requestAnimationFrame(() => toast.classList.add('toast-show'));

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 350);
  }, 2500);
}

// ── Shareable URL (Option A) ──────────────────────────────────────────────────

function generateShareURL() {
  const items = calendars
    .filter(c => c.url)
    .map(c => ({ url: c.url, name: c.name, color: c.color }));

  if (items.length === 0) return null;

  const json    = JSON.stringify({ v: 1, calendars: items });
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return window.location.origin + window.location.pathname + '?calendars=' + encoded;
}

function copyShareLink() {
  const url = generateShareURL();
  if (!url) {
    showToast('No subscribed calendars to share.');
    return;
  }

  const doToast = () => showToast('Link copied!');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(doToast).catch(() => {
      fallbackCopy(url);
      doToast();
    });
  } else {
    fallbackCopy(url);
    doToast();
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

function importFromURL() {
  const params  = new URLSearchParams(window.location.search);
  const encoded = params.get('calendars');
  if (!encoded) return;

  // Clean the URL immediately so it doesn't re-import on reload
  history.replaceState(null, '', window.location.pathname);

  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(json);
    if (!data.calendars || !Array.isArray(data.calendars)) return;

    let added = 0;
    data.calendars.forEach(item => {
      if (!item.url) return;
      if (calendars.some(c => c.url === item.url)) return; // skip duplicates
      const id = 'cal_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      calendars.push({
        id,
        name:       item.name  || '',
        color:      item.color || PALETTE[calendars.length % PALETTE.length],
        events:     [],
        visible:    true,
        type:       'url',
        url:        item.url,
        lastSynced: null,
        syncError:  false,
      });
      added++;
    });

    if (added > 0) {
      saveToStorage();
      // Renders happen after DOMContentLoaded flow completes; use a small delay
      // so the DOM is ready before we show the toast
      setTimeout(() => {
        renderCalendarList();
        renderWeek();
        syncAllSubscribed();
        showToast(`${added} calendar${added !== 1 ? 's' : ''} imported!`);
      }, 100);
    }
  } catch (e) {
    console.warn('[Kallendar] Failed to import from URL:', e);
  }
}

// ── Export / Import config (Option B) ────────────────────────────────────────

function exportConfig() {
  const data = {
    v:        1,
    exported: new Date().toISOString(),
    calendars: calendars.map(c => ({
      name:  c.name,
      color: c.color,
      type:  c.type,
      ...(c.url ? { url: c.url } : {}),
    })),
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'kallendar-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importConfigFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.calendars || !Array.isArray(data.calendars)) {
        showToast('Invalid config file.');
        return;
      }

      let added = 0;
      data.calendars.forEach(item => {
        if (!item.url) return; // file-imported cals have no URL → can't restore
        if (calendars.some(c => c.url === item.url)) return; // skip duplicates
        const id = 'cal_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        calendars.push({
          id,
          name:       item.name  || '',
          color:      item.color || PALETTE[calendars.length % PALETTE.length],
          events:     [],
          visible:    true,
          type:       'url',
          url:        item.url,
          lastSynced: null,
          syncError:  false,
        });
        added++;
      });

      if (added > 0) {
        saveToStorage();
        renderCalendarList();
        renderWeek();
        syncAllSubscribed();
        showToast(`${added} calendar${added !== 1 ? 's' : ''} restored!`);
      } else {
        showToast('No new calendars to import.');
      }
    } catch (_) {
      showToast('Failed to read config file.');
    }
  };
  reader.readAsText(file);
}

// ── UI Bindings ───────────────────────────────────────────────────────────────

function bindUI() {
  // File import via file-input
  document.getElementById('file-input').addEventListener('change', e => {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  // Sidebar footer buttons
  document.getElementById('sidebar-import-file-btn').addEventListener('click', () => {
    closeSidebar();
    document.getElementById('file-input').click();
  });
  document.getElementById('sidebar-subscribe-btn').addEventListener('click', () => {
    closeSidebar();
    openSubscribeDialog();
  });

  // Drag-and-drop onto app area
  const dropZone = document.getElementById('app');
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', e => {
    if (!e.relatedTarget || e.relatedTarget === document.body)
      document.body.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.endsWith('.ics') || f.type === 'text/calendar'
    );
    if (files.length) handleFiles(files);
  });

  // Navigation arrows
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

  // Event popup close
  document.getElementById('event-popup-overlay').addEventListener('click', closePopup);
  document.getElementById('popup-close').addEventListener('click', closePopup);

  // Subscribe dialog close
  document.getElementById('subscribe-overlay').addEventListener('click', closeSubscribeDialog);
  document.getElementById('subscribe-close').addEventListener('click', closeSubscribeDialog);
  document.getElementById('sub-cancel').addEventListener('click', closeSubscribeDialog);
  document.getElementById('sub-submit').addEventListener('click', submitSubscription);
  document.getElementById('sub-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitSubscription();
  });

  // Escape key closes any open overlay
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closePopup();
      closeSubscribeDialog();
    }
  });

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

  // Share button (Option A)
  document.getElementById('sidebar-share-btn').addEventListener('click', copyShareLink);

  // Export / Import config (Option B)
  document.getElementById('sidebar-export-btn').addEventListener('click', exportConfig);

  const configFileInput = document.getElementById('config-file-input');
  document.getElementById('sidebar-import-config-btn').addEventListener('click', () => {
    configFileInput.value = '';
    configFileInput.click();
  });
  configFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importConfigFile(file);
    e.target.value = '';
  });
}

// ── Scroll handling (infinite horizontal scroll) ──────────────────────────────

function bindScroll() {
  const grid = document.getElementById('week-grid');

  grid.addEventListener('scroll', () => {
    if (_suppressScroll) return;

    const scrollLeft = grid.scrollLeft;
    const weekIdx    = Math.round(scrollLeft / colWidth);
    const newStart   = addDays(renderedStart, weekIdx * 7);
    if (!isSameDay(newStart, currentWeekStart)) {
      currentWeekStart = newStart;
      updateWeekHeader();
    }

    const rightEdge = grid.scrollWidth - grid.clientWidth;
    const threshold = 6 * colWidth;
    if (scrollLeft < threshold || scrollLeft > rightEdge - threshold) {
      renderGrid();
    }
  }, { passive: true });

  grid.addEventListener('wheel', e => {
    if (e.shiftKey && Math.abs(e.deltaY) > 0) {
      e.preventDefault();
      grid.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}

// ── Resize / orientation change ───────────────────────────────────────────────

function bindResize() {
  let lastNumWeeks   = getNumWeeks();
  let lastInnerWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    updateWeeksSelector();
    const nowWeeks     = getNumWeeks();
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
        calendars.push({ id, name, color, events, visible: true, type: 'file' });
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
    list.innerHTML = '<li class="cal-empty">No calendars yet.<br>Import a file or subscribe to a URL.</li>';
    return;
  }

  calendars.forEach(cal => {
    const isSubscribed = !!cal.url;
    const isSyncing    = syncingIds.has(cal.id);

    const li = document.createElement('li');
    li.className = [
      'cal-item',
      cal.visible   ? ''              : 'cal-hidden',
      isSubscribed  ? 'cal-subscribed': '',
    ].filter(Boolean).join(' ');

    if (isSubscribed) {
      const syncedText = cal.lastSynced
        ? `Synced ${formatLastSynced(cal.lastSynced)}`
        : 'Not yet synced';

      li.innerHTML = `
        <button class="cal-toggle" title="Toggle visibility" aria-pressed="${cal.visible}" style="--cal-color:${cal.color}">
          <span class="cal-dot"></span>
        </button>
        <div class="cal-info">
          <span class="cal-name" title="${escapeHtml(cal.name || cal.url)}">${escapeHtml(cal.name || '⋯')}</span>
          <span class="cal-sync-meta${cal.syncError ? ' cal-sync-err' : ''}">
            ${cal.syncError ? SVG_WARN : ''}
            ${cal.syncError ? 'Sync failed' : syncedText}
          </span>
        </div>
        <button class="cal-refresh${isSyncing ? ' is-syncing' : ''}"
                title="${isSyncing ? 'Syncing…' : 'Refresh now'}"
                aria-label="Refresh calendar"
                ${isSyncing ? 'disabled' : ''}>
          ${isSyncing ? SVG_SPINNER : SVG_REFRESH}
        </button>
        <button class="cal-remove" title="Remove calendar" aria-label="Remove ${escapeHtml(cal.name)}">&#10005;</button>
      `;

      li.querySelector('.cal-refresh').addEventListener('click', e => {
        e.stopPropagation();
        syncCalendar(cal);
      });
    } else {
      li.innerHTML = `
        <button class="cal-toggle" title="Toggle visibility" aria-pressed="${cal.visible}" style="--cal-color:${cal.color}">
          <span class="cal-dot"></span>
        </button>
        <span class="cal-name" title="${escapeHtml(cal.name)}">${escapeHtml(cal.name)}</span>
        <button class="cal-remove" title="Remove calendar" aria-label="Remove ${escapeHtml(cal.name)}">&#10005;</button>
      `;
    }

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
  const totalCols  = BUFFER_WEEKS + numVisible + BUFFER_WEEKS;
  renderedStart    = addDays(currentWeekStart, -BUFFER_WEEKS * 7);
  colWidth         = computeColWidth();
  const labelW     = getLabelWidth();

  const planner = document.createElement('div');
  planner.className = 'planner-grid';
  planner.style.gridTemplateColumns = `${labelW}px repeat(${totalCols}, ${colWidth}px)`;
  planner.style.width = `${labelW + totalCols * colWidth}px`;

  // Corner
  const corner = document.createElement('div');
  corner.className = 'planner-corner';
  planner.appendChild(corner);

  // Week header cells
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
    const label = document.createElement('div');
    label.className = 'planner-day-label' + (d >= 5 ? ' weekend' : '');
    label.textContent = DAY_NAMES[d];
    planner.appendChild(label);

    for (let w = 0; w < totalCols; w++) {
      const date      = addDays(renderedStart, w * 7 + d);
      const isToday   = date.getTime() === today.getTime();
      const isWeekend = d >= 5;

      const cell = document.createElement('div');
      cell.className = [
        'planner-cell',
        isToday   ? 'today'   : '',
        isWeekend ? 'weekend' : '',
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
    document.getElementById('popup-location').innerHTML = linkifyText(ev.location);
  } else {
    locRow.style.display = 'none';
  }

  const descRow = document.getElementById('popup-description-row');
  if (ev.description) {
    descRow.style.display = '';
    document.getElementById('popup-description').innerHTML = linkifyText(ev.description);
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

/**
 * linkifyText — escapes str for safe HTML insertion, then wraps every
 * http/https URL it finds in a <a> that opens in a new tab.
 * Non-URL text is HTML-escaped so this is safe to set as innerHTML.
 */
function linkifyText(str) {
  if (!str) return '';
  const urlRegex = /https?:\/\/[^\s<>"']+/g;
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(str)) !== null) {
    // Escape plain text before this URL
    result += escapeHtml(str.slice(lastIndex, match.index));

    // Strip trailing punctuation that almost certainly isn't part of the URL
    // e.g. "Join here: https://meet.google.com/abc." — drop the final period
    let url = match[0].replace(/[.,;:!?)\]]+$/, '');
    const trailing = match[0].slice(url.length); // chars we stripped

    result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    if (trailing) result += escapeHtml(trailing);

    lastIndex = match.index + match[0].length;
  }

  // Append any remaining plain text
  result += escapeHtml(str.slice(lastIndex));
  return result;
}
