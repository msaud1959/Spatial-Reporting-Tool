// Client-side data services: calls each public API directly from the browser
// (no backend needed). Each function fails independently and returns an
// `error` field instead of throwing, so one unreachable source never breaks
// the whole report.

const FETCH_TIMEOUT_MS = 20000;

// When the app is served from the bundled Node server (npm start), it offers a
// same-origin /proxy endpoint that fetches the government APIs server-side,
// where CORS doesn't apply. This is the reliable path, so we use it first when
// running on localhost.
const RUNNING_LOCAL = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);
const localProxy = (u) => `/proxy?url=${encodeURIComponent(u)}`;

// Some of the government data servers don't send CORS headers, so a browser
// running on github.io is blocked from reading their responses ("Failed to
// fetch"). On GitHub Pages (no backend) we try the API directly first (fast
// path when CORS is allowed), then fall back to public CORS proxies that
// re-serve the response with permissive headers.
// Each entry builds the proxied request URL from the target; `unwrap` (if
// present) extracts the real JSON payload from the proxy's own response
// shape (e.g. allorigins' /get wraps the body as a string inside `contents`).
const CORS_PROXIES = [
  { build: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  {
    build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    unwrap: (json) => (typeof json.contents === 'string' ? JSON.parse(json.contents) : json.contents)
  },
  { build: (u) => `https://thingproxy.freeboard.io/fetch/${u}` },
  { build: (u) => `https://corsproxy.org/?${encodeURIComponent(u)}` },
  { build: (u) => `https://proxy.cors.sh/${u}` }
];

let jsonpCounter = 0;

// ArcGIS REST servers (SLGA, ABS ASGS) support JSONP via a `callback` query
// param - a <script> tag fetch that browsers never apply CORS to. This is
// far more reliable than the public CORS proxies above, so it's tried first
// for any Esri endpoint.
function jsonpFetch(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__jsonp_cb_${Date.now()}_${jsonpCounter++}`;
    const script = document.createElement('script');
    const timeout = setTimeout(() => cleanup(() => reject(new Error('JSONP timeout'))), FETCH_TIMEOUT_MS);

    function cleanup(then) {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
      then();
    }

    window[callbackName] = (data) => cleanup(() => resolve(data));
    script.onerror = () => cleanup(() => reject(new Error('JSONP request failed')));

    const u = new URL(url);
    u.searchParams.set('callback', callbackName);
    script.src = u.toString();
    document.head.appendChild(script);
  });
}

async function timedFetch(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError' || /aborted/i.test(err.message || '')) {
      throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${new URL(url, location.href).hostname}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEsriJson(url) {
  // Local server proxy is the most reliable; use it directly when available.
  if (RUNNING_LOCAL) return fetchJson(url);
  try {
    return await jsonpFetch(url);
  } catch (err) {
    return fetchJson(url);
  }
}

async function fetchJson(url, options = {}) {
  const direct = String(url);
  const targets = RUNNING_LOCAL
    ? [{ label: 'local proxy', url: localProxy(direct) }, { label: 'direct', url: direct }]
    : [
        { label: 'direct', url: direct },
        ...CORS_PROXIES.map((p, i) => ({ label: `CORS proxy ${i + 1}`, url: p.build(direct), unwrap: p.unwrap }))
      ];
  // Browsers hide the real reason for a CORS/network failure behind the
  // generic "Failed to fetch" TypeError, which is useless on its own. Collect
  // which fallback was tried and why each one failed so the final error
  // actually says something diagnosable instead of just "Failed to fetch".
  const attempts = [];
  for (const target of targets) {
    try {
      const res = await timedFetch(target.url, options);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const t = await res.text(); if (t) detail += `: ${t.slice(0, 200)}`; } catch (e) { /* ignore */ }
        throw new Error(detail);
      }
      const json = await res.json();
      return target.unwrap ? target.unwrap(json) : json;
    } catch (err) {
      attempts.push(`${target.label}: ${err.message || err}`);
      // Try the next fallback on network/CORS failures; keep looping otherwise.
    }
  }
  throw new Error(`All ${attempts.length} attempt(s) failed — ${attempts.join(' | ')}`);
}

// ---- Geometry -------------------------------------------------------------

function normaliseArea(area) {
  let polygon;
  if (area.type === 'point') {
    const [lng, lat] = area.center;
    polygon = turf.circle([lng, lat], area.radiusMeters / 1000, { units: 'kilometers', steps: 64 });
  } else if (area.type === 'polygon') {
    const geojson = area.geojson;
    polygon = geojson.type === 'Feature' ? geojson : turf.feature(geojson);
  } else {
    throw new Error(`Unsupported area type: ${area.type}`);
  }

  const centroid = turf.centroid(polygon).geometry.coordinates;
  const areaHectares = turf.area(polygon) / 10000;
  const bbox = turf.bbox(polygon);
  return { polygon, centroid, areaHectares, bbox };
}

// ---- Soil (CSIRO/TERN SLGA point "Drill" API) ------------------------------
// The ASRIS SLGA "Drill" API returns every soil attribute at all six standard
// depths for a single point in one call. This replaced an earlier (incorrect)
// per-attribute ArcGIS identify approach.

// The Drill response names attributes with C#-style backing-field keys like
// "<attributeName>k__BackingField". Map those names to our SLGA codes.
const DRILL_ATTR_MAP = {
  'CLAY': 'CLY',
  'SILT': 'SLT',
  'SAND': 'SND',
  'PHC': 'PHW',            // pH (CaCl2)
  'SOC': 'SOC',
  'AWC': 'AWC',
  'BULK-DENSITY': 'BDW',
  'TOTAL_N': 'NTO'
};

function cleanValue(v) {
  if (v === null || v === undefined || v === '' || v === 'NoData') return null;
  const n = Number(v);
  // SLGA uses large negative sentinels (e.g. -9999) for no-data.
  return Number.isFinite(n) && n > -1000 ? n : null;
}

function depthLabelFor(upper, lower) {
  return `${Math.round(upper)}-${Math.round(lower)} cm`;
}

// Parse the ASRIS Drill response into our attribute x depth grid.
function buildSoilAttributes(raw) {
  const grid = {};
  SLGA.attributes.forEach((attr) => {
    grid[attr.key] = {};
    SLGA.depths.forEach((d) => { grid[attr.key][d.label] = null; });
  });

  const list = (raw && Array.isArray(raw.SoilAttributes)) ? raw.SoilAttributes : [];
  let matched = 0;
  list.forEach((entry) => {
    const name = entry['<attributeName>k__BackingField'] ?? entry.attributeName ?? entry.Name;
    const code = name && DRILL_ATTR_MAP[String(name).toUpperCase()];
    if (!code || !grid[code]) return;
    (entry.SoilLayers || entry.soilLayers || []).forEach((ly) => {
      const label = depthLabelFor(ly.upperDepth, ly.lowerDepth);
      if (label in grid[code]) {
        const v = cleanValue(ly.value);
        if (v !== null) { grid[code][label] = v; matched++; }
      }
    });
  });

  const attributes = SLGA.attributes.map((attr) => ({
    key: attr.key, label: attr.label, unit: attr.unit,
    depths: SLGA.depths.map((d) => ({ label: d.label, value: grid[attr.key][d.label] }))
  }));
  return { attributes, matched, received: list.length };
}

async function getSoilReport([lng, lat]) {
  const url = new URL('https://www.asris.csiro.au/ASRISApi/api/SLGA/simple/Drill');
  url.searchParams.set('longitude', lng);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('layers', 'ALL');
  url.searchParams.set('kernal', '0');
  url.searchParams.set('json', 'true');

  let raw = null, error = null;
  try {
    raw = await fetchJson(url);
  } catch (err) {
    error = err.message;
  }

  const { attributes, matched, received } = buildSoilAttributes(raw);
  // Got a response but couldn't map any values -> flag it so we can see the shape.
  if (!error && received > 0 && matched === 0) {
    const sample = Array.isArray(raw) ? raw[0] : raw;
    error = `Received soil data but could not read it (got ${received} entries). One entry: ${JSON.stringify(sample).slice(0, 700)}`;
  } else if (!error && received === 0) {
    error = 'Soil service returned no readable data for this location.';
  }

  return { attributes, error };
}

// Pick a handful of points spread across the drawn area (not just the
// centroid) so large/irregular polygons get an averaged soil reading rather
// than a single spot value. Centroid + up to an 8-point grid inside the
// polygon, capped to keep the number of Drill API calls small.
const MAX_SOIL_SAMPLE_POINTS = 9;

function getSamplePoints(polygon, bbox, centroid) {
  const points = [centroid];
  const [minX, minY, maxX, maxY] = bbox;
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return points;

  const steps = 3; // 3x3 grid -> up to 4 interior points beyond the centroid/edges
  for (let i = 1; i < steps && points.length < MAX_SOIL_SAMPLE_POINTS; i++) {
    for (let j = 1; j < steps && points.length < MAX_SOIL_SAMPLE_POINTS; j++) {
      const lng = minX + (width * i) / steps;
      const lat = minY + (height * j) / steps;
      try {
        if (turf.booleanPointInPolygon(turf.point([lng, lat]), polygon)) {
          points.push([lng, lat]);
        }
      } catch (err) { /* skip unusable point */ }
    }
  }
  return points;
}

function average(values) {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

// Run async tasks with limited concurrency so we don't fire every sample
// point at the CSIRO Drill API at once - hammering it with too many parallel
// requests makes individual calls slow enough to hit our fetch timeout.
async function runLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Sample several points across the area and average each attribute/depth,
// instead of reporting a single centroid value.
async function getSoilReportForArea(polygon, centroid) {
  const samplePoints = getSamplePoints(polygon, turf.bbox(polygon), centroid);
  const results = await runLimited(samplePoints, 3, (pt) => getSoilReport(pt));
  const successCount = results.filter((r) => !r.error).length;

  const attributes = SLGA.attributes.map((attr, ai) => ({
    key: attr.key,
    label: attr.label,
    unit: attr.unit,
    depths: SLGA.depths.map((d, di) => ({
      label: d.label,
      value: average(results.map((r) => r.attributes[ai].depths[di].value).filter((v) => v != null))
    }))
  }));

  const error = successCount === 0
    ? (results.find((r) => r.error)?.error || 'Soil service unavailable for this area.')
    : null;

  return {
    source: 'CSIRO/TERN Soil and Landscape Grid of Australia (SLGA) — ASRIS point Drill',
    sourceUrl: 'https://esoil.io/TERNLandscapes/Public/Pages/SLGA/index.html',
    resolution: successCount > 1
      ? `~90 m grid, averaged across ${successCount} sample points spread across the drawn area`
      : '~90 m grid, sampled at the area centroid (point sample, not an area average)',
    sampleCount: successCount,
    attributes,
    error
  };
}

// ---- Administrative boundaries (ABS ASGS) ----------------------------------

function pickName(attrs, fieldPrefix) {
  // Prefer the field that matches this layer (e.g. lga_name_2021 for the LGA
  // layer), then fall back to a code field, then any *_name_<year> field. ASGS
  // SA1 has no name field, so it falls back to sa1_code_2021.
  const byLayer = fieldPrefix && (attrs[`${fieldPrefix}_name_2021`] || attrs[`${fieldPrefix}_code_2021`]);
  if (byLayer) return byLayer;
  const candidate = Object.keys(attrs).find((k) => /_name_\d{4}$/i.test(k));
  return candidate ? attrs[candidate] : JSON.stringify(attrs);
}

const MAX_NAMES_SHOWN = 12;

async function queryAdminLayer(layer, polygon) {
  // Use the polygon's bounding box (4 numbers) rather than the full outline.
  // A drawn polygon has hundreds of vertices; sending that as the query
  // geometry makes a very long request URL that breaks when routed through the
  // local proxy. The bbox keeps the URL tiny. It can slightly over-select at
  // the corners, but for "which council/suburb does this area touch" that's an
  // acceptable trade for reliability.
  const [minX, minY, maxX, maxY] = turf.bbox(polygon);
  const url = new URL(`${ABS_ASGS.base}/${layer.service}/query`);
  url.searchParams.set('geometry', `${minX},${minY},${maxX},${maxY}`);
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  // SA1 is so fine-grained that a large area returns hundreds of features. We
  // only display it as a count, so ask the server for just the count - a tiny
  // response that's fast and safe to route through a CORS proxy.
  if (layer.id === 'sa1') {
    url.searchParams.set('returnCountOnly', 'true');
    const json = await fetchEsriJson(url);
    if (json.error) throw new Error(json.error.message || 'ArcGIS error');
    return { names: null, count: json.count ?? 0 };
  }

  url.searchParams.set('outFields', '*');
  const json = await fetchEsriJson(url);
  if (json.error) throw new Error(json.error.message || 'ArcGIS error');
  const names = (json.features || []).map((f) => pickName(f.attributes, layer.fieldPrefix || layer.id));
  return { names, count: names.length };
}

async function getAdminReport(polygon) {
  const boundaries = await Promise.all(
    ABS_ASGS.layers.map(async (layer) => {
      try {
        const { names, count } = await queryAdminLayer(layer, polygon);
        if (names === null) {
          return { id: layer.id, name: layer.name, matches: [], totalMatches: count, error: null };
        }
        // Dedupe and cap the named layers so the report stays readable.
        const allNames = [...new Set(names)].sort();
        const matches = allNames.slice(0, MAX_NAMES_SHOWN);
        return { id: layer.id, name: layer.name, matches, totalMatches: allNames.length, error: null };
      } catch (err) {
        return { id: layer.id, name: layer.name, matches: [], totalMatches: 0, error: err.message };
      }
    })
  );

  return {
    source: 'Australian Bureau of Statistics - Australian Statistical Geography Standard (ASGS) digital boundaries',
    sourceUrl: 'https://geo.abs.gov.au/',
    boundaries
  };
}

// ---- Planning / land-use (ABARES CLUM) -------------------------------------

async function getFeatureInfo([lng, lat]) {
  const delta = 0.001;
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join(',');

  const url = new URL(ABARES_LANDUSE.wmsBase);
  url.searchParams.set('service', 'WMS');
  url.searchParams.set('version', '1.1.1');
  url.searchParams.set('request', 'GetFeatureInfo');
  url.searchParams.set('layers', ABARES_LANDUSE.layer);
  url.searchParams.set('query_layers', ABARES_LANDUSE.layer);
  url.searchParams.set('bbox', bbox);
  url.searchParams.set('srs', 'EPSG:4326');
  url.searchParams.set('width', '3');
  url.searchParams.set('height', '3');
  url.searchParams.set('x', '1');
  url.searchParams.set('y', '1');
  url.searchParams.set('info_format', 'application/json');
  url.searchParams.set('feature_count', '1');

  const json = await fetchJson(url);
  return json?.features?.[0]?.properties ?? null;
}

async function getPlanningReport(centroid) {
  const base = {
    source: 'ABARES Catchment Scale Land Use of Australia (CLUM)',
    sourceUrl: 'https://www.agriculture.gov.au/abares/aclump/land-use/data-download',
    note: 'National land use is provided as a general planning/land-use baseline. Check your state/local planning scheme for zoning specifics not covered by a national API.'
  };
  try {
    const landUse = await getFeatureInfo(centroid);
    return { ...base, landUse, error: null };
  } catch (err) {
    return { ...base, landUse: null, error: err.message };
  }
}

// ---- Location summary (OSM Nominatim) --------------------------------------

async function reverseGeocode([lng, lat]) {
  const url = new URL(NOMINATIM.reverseUrl);
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('format', 'json');
  try {
    const json = await fetchJson(url);
    return { displayName: json.display_name ?? null, address: json.address ?? null, error: null };
  } catch (err) {
    return { displayName: null, address: null, error: err.message };
  }
}

// ---- Soil pits / sampling sites (public ArcGIS point services) -------------

// Query one Esri soil-site point layer for everything inside a bbox.
// bbox is [minLng, minLat, maxLng, maxLat].
async function querySoilSiteSource(source, bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  const url = new URL(source.queryUrl);
  url.searchParams.set('geometry', JSON.stringify({ xmin: minX, ymin: minY, xmax: maxX, ymax: maxY, spatialReference: { wkid: 4326 } }));
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('resultRecordCount', String(SOIL_SITES.maxPerSource));
  url.searchParams.set('f', 'json');

  const json = await fetchEsriJson(url);
  if (json.error) throw new Error(json.error.message || 'ArcGIS error');
  return (json.features || [])
    .map((f) => ({ lat: f.geometry?.y, lng: f.geometry?.x, attributes: f.attributes || {}, source: source.name }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

// Fetch soil-site points from every configured source inside a bbox. Each
// source fails independently so one outage never hides the rest.
async function getSoilSites(bbox) {
  const perSource = await Promise.all(
    SOIL_SITES.sources.map(async (s) => {
      try { return await querySoilSiteSource(s, bbox); }
      catch (err) { return []; }
    })
  );
  return perSource.flat();
}

// ---- Report aggregation -----------------------------------------------------

const MAX_AREA_HECTARES = 100000;

async function generateReport(area) {
  const { polygon, centroid, areaHectares, bbox } = normaliseArea(area);

  if (!Number.isFinite(areaHectares) || areaHectares <= 0) {
    throw new Error('Could not compute a valid area from the supplied geometry.');
  }
  if (areaHectares > MAX_AREA_HECTARES) {
    throw new Error(`Area too large (${areaHectares.toFixed(0)} ha). Please draw a smaller area (max ${MAX_AREA_HECTARES} ha).`);
  }

  const [location, soil, admin, planning, sitesInBbox] = await Promise.all([
    reverseGeocode(centroid),
    getSoilReportForArea(polygon, centroid),
    getAdminReport(polygon),
    getPlanningReport(centroid),
    getSoilSites(bbox).catch(() => [])
  ]);

  // Keep only the soil pits that actually fall inside the drawn area.
  const sites = sitesInBbox.filter((s) => {
    try { return turf.booleanPointInPolygon(turf.point([s.lng, s.lat]), polygon); }
    catch (err) { return false; }
  });

  return {
    generatedAt: new Date().toISOString(),
    area: { type: area.type, centroid, bbox, areaHectares: Math.round(areaHectares * 100) / 100 },
    location,
    soil,
    admin,
    planning,
    sites
  };
}
