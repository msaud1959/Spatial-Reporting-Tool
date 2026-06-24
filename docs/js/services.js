// Client-side data services: calls each public API directly from the browser
// (no backend needed). Each function fails independently and returns an
// `error` field instead of throwing, so one unreachable source never breaks
// the whole report.

const FETCH_TIMEOUT_MS = 12000;

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
const CORS_PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`
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

async function timedFetch(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
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
    ? [localProxy(direct), direct]
    : [direct, ...CORS_PROXIES.map((p) => p(direct))];
  let lastErr;
  for (const target of targets) {
    try {
      const res = await timedFetch(target, options);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const t = await res.text(); if (t) detail += `: ${t.slice(0, 200)}`; } catch (e) { /* ignore */ }
        throw new Error(detail);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      // Try the next fallback on network/CORS failures; keep looping otherwise.
    }
  }
  throw lastErr || new Error('Request failed');
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

// Match an SLGA attribute code from a free-text layer name.
const ATTR_KEYWORDS = [
  { key: 'CLY', re: /\bclay\b/i },
  { key: 'SLT', re: /\bsilt\b/i },
  { key: 'SND', re: /\bsand\b/i },
  { key: 'PHW', re: /\bph\b|p\.?h\.?\s*\(?water|soil\s*ph/i },
  { key: 'SOC', re: /organic\s*carbon|\bsoc\b|\borganic\b/i },
  { key: 'AWC', re: /available\s*water|water\s*capacity|\bawc\b/i },
  { key: 'BDW', re: /bulk\s*dens|\bbdw?\b|density/i },
  { key: 'NTO', re: /nitrogen|\bnto?\b/i }
];

// Match a standard SLGA depth label from a free-text name (handles "0-5cm",
// "0 to 5 cm", "000_005", etc).
const DEPTH_PATTERNS = [
  { label: '0-5 cm', re: /\b0+\D*0*5\b|0-5|000[_-]?005/ },
  { label: '5-15 cm', re: /\b0*5\D*15\b|5-15|005[_-]?015/ },
  { label: '15-30 cm', re: /\b15\D*30\b|15-30|015[_-]?030/ },
  { label: '30-60 cm', re: /\b30\D*60\b|30-60|030[_-]?060/ },
  { label: '60-100 cm', re: /\b60\D*100\b|60-100|060[_-]?100/ },
  { label: '100-200 cm', re: /\b100\D*200\b|100-200/ }
];

function matchAttr(name) {
  const hit = ATTR_KEYWORDS.find((a) => a.re.test(name));
  return hit ? hit.key : null;
}
function matchDepth(name) {
  const hit = DEPTH_PATTERNS.find((d) => d.re.test(name));
  return hit ? hit.label : null;
}

function cleanValue(v) {
  if (v === null || v === undefined || v === '' || v === 'NoData') return null;
  const n = Number(v);
  // SLGA uses large negative sentinels for no-data.
  return Number.isFinite(n) && n > -1000 ? n : null;
}

// Walk the (variably-shaped) Drill response and pull out every {name, value}
// pair so we can match them to attributes/depths regardless of nesting.
function flattenDrill(node, nameHint, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((item) => flattenDrill(item, nameHint, out));
    return;
  }
  if (typeof node === 'object') {
    const name = node.Name || node.name || node.Layer || node.layer ||
                 node.Title || node.title || node.Attribute || nameHint;
    const rawVal = node.Value ?? node.value ?? node.PixelValue ?? node.pixelValue ?? node.Result;
    if (name && (rawVal !== undefined)) out.push({ name: String(name), value: rawVal });
    // Recurse into nested arrays/objects (e.g. a layer with a Depths array).
    Object.entries(node).forEach(([k, v]) => {
      if (v && typeof v === 'object') flattenDrill(v, node.Name || node.name || nameHint || k, out);
    });
  }
}

function buildSoilAttributes(raw) {
  const flat = [];
  flattenDrill(raw, null, flat);

  // Seed the full attribute x depth grid (so the report layout is stable).
  const grid = {};
  SLGA.attributes.forEach((attr) => {
    grid[attr.key] = {};
    SLGA.depths.forEach((d) => { grid[attr.key][d.label] = null; });
  });

  let matched = 0;
  flat.forEach(({ name, value }) => {
    const key = matchAttr(name);
    const depth = matchDepth(name);
    if (key && depth && grid[key] && depth in grid[key]) {
      const v = cleanValue(value);
      if (v !== null) { grid[key][depth] = v; matched++; }
    }
  });

  const attributes = SLGA.attributes.map((attr) => ({
    key: attr.key, label: attr.label, unit: attr.unit,
    depths: SLGA.depths.map((d) => ({ label: d.label, value: grid[attr.key][d.label] }))
  }));
  return { attributes, matched, received: flat.length };
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

  return {
    source: 'CSIRO/TERN Soil and Landscape Grid of Australia (SLGA) — ASRIS point Drill',
    sourceUrl: 'https://esoil.io/TERNLandscapes/Public/Pages/SLGA/index.html',
    resolution: '~90 m grid, sampled at the area centroid (point sample, not an area average)',
    attributes,
    error
  };
}

// ---- Administrative boundaries (ABS ASGS) ----------------------------------

function pickName(attrs, layerId) {
  // Prefer the field that matches this layer (e.g. lga_name_2021 for the LGA
  // layer), then fall back to a code field, then any *_name field. ASGS SA1 has
  // no name field, so it falls back to sa1_code_2021.
  const byLayer = layerId && (attrs[`${layerId}_name_2021`] || attrs[`${layerId}_code_2021`]);
  if (byLayer) return byLayer;
  const candidate = Object.keys(attrs).find((k) => /name$/i.test(k));
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
  const names = (json.features || []).map((f) => pickName(f.attributes, layer.id));
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
    getSoilReport(centroid),
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
