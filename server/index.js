import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import reportRouter from './routes/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve the full client-side app (the same one published to GitHub Pages).
// Running it here gives you the server-side /proxy below, which removes the
// browser CORS restrictions that make data show as "unavailable" on Pages.
app.use(express.static(path.join(__dirname, '..', 'docs')));

// ---- Server-side CORS proxy -------------------------------------------------
// The government data servers don't all send CORS headers, so a browser is
// blocked from reading them directly. When the app runs against this local
// server, it routes those requests through /proxy, which fetches them
// server-side (no CORS in server-to-server requests) and streams them back.
//
// Restricted to a whitelist of known public data hosts so it can't be abused
// as an open proxy.
const ALLOWED_HOST_SUFFIXES = [
  'asris.csiro.au',
  'geo.abs.gov.au',
  'agriculture.gov.au',
  'nominatim.openstreetmap.org',
  'information.qld.gov.au',
  'esoil.io',
  'soilcrc.com.au',
  'tern.org.au'
];

function hostAllowed(hostname) {
  return ALLOWED_HOST_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`));
}

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ error: 'Invalid url' });
  }
  if (parsed.protocol !== 'https:' || !hostAllowed(parsed.hostname)) {
    return res.status(403).json({ error: `Host not allowed: ${parsed.hostname}` });
  }

  try {
    const upstream = await fetch(parsed, { headers: { 'User-Agent': 'SpatialReportingTool/1.0' } });
    const body = await upstream.text();
    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.set('content-type', contentType);
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: `Upstream fetch failed: ${err.message}` });
  }
});

// Legacy JSON report API (kept for backwards compatibility; the docs/ app does
// its own client-side aggregation and doesn't need it).
app.use('/api', reportRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Spatial Reporting Tool running at http://localhost:${PORT}`);
});
