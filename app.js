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

// Color resolution is handled inside ical-parser.js (ICS_COLOR_MAP).
// app.js only needs to fall back gracefully for events loaded from older
// localStorage snapshots that still carry the raw colorRaw / categories fields.

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

let calendars           = [];
let preferredWeeks      = DEFAULT_WEEKS;
let currentWeekStart    = getWeekStart(new Date());
let renderedStart       = null;
let colWidth            = 160;
let searchQuery         = '';
let activePopupEvent    = null;
let _suppressScroll     = false;
let showTimeIndicator   = true;
let currentUser         = null;   // set by Supabase auth
let _appBooted          = false;  // guard against double boot
let miniCalYear         = new Date().getFullYear();
let miniCalMonth        = new Date().getMonth();

const syncingIds     = new Set(); // cal ids currently being fetched
let subSelectedColor = PALETTE[0]; // colour chosen in subscribe dialog

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(getSavedTheme());
  bindAuthUI();

  // Check for an existing Supabase session (fast — reads from localStorage token)
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    bootApp();
  } else {
    document.getElementById('auth-screen').hidden = false;
  }

  // React to sign-in (from auth form) and sign-out
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && !_appBooted) {
      currentUser = session.user;
      bootApp();
    } else if (event === 'SIGNED_OUT') {
      // Reload to clear all in-memory state cleanly
      window.location.reload();
    }
  });
});

async function bootApp() {
  if (_appBooted) return;
  _appBooted = true;

  loadFromStorage();
  await cloudLoadCalendars();    // merge cloud → local
  importFromURL();               // handle ?calendars= share links
  updateSidebarUser();
  renderCalendarList();
  bindUI();
  bindScroll();
  bindResize();
  renderWeek();
  syncAllSubscribed();
  setInterval(syncAllSubscribed, SYNC_INTERVAL_MS);
  setInterval(updateTimeIndicator, 60 * 1000);

  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app').hidden = false;
}

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

  const savedIndicator = localStorage.getItem('kallendar_time_indicator');
  if (savedIndicator !== null) showTimeIndicator = savedIndicator !== 'false';
}

function saveToStorage() {
  localStorage.setItem('kallender_calendars', JSON.stringify(calendars));
}

// ── Auth UI ────────────────────────────────────────────────────────────────────

function bindAuthUI() {
  // Sign-up form
  document.getElementById('su-btn').addEventListener('click', handleSignUp);
  ['su-email', 'su-password', 'su-confirm'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleSignUp();
    });
  });

  // Sign-in form
  document.getElementById('si-btn').addEventListener('click', handleSignIn);
  ['si-email', 'si-password'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleSignIn();
    });
  });

  // View toggles
  document.getElementById('switch-to-signin').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('auth-signup').hidden = true;
    document.getElementById('auth-signin').hidden = false;
  });
  document.getElementById('switch-to-signup').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('auth-signin').hidden = true;
    document.getElementById('auth-signup').hidden = false;
  });

  // Forgot password
  document.getElementById('forgot-password-link').addEventListener('click', async e => {
    e.preventDefault();
    const email = document.getElementById('si-email').value.trim();
    if (!email) { setAuthError('si-error', 'Enter your email above first.'); return; }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) {
      setAuthError('si-error', error.message);
    } else {
      setAuthError('si-error', '');
      showToast('Password reset email sent!');
    }
  });

  // Sign out button (in sidebar)
  document.getElementById('signout-btn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    // onAuthStateChange → SIGNED_OUT → window.location.reload()
  });
}

async function handleSignUp() {
  const email    = document.getElementById('su-email').value.trim();
  const password = document.getElementById('su-password').value;
  const confirm  = document.getElementById('su-confirm').value;
  setAuthError('su-error', '');
  setAuthInfo('su-info', '');

  if (!email || !password || !confirm) { setAuthError('su-error', 'Please fill in all fields.'); return; }
  if (password !== confirm)            { setAuthError('su-error', 'Passwords do not match.'); return; }
  if (password.length < 6)            { setAuthError('su-error', 'Password must be at least 6 characters.'); return; }

  const btn = document.getElementById('su-btn');
  btn.disabled = true; btn.textContent = 'Creating account…';
  const { error } = await supabaseClient.auth.signUp({ email, password });
  btn.disabled = false; btn.textContent = 'Sign up';

  if (error) {
    setAuthError('su-error', error.message);
  } else {
    setAuthInfo('su-info', '✓ Check your email to confirm your account.');
  }
}

async function handleSignIn() {
  const email    = document.getElementById('si-email').value.trim();
  const password = document.getElementById('si-password').value;
  setAuthError('si-error', '');

  if (!email || !password) { setAuthError('si-error', 'Please fill in all fields.'); return; }

  const btn = document.getElementById('si-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign in';

  if (error) setAuthError('si-error', error.message);
  // On success: onAuthStateChange fires SIGNED_IN → bootApp()
}

function setAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.hidden = !msg;
}

function setAuthInfo(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.hidden = !msg;
}

function updateSidebarUser() {
  const wrap = document.getElementById('sidebar-user');
  const emailEl = document.getElementById('user-email-display');
  if (currentUser) {
    emailEl.textContent = currentUser.email;
    wrap.hidden = false;
  } else {
    wrap.hidden = true;
  }
}

// ── Supabase cloud sync ────────────────────────────────────────────────────────
//
// supabaseId: UUID assigned by Supabase when a calendar row is created.
// Stored on the local calendar object so we can update/delete the right row.

async function cloudLoadCalendars() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabaseClient
      .from('calendars')
      .select('*')
      .order('created_at');
    if (error) throw error;

    if (!data || data.length === 0) {
      // First login — push any locally-cached calendars up to the cloud
      if (calendars.length > 0) {
        for (const cal of calendars) await cloudSaveCalendar(cal);
      }
      return;
    }

    // Build lookup maps from local cache
    const bySid = Object.fromEntries(calendars.filter(c => c.supabaseId).map(c => [c.supabaseId, c]));
    const byUrl = Object.fromEntries(calendars.filter(c => c.url).map(c => [c.url, c]));

    // Merge: cloud drives name/url/color/type; local cache keeps events + ui state
    calendars = data.map(row => {
      const local = bySid[row.id] || byUrl[row.url] || {};
      return {
        id:         local.id || ('cal_' + Date.now() + '_' + Math.random().toString(36).slice(2)),
        supabaseId: row.id,
        name:       row.name,
        url:        row.url   || '',
        color:      row.color || PALETTE[0],
        type:       row.type  || 'url',
        events:     local.events     || [],
        visible:    local.visible    !== undefined ? local.visible : true,
        lastSynced: local.lastSynced || null,
        syncError:  local.syncError  || false,
        icsColor:   local.icsColor   || null,
      };
    });
    saveToStorage();
  } catch (e) {
    console.warn('[Kallendar] cloudLoadCalendars failed, using local cache:', e.message);
  }
}

async function cloudSaveCalendar(cal) {
  if (!currentUser) return;
  const payload = {
    user_id: currentUser.id,
    name:    cal.name || '(no name)',
    url:     cal.url  || null,
    color:   cal.color,
    type:    cal.type || 'url',
  };
  if (cal.supabaseId) payload.id = cal.supabaseId;

  try {
    const { data, error } = await supabaseClient
      .from('calendars')
      .upsert(payload, { onConflict: 'id' })
      .select()
      .single();
    if (!error && data && !cal.supabaseId) {
      cal.supabaseId = data.id;
      saveToStorage(); // persist the new supabaseId
    }
  } catch (e) {
    console.warn('[Kallendar] cloudSaveCalendar failed:', e.message);
  }
}

async function cloudDeleteCalendar(cal) {
  if (!currentUser || !cal.supabaseId) return;
  try {
    await supabaseClient.from('calendars').delete().eq('id', cal.supabaseId);
  } catch (e) {
    console.warn('[Kallendar] cloudDeleteCalendar failed:', e.message);
  }
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
  cloudSaveCalendar(cal);    // fire-and-forget cloud write
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

    const parsed      = parseICS(icsText);
    cal.events        = parsed.events;
    cal.icsColor      = parsed.calendarColor || null;
    cal.lastSynced    = Date.now();
    cal.syncError     = false;

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

  // Double-RAF ensures the browser has painted the initial state before
  // adding toast-show, so the CSS transition actually plays.
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-show')));

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
  // encodeURIComponent the base64 so +, / and = are safe in a URL query string
  return window.location.origin + window.location.pathname + '?calendars=' + encodeURIComponent(encoded);
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
    refreshEventPills();
    if (searchQuery) {
      renderSearchDropdown(searchAllEvents(searchQuery));
    } else {
      closeSearchDropdown();
    }
  });
  document.getElementById('search-clear').addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    document.getElementById('search-clear').style.display = 'none';
    closeSearchDropdown();
    refreshEventPills();
  });
  // Re-open dropdown when input is focused and already has a query
  searchInput.addEventListener('focus', () => {
    if (searchQuery) renderSearchDropdown(searchAllEvents(searchQuery));
  });
  // Keyboard: close dropdown on Escape (global handler covers the rest)
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSearchDropdown(); searchInput.blur(); }
  });
  // Close dropdown when clicking outside the search-wrap
  document.addEventListener('click', e => {
    if (!document.getElementById('search-input').closest('.search-wrap').contains(e.target)) {
      closeSearchDropdown();
    }
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

  // ── Global keyboard shortcuts ────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Always close everything on Escape
      closePopup();
      closeSubscribeDialog();
      closeSearchDropdown();
      document.getElementById('kb-popup').hidden = true;
      const si = document.getElementById('search-input');
      if (si.value) {
        si.value = '';
        searchQuery = '';
        document.getElementById('search-clear').style.display = 'none';
        refreshEventPills();
      }
      si.blur();
      return;
    }
    // All other shortcuts: skip when focus is in an editable element
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (document.activeElement && document.activeElement.isContentEditable)) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        currentWeekStart = addDays(currentWeekStart, -7 * getNumWeeks());
        renderWeek();
        break;
      case 'ArrowRight':
        e.preventDefault();
        currentWeekStart = addDays(currentWeekStart, 7 * getNumWeeks());
        renderWeek();
        break;
      case 't': case 'T':
        currentWeekStart = getWeekStart(new Date());
        renderWeek();
        break;
      case 'f': case 'F':
        e.preventDefault();
        document.getElementById('search-input').focus();
        break;
      case '?':
        toggleKbPopup();
        break;
    }
  });

  // "?" button
  document.getElementById('kb-help-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleKbPopup();
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

  // Time-indicator toggle
  const timeToggle = document.getElementById('time-indicator-toggle');
  if (timeToggle) {
    timeToggle.checked = showTimeIndicator;
    timeToggle.addEventListener('change', () => {
      showTimeIndicator = timeToggle.checked;
      localStorage.setItem('kallendar_time_indicator', String(showTimeIndicator));
      updateTimeIndicator();
    });
  }
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
        const { events, calendarColor } = parseICS(e.target.result);
        const id    = 'cal_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const name  = file.name.replace(/\.ics$/i, '');
        // Prefer the color declared in the iCal file; fall back to palette rotation
        const color = calendarColor || PALETTE[calendars.length % PALETTE.length];
        const newCal = { id, name, color, icsColor: calendarColor || null, events, visible: true, type: 'file' };
        calendars.push(newCal);
        cloudSaveCalendar(newCal);  // fire-and-forget cloud write
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
    // Clicking the color dot opens the palette popover; stop-propagation prevents
    // the parent toggle button from also firing a visibility change.
    li.querySelector('.cal-dot').addEventListener('click', e => {
      e.stopPropagation();
      openCalColorPicker(cal, e.currentTarget);
    });
    li.querySelector('.cal-remove').addEventListener('click', () => {
      calendars = calendars.filter(c => c.id !== cal.id);
      saveToStorage();
      renderCalendarList();
      renderWeek();
    });

    list.appendChild(li);
  });
  renderMiniCal(); // refresh event-dot indicators when calendar set changes
}

// ── Calendar color picker popover ─────────────────────────────────────────────

function openCalColorPicker(cal, anchorEl) {
  // Close any existing popover first
  const existing = document.getElementById('cal-color-popover');
  if (existing) { existing.remove(); return; } // second click on same dot closes it

  const popover = document.createElement('div');
  popover.id = 'cal-color-popover';
  popover.className = 'cal-color-popover';

  PALETTE.forEach(hex => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch' + (hex === cal.color ? ' selected' : '');
    swatch.style.setProperty('--c', hex);
    swatch.title = hex;
    swatch.addEventListener('click', e => {
      e.stopPropagation();
      cal.color = hex;
      saveToStorage();
      renderCalendarList();
      refreshEventPills();
      popover.remove();
    });
    popover.appendChild(swatch);
  });

  // Position below the anchor element
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top  = `${rect.bottom + window.scrollY + 6}px`;
  popover.style.left = `${rect.left  + window.scrollX}px`;
  document.body.appendChild(popover);

  // Close when clicking anywhere outside the popover
  setTimeout(() => {
    document.addEventListener('click', function onOutside(e) {
      if (!popover.contains(e.target)) {
        popover.remove();
        document.removeEventListener('click', onOutside);
      }
    });
  }, 0);
}

// ── Mini month calendar ───────────────────────────────────────────────────────

function renderMiniCal() {
  const container = document.getElementById('mini-cal');
  if (!container) return;

  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const numWeeks   = getNumWeeks();
  const viewEnd    = addDays(currentWeekStart, numWeeks * 7 - 1);

  // Collect days with events in the displayed month (for dot indicators)
  const eventDays = new Set();
  calendars.forEach(cal => {
    if (!cal.visible) return;
    cal.events.forEach(ev => {
      if (!ev.start) return;
      if (ev.start.getFullYear() === miniCalYear && ev.start.getMonth() === miniCalMonth) {
        eventDays.add(ev.start.getDate());
      }
    });
  });

  const firstOfMonth = new Date(miniCalYear, miniCalMonth, 1);
  const daysInMonth  = new Date(miniCalYear, miniCalMonth + 1, 0).getDate();
  const startDow     = (firstOfMonth.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const monthLabel   = firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Build HTML
  let html = `
    <div class="mini-cal-hdr">
      <button class="mini-cal-nav" data-dir="-1" aria-label="Previous month">&#8249;</button>
      <span class="mini-cal-title">${monthLabel}</span>
      <button class="mini-cal-nav" data-dir="1"  aria-label="Next month">&#8250;</button>
    </div>
    <div class="mini-cal-grid">`;

  // Day-of-week headers: M T W T F S S
  ['M','T','W','T','F','S','S'].forEach(d => {
    html += `<div class="mini-dow">${d}</div>`;
  });

  // Leading empty cells
  for (let i = 0; i < startDow; i++) {
    html += '<div class="mini-day empty"></div>';
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const date     = new Date(miniCalYear, miniCalMonth, d);
    const isToday  = date.getTime() === today.getTime();
    const inView   = date >= currentWeekStart && date <= viewEnd;
    const hasEvent = eventDays.has(d);
    const isoDate  = `${miniCalYear}-${String(miniCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cls = ['mini-day',
      isToday ? 'mini-today' : '',
      inView  ? 'mini-in-view' : '',
    ].filter(Boolean).join(' ');

    html += `<div class="${cls}" data-date="${isoDate}">
      <span class="mini-day-num">${d}</span>
      ${hasEvent ? '<span class="mini-dot"></span>' : ''}
    </div>`;
  }

  html += '</div>'; // end .mini-cal-grid
  container.innerHTML = html;

  // Month navigation
  container.querySelectorAll('.mini-cal-nav').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      miniCalMonth += parseInt(btn.dataset.dir, 10);
      if (miniCalMonth < 0)  { miniCalMonth = 11; miniCalYear--; }
      if (miniCalMonth > 11) { miniCalMonth = 0;  miniCalYear++; }
      renderMiniCal();
    });
  });

  // Click a day → navigate main grid to that week
  container.querySelectorAll('.mini-day[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const [y, m, d] = cell.dataset.date.split('-').map(Number);
      currentWeekStart = getWeekStart(new Date(y, m - 1, d));
      renderWeek();
    });
  });
}

// ── Planner Rendering ─────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Search dropdown ───────────────────────────────────────────────────────────

function searchAllEvents(query) {
  const results = [];
  calendars.forEach(cal => {
    if (!cal.visible) return;
    cal.events.forEach(ev => {
      if (!ev.start) return;
      const haystack = [ev.title, ev.location, ev.description].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(query)) return;
      results.push({ ev, cal });
    });
  });
  results.sort((a, b) => a.ev.start - b.ev.start);
  return results.slice(0, 10);
}

function renderSearchDropdown(results) {
  const dd = document.getElementById('search-dropdown');
  dd.innerHTML = '';
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-no-results';
    empty.textContent = 'No events found';
    dd.appendChild(empty);
  } else {
    results.forEach(({ ev, cal }) => {
      const item = document.createElement('div');
      item.className = 'search-result';
      const dayStr  = ev.start.toLocaleDateString(undefined, { weekday: 'long' });
      const dateStr = ev.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      item.innerHTML =
        `<div class="search-result-title">${escapeHtml(ev.title || '(No title)')}</div>` +
        `<div class="search-result-meta">${escapeHtml(dayStr)}, ${escapeHtml(dateStr)}` +
        ` &middot; <span style="color:${cal.color}">${escapeHtml(cal.name)}</span></div>`;
      item.addEventListener('mousedown', e => {
        e.preventDefault(); // keep input focused until we're done
        closeSearchDropdown();
        navigateToSearchResult(ev);
      });
      dd.appendChild(item);
    });
  }
  dd.hidden = false;
}

function closeSearchDropdown() {
  document.getElementById('search-dropdown').hidden = true;
}

function toggleKbPopup() {
  const popup = document.getElementById('kb-popup');
  popup.hidden = !popup.hidden;
  if (!popup.hidden) {
    // Close on next outside click
    setTimeout(() => {
      document.addEventListener('click', function onOutside(e) {
        if (!popup.contains(e.target) && e.target.id !== 'kb-help-btn') {
          popup.hidden = true;
        }
        document.removeEventListener('click', onOutside);
      });
    }, 0);
  }
}

function navigateToSearchResult(ev) {
  // Clear search state so all events render normally
  searchQuery = '';
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('search-clear').style.display = 'none';
  refreshEventPills();

  // Navigate grid to the week containing the event
  currentWeekStart = getWeekStart(ev.start);
  renderGrid();

  // Briefly highlight the day cell
  const pad = n => String(n).padStart(2, '0');
  const key = `${ev.start.getFullYear()}-${pad(ev.start.getMonth()+1)}-${pad(ev.start.getDate())}`;
  const cell = document.querySelector(`.planner-cell[data-date="${key}"]`);
  if (cell) {
    cell.classList.add('nav-highlight');
    setTimeout(() => cell.classList.remove('nav-highlight'), 1400);
  }
}

function renderWeek() {
  updateWeekHeader();
  renderGrid();
  renderMiniCal();
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

// ── Today time indicator ──────────────────────────────────────────────────────

function updateTimeIndicator() {
  // Remove any existing indicators
  document.querySelectorAll('.time-indicator').forEach(el => el.remove());
  if (!showTimeIndicator) return;

  const now   = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const pad   = n => String(n).padStart(2, '0');
  const key   = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const cell  = document.querySelector(`.planner-cell[data-date="${key}"]`);
  if (!cell) return; // today not in current rendered range

  const pct = (now.getHours() * 60 + now.getMinutes()) / 1440 * 100;
  const indicator = document.createElement('div');
  indicator.className = 'time-indicator';
  indicator.style.top = `${pct}%`;
  cell.appendChild(indicator);
}

// ── Event colour resolution ───────────────────────────────────────────────────

// Per-event colour extraction from Google Calendar's basic.ics feed is not
// supported — Google does not include color data in the iCal export.
// All pills use the calendar's own color (cal.color) set by the user.
// resolveEventColor is kept only for forward-compat with parsers that do
// include per-event color (e.g. Apple Calendar file imports via X-APPLE-CALENDAR-COLOR).
function resolveEventColor(ev) {
  // Parser stores a resolved hex in ev.color when available
  return ev.color || null;
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

  // Density tier drives pill font size, time visibility, and title wrapping
  const densityClass = colWidth >= 180 ? 'pill-wide' : colWidth >= 120 ? 'pill-medium' : 'pill-narrow';

  const planner = document.createElement('div');
  planner.className = `planner-grid ${densityClass}`;
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

  // ── All-day row ──────────────────────────────────────────────────────────────
  const adLabel = document.createElement('div');
  adLabel.className = 'planner-allday-label';
  adLabel.textContent = 'All day';
  planner.appendChild(adLabel);

  for (let w = 0; w < totalCols; w++) {
    const wkStart = addDays(renderedStart, w * 7);
    const adCell  = document.createElement('div');
    adCell.className = 'planner-allday-cell' + (w === totalCols - 1 ? ' last-col' : '');
    adCell.dataset.weekStart = `${wkStart.getFullYear()}-${String(wkStart.getMonth()+1).padStart(2,'0')}-${String(wkStart.getDate()).padStart(2,'0')}`;
    getAllDayEventsForWeek(wkStart).forEach(({ event: ev, cal }) => {
      adCell.appendChild(createEventPill(ev, cal));
    });
    planner.appendChild(adCell);
  }

  // ── 7 day rows ────────────────────────────────────────────────────────────────
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
      cell.dataset.date = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

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

  _suppressScroll = true;          // set BEFORE any DOM change that could fire scroll
  container.innerHTML = '';
  container.appendChild(planner);
  container.scrollLeft = BUFFER_WEEKS * colWidth;
  setTimeout(() => { _suppressScroll = false; }, 50);
  updateTimeIndicator();
}

// Lightweight pill refresh — used by search so the grid never scrolls
function refreshEventPills() {
  // Timed-event day cells
  document.querySelectorAll('.planner-cell[data-date]').forEach(cell => {
    cell.querySelectorAll('.event-pill').forEach(p => p.remove());
    const [y, m, d] = cell.dataset.date.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    getEventsForDay(date).forEach(({ event: ev, cal }) => {
      cell.appendChild(createEventPill(ev, cal));
    });
  });
  // All-day row cells
  document.querySelectorAll('.planner-allday-cell[data-week-start]').forEach(cell => {
    cell.querySelectorAll('.event-pill').forEach(p => p.remove());
    const [y, m, d] = cell.dataset.weekStart.split('-').map(Number);
    const weekStart = new Date(y, m - 1, d);
    getAllDayEventsForWeek(weekStart).forEach(({ event: ev, cal }) => {
      cell.appendChild(createEventPill(ev, cal));
    });
  });
}

function getEventsForDay(date) {
  const result = [];
  calendars.forEach(cal => {
    if (!cal.visible) return;
    cal.events.forEach(ev => {
      if (!ev.start) return;
      if (ev.startAllDay) return;        // shown in all-day row instead
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

function getAllDayEventsForWeek(weekStart) {
  const weekEnd = addDays(weekStart, 6); // Sunday midnight (inclusive for midnight dates)
  const result  = [];
  calendars.forEach(cal => {
    if (!cal.visible) return;
    cal.events.forEach(ev => {
      if (!ev.startAllDay || !ev.start) return;
      if (searchQuery) {
        const haystack = [ev.title, ev.location, ev.description].join(' ').toLowerCase();
        if (!haystack.includes(searchQuery)) return;
      }
      // DTEND for all-day events is exclusive — last day = ev.end - 1
      const evLastDay = (ev.endAllDay && ev.end) ? addDays(ev.end, -1) : (ev.end || ev.start);
      if (ev.start <= weekEnd && evLastDay >= weekStart) {
        result.push({ event: ev, cal });
      }
    });
  });
  result.sort((a, b) => a.event.start - b.event.start);
  return result;
}

function createEventPill(ev, cal) {
  const pill  = document.createElement('div');
  pill.className = searchQuery ? 'event-pill search-match' : 'event-pill';
  const color = resolveEventColor(ev) || cal.color;
  pill.style.cssText = `background:${hexToRgba(color, 0.18)};border-left:3px solid ${color};`;

  const titleEl = document.createElement('span');
  titleEl.className   = 'pill-title';
  titleEl.textContent = ev.title || '(No title)';
  pill.appendChild(titleEl);

  // Show start time for timed (non-all-day) events
  if (!ev.startAllDay && ev.start) {
    const timeEl = document.createElement('span');
    timeEl.className   = 'pill-time';
    timeEl.textContent = formatTime(ev.start);
    pill.appendChild(timeEl);
  }

  // Tooltip shows full title + time for truncated pills
  const timeStr = (!ev.startAllDay && ev.start) ? ` · ${formatTime(ev.start)}` : '';
  pill.title = (ev.title || '(No title)') + timeStr;
  pill.addEventListener('click', e => { e.stopPropagation(); openPopup(ev, cal); });
  return pill;
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function openPopup(ev, cal) {
  activePopupEvent = ev;
  document.getElementById('popup-title').textContent    = ev.title || '(No title)';
  document.getElementById('popup-cal-name').textContent = cal.name;
  document.getElementById('popup-cal-dot').style.background = cal.color;

  let timeText;
  if (ev.startAllDay) {
    const fmt = d => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const s = fmt(ev.start);
    if (ev.endAllDay && ev.end) {
      const lastDay = addDays(ev.end, -1); // DTEND is exclusive for all-day events
      timeText = isSameDay(ev.start, lastDay) ? `All day · ${s}` : `All day · ${s} – ${fmt(lastDay)}`;
    } else {
      timeText = `All day · ${s}`;
    }
  } else {
    const startStr = formatDateTime(ev.start);
    const endStr   = ev.end ? formatDateTime(ev.end) : '';
    timeText = endStr ? `${startStr} – ${endStr}` : startStr;
  }
  document.getElementById('popup-time').textContent = timeText;

  const locRow = document.getElementById('popup-location-row');
  if (ev.location) {
    locRow.style.display = '';
    document.getElementById('popup-location').innerHTML = linkifyLocation(ev.location);
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
 * linkifyLocation — smart handler for the LOCATION field.
 * • If the value already contains a URL (http/https) → delegate to linkifyText
 *   so the link is rendered inline exactly as-is.
 * • Otherwise treat the whole string as a physical address and wrap it in a
 *   Google Maps search link (works for full addresses, venue names, cities, etc.)
 */
function linkifyLocation(str) {
  if (!str) return '';
  if (/https?:\/\//i.test(str)) return linkifyText(str);
  const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(str);
  return `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(str)}</a>`;
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
