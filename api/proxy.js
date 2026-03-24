/**
 * api/proxy.js — Vercel serverless proxy for iCal URL subscriptions.
 *
 * Usage: GET /api/proxy?url=<encoded-ical-url>
 *
 * Fetches the remote iCal feed server-side (bypassing browser CORS
 * restrictions) and streams the raw text back to the caller.
 */

module.exports = async function handler(req, res) {
  // ── CORS headers ────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ── Validate the ?url= param ─────────────────────────────────────────────────
  const { url } = req.query;
  if (!url) {
    res.status(400).json({ error: 'Missing ?url= parameter' });
    return;
  }

  let parsed;
  try { parsed = new URL(url); }
  catch { res.status(400).json({ error: 'Invalid URL' }); return; }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.status(400).json({ error: 'Only http/https URLs are supported' });
    return;
  }

  // ── Fetch the remote feed ────────────────────────────────────────────────────
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Kallendar/1.0 (+https://github.com/thebebopdevil-tech/Kallender)',
        'Accept': 'text/calendar, application/ics, */*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000), // 12 s
    });

    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream returned HTTP ${upstream.status}` });
      return;
    }

    const body = await upstream.text();
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.status(200).send(body);
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Request timed out after 12 s' : err.message;
    res.status(502).json({ error: msg });
  }
};
