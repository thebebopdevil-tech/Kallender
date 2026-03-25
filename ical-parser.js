/**
 * ical-parser.js
 * Parses iCalendar (.ics) text into an array of event objects.
 * Returns { events, calendarColor } so callers can also get the
 * calendar-level color declared in the VCALENDAR block.
 */

// ── Color name → hex map ──────────────────────────────────────────────────────
// Covers: Google Calendar named colors, Outlook/M365 category names,
//         Apple-used CSS color keywords, and a handful of RFC 7986 names.
const ICS_COLOR_MAP = {
  // Google Calendar
  'tomato':           '#d50000',
  'flamingo':         '#e67c73',
  'tangerine':        '#f4511e',
  'banana':           '#f6bf26',
  'sage':             '#33b679',
  'basil':            '#0b8043',
  'peacock':          '#039be5',
  'blueberry':        '#3f51b5',
  'lavender':         '#7986cb',
  'grape':            '#8e24aa',
  'graphite':         '#616161',
  // Microsoft 365 / Outlook category names
  'red category':     '#e74c3c',
  'orange category':  '#e67e22',
  'yellow category':  '#f1c40f',
  'green category':   '#27ae60',
  'blue category':    '#2980b9',
  'purple category':  '#9b59b6',
  'pink category':    '#e91e8c',
  'brown category':   '#795548',
  'black category':   '#212121',
  'gray category':    '#757575',
  'grey category':    '#757575',
  // Plain Outlook names (without " category" suffix)
  'red':              '#e74c3c',
  'orange':           '#e67e22',
  'yellow':           '#f1c40f',
  'green':            '#27ae60',
  'blue':             '#2980b9',
  'purple':           '#9b59b6',
  'pink':             '#e91e8c',
  'brown':            '#795548',
  'black':            '#212121',
  'gray':             '#757575',
  'grey':             '#757575',
  'white':            '#9e9e9e',
  // Common CSS / RFC 7986 color names
  'coral':            '#ff7f50',
  'salmon':           '#fa8072',
  'gold':             '#ffd700',
  'teal':             '#008080',
  'cyan':             '#00bcd4',
  'indigo':           '#3f51b5',
  'violet':           '#8e24aa',
  'magenta':          '#e91e63',
  'lime':             '#8bc34a',
  'navy':             '#1a237e',
  'maroon':           '#880e4f',
  'olive':            '#afb42b',
  'silver':           '#9e9e9e',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise any raw color string to a 6-digit hex, or return null. */
function resolveICSColor(raw, categories) {
  if (raw) {
    const c = raw.trim();
    // 8-digit hex with alpha (#RRGGBBAA) — strip alpha
    if (/^#[0-9A-Fa-f]{8}$/.test(c)) return c.slice(0, 7).toLowerCase();
    // 3 or 6-digit hex
    if (/^#[0-9A-Fa-f]{3,6}$/.test(c)) return c.toLowerCase();
    // Named color from map
    const byName = ICS_COLOR_MAP[c.toLowerCase()];
    if (byName) return byName;
  }
  if (categories) {
    for (const cat of categories.split(',')) {
      const byName = ICS_COLOR_MAP[cat.trim().toLowerCase()];
      if (byName) return byName;
    }
  }
  return null;
}

// ── Main parser ───────────────────────────────────────────────────────────────

function parseICS(text) {
  // Unfold lines (RFC 5545: lines can be folded with CRLF + whitespace)
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\r/g, '');
  const lines = unfolded.split('\n');

  const events = [];
  let current    = null;
  let inAlarm    = false;
  let calendarColor = null; // calendar-level color from VCALENDAR block

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const rawKey = line.slice(0, colonIdx);
    const value  = line.slice(colonIdx + 1);

    // Key may have parameters: DTSTART;TZID=America/New_York
    const semiIdx = rawKey.indexOf(';');
    const key     = (semiIdx === -1 ? rawKey : rawKey.slice(0, semiIdx)).toUpperCase();
    const params  = semiIdx === -1 ? '' : rawKey.slice(semiIdx + 1).toUpperCase();

    if (key === 'BEGIN' && value.trim() === 'VEVENT') {
      current  = {};
      inAlarm  = false;
    } else if (key === 'BEGIN' && value.trim() === 'VALARM') {
      inAlarm = true;
    } else if (key === 'END' && value.trim() === 'VALARM') {
      inAlarm = false;
    } else if (key === 'END' && value.trim() === 'VEVENT') {
      if (current) {
        // Resolve raw color/categories to a clean hex now, before storing
        current.color = resolveICSColor(current._colorRaw, current._categories) || null;
        delete current._colorRaw;
        delete current._categories;
        events.push(current);
        current = null;
      }
    } else if (current && !inAlarm) {
      // ── Properties inside a VEVENT ────────────────────────────────────────
      switch (key) {
        case 'SUMMARY':
          current.title = unescapeICS(value);
          break;
        case 'DTSTART':
          current.startRaw  = value.trim();
          current.startAllDay = params.includes('VALUE=DATE') || /^\d{8}$/.test(value.trim());
          current.start     = parseICSDate(value.trim(), current.startAllDay);
          break;
        case 'DTEND':
          current.endRaw   = value.trim();
          current.endAllDay = params.includes('VALUE=DATE') || /^\d{8}$/.test(value.trim());
          current.end      = parseICSDate(value.trim(), current.endAllDay);
          break;
        case 'DURATION':
          current.duration = value.trim();
          break;
        case 'LOCATION':
          current.location = unescapeICS(value);
          break;
        case 'DESCRIPTION':
          current.description = unescapeICS(value);
          break;
        case 'UID':
          current.uid = value.trim();
          break;
        case 'RRULE':
          current.rrule = value.trim();
          break;

        // ── Color properties (event level) ─────────────────────────────────
        // Priority: COLOR > X-GOOGLE-CALENDAR-COLOR > X-APPLE-CALENDAR-COLOR
        case 'COLOR':
          current._colorRaw = current._colorRaw || value.trim();
          break;
        case 'X-GOOGLE-CALENDAR-COLOR':
          current._colorRaw = current._colorRaw || value.trim();
          break;
        case 'X-APPLE-CALENDAR-COLOR':
          // Apple puts this on the VCALENDAR block, but occasionally on events too
          current._colorRaw = current._colorRaw || value.trim();
          break;
        case 'CATEGORIES':
          // Google Calendar and Outlook encode color as a category name
          current._categories = unescapeICS(value).trim();
          break;
      }
    } else if (!current) {
      // ── Properties at VCALENDAR level (outside any VEVENT) ───────────────
      switch (key) {
        case 'X-APPLE-CALENDAR-COLOR':
          // Apple Calendar writes the calendar color here
          if (!calendarColor) {
            const c = value.trim();
            // Strip alpha from 8-digit hex
            if (/^#[0-9A-Fa-f]{8}$/.test(c))      calendarColor = c.slice(0, 7).toLowerCase();
            else if (/^#[0-9A-Fa-f]{3,6}$/.test(c)) calendarColor = c.toLowerCase();
          }
          break;
        case 'COLOR':
          // RFC 7986 calendar-level COLOR property
          if (!calendarColor) {
            calendarColor = resolveICSColor(value.trim(), null);
          }
          break;
        case 'X-GOOGLE-CALENDAR-COLOR':
          if (!calendarColor) {
            calendarColor = resolveICSColor(value.trim(), null);
          }
          break;
      }
    }
  }

  // ── Post-processing ───────────────────────────────────────────────────────
  for (const ev of events) {
    if (!ev.end && ev.start && ev.duration) {
      ev.end = addDuration(ev.start, ev.duration);
    }
    if (!ev.end && ev.start) {
      ev.end = new Date(ev.start.getTime() + 60 * 60 * 1000); // default 1 hour
    }
    if (!ev.title) ev.title = '(No title)';
  }

  // ── Debug logging ─────────────────────────────────────────────────────────
  console.log(
    `[Kallendar] Parsed ${events.length} event(s). Calendar color: ${calendarColor || 'none'}`
  );
  events.slice(0, 3).forEach((ev, i) => {
    console.log(
      `[Kallendar]   Event ${i + 1}: "${ev.title}" | color: ${ev.color || 'none'}`
    );
  });

  return { events, calendarColor };
}

function unescapeICS(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseICSDate(str, allDay) {
  // All-day: YYYYMMDD
  if (allDay || /^\d{8}$/.test(str)) {
    const y = parseInt(str.slice(0, 4), 10);
    const m = parseInt(str.slice(4, 6), 10) - 1;
    const d = parseInt(str.slice(6, 8), 10);
    return new Date(y, m, d, 0, 0, 0);
  }
  // UTC: YYYYMMDDTHHmmssZ
  if (str.endsWith('Z')) {
    const y  = str.slice(0, 4);
    const mo = str.slice(4, 6);
    const d  = str.slice(6, 8);
    const h  = str.slice(9, 11);
    const mi = str.slice(11, 13);
    const s  = str.slice(13, 15);
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  }
  // Floating: YYYYMMDDTHHmmss (treat as local)
  if (/^\d{8}T\d{6}$/.test(str)) {
    const y  = parseInt(str.slice(0, 4), 10);
    const m  = parseInt(str.slice(4, 6), 10) - 1;
    const d  = parseInt(str.slice(6, 8), 10);
    const h  = parseInt(str.slice(9, 11), 10);
    const mi = parseInt(str.slice(11, 13), 10);
    const s  = parseInt(str.slice(13, 15), 10);
    return new Date(y, m, d, h, mi, s);
  }
  return new Date(str);
}

function addDuration(date, duration) {
  // P[n]W  or  P[n]DT[n]H[n]M[n]S
  const d = new Date(date.getTime());
  const weekMatch = duration.match(/P(\d+)W/);
  if (weekMatch) {
    d.setDate(d.getDate() + parseInt(weekMatch[1], 10) * 7);
    return d;
  }
  const parts = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  if (parts) {
    if (parts[1]) d.setDate(d.getDate()     + parseInt(parts[1], 10));
    if (parts[2]) d.setHours(d.getHours()   + parseInt(parts[2], 10));
    if (parts[3]) d.setMinutes(d.getMinutes()+ parseInt(parts[3], 10));
    if (parts[4]) d.setSeconds(d.getSeconds()+ parseInt(parts[4], 10));
  }
  return d;
}
