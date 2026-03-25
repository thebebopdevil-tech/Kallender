/**
 * ical-parser.js
 * Parses iCalendar (.ics) text into an array of event objects.
 */

function parseICS(text) {
  // Unfold lines (RFC 5545: lines can be folded with CRLF + whitespace)
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\r/g, '');
  const lines = unfolded.split('\n');

  const events = [];
  let current = null;
  let inAlarm = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const rawKey = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);

    // Key may have parameters: DTSTART;TZID=America/New_York
    const semiIdx = rawKey.indexOf(';');
    const key = (semiIdx === -1 ? rawKey : rawKey.slice(0, semiIdx)).toUpperCase();
    const params = semiIdx === -1 ? '' : rawKey.slice(semiIdx + 1).toUpperCase();

    if (key === 'BEGIN' && value.trim() === 'VEVENT') {
      current = {};
      inAlarm = false;
    } else if (key === 'BEGIN' && value.trim() === 'VALARM') {
      inAlarm = true;
    } else if (key === 'END' && value.trim() === 'VALARM') {
      inAlarm = false;
    } else if (key === 'END' && value.trim() === 'VEVENT') {
      if (current) {
        events.push(current);
        current = null;
      }
    } else if (current && !inAlarm) {
      switch (key) {
        case 'SUMMARY':
          current.title = unescapeICS(value);
          break;
        case 'DTSTART':
          current.startRaw = value.trim();
          current.startAllDay = params.includes('VALUE=DATE') || /^\d{8}$/.test(value.trim());
          current.start = parseICSDate(value.trim(), current.startAllDay);
          break;
        case 'DTEND':
          current.endRaw = value.trim();
          current.endAllDay = params.includes('VALUE=DATE') || /^\d{8}$/.test(value.trim());
          current.end = parseICSDate(value.trim(), current.endAllDay);
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
        case 'COLOR':
          // RFC 7986 — CSS color value or name
          if (!current.colorRaw) current.colorRaw = value.trim();
          break;
        case 'X-APPLE-CALENDAR-COLOR':
          if (!current.colorRaw) current.colorRaw = value.trim();
          break;
        case 'X-GOOGLE-CALENDAR-COLOR':
          if (!current.colorRaw) current.colorRaw = value.trim();
          break;
        case 'CATEGORIES':
          // Google Calendar encodes event colour as a CATEGORIES value
          current.categories = unescapeICS(value).trim();
          break;
      }
    }
  }

  // Compute end from duration if missing
  for (const ev of events) {
    if (!ev.end && ev.start && ev.duration) {
      ev.end = addDuration(ev.start, ev.duration);
    }
    if (!ev.end && ev.start) {
      // Default: 1 hour
      ev.end = new Date(ev.start.getTime() + 60 * 60 * 1000);
    }
    if (!ev.title) ev.title = '(No title)';
  }

  return events;
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
    const y = str.slice(0, 4);
    const mo = str.slice(4, 6);
    const d = str.slice(6, 8);
    const h = str.slice(9, 11);
    const mi = str.slice(11, 13);
    const s = str.slice(13, 15);
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  }
  // Floating: YYYYMMDDTHHmmss (treat as local)
  if (/^\d{8}T\d{6}$/.test(str)) {
    const y = parseInt(str.slice(0, 4), 10);
    const m = parseInt(str.slice(4, 6), 10) - 1;
    const d = parseInt(str.slice(6, 8), 10);
    const h = parseInt(str.slice(9, 11), 10);
    const mi = parseInt(str.slice(11, 13), 10);
    const s = parseInt(str.slice(13, 15), 10);
    return new Date(y, m, d, h, mi, s);
  }
  return new Date(str);
}

function addDuration(date, duration) {
  // P[n]W or P[n]DT[n]H[n]M[n]S
  const d = new Date(date.getTime());
  const weekMatch = duration.match(/P(\d+)W/);
  if (weekMatch) {
    d.setDate(d.getDate() + parseInt(weekMatch[1], 10) * 7);
    return d;
  }
  const parts = duration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  if (parts) {
    if (parts[1]) d.setDate(d.getDate() + parseInt(parts[1], 10));
    if (parts[2]) d.setHours(d.getHours() + parseInt(parts[2], 10));
    if (parts[3]) d.setMinutes(d.getMinutes() + parseInt(parts[3], 10));
    if (parts[4]) d.setSeconds(d.getSeconds() + parseInt(parts[4], 10));
  }
  return d;
}
