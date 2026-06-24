// Client-side data services: calls each public API directly from the browser
// (no backend needed). Each function fails independently and returns an
// `error` field instead of throwing, so one unreachable source never breaks
// the whole report.

const FETCH_TIMEOUT_MS = 12000;

// Some of the government data servers don't send CORS headers, so a browser
// running on github.io is blocked from reading their responses ("Failed to
// fetch"). To keep the static site working without a backend, we try the API
// directly first (fast path when CORS is allowed), then fall back to public
// CORS proxies that re-serve the response with permissive headers.
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
  try {
    return await jsonpFetch(url);
  } catch (err) {
    return fetchJson(url);
  }
}

async function fetchJson(url, options = {}) {
  const direct = String(url);
  const targets = [direct, ...CORS_PROXIES.map((p) => p(direct))];
  let lastErr;
  for (const target of targets) {
    try {
      const res = await timedFetch(target, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

// ---- Soil (CSIRO/TERN SLGA) -------------------------------------------------

async function identifyPixel(coverage, [lng, lat]) {
  const base = SLGA.restBase.replace('{COVERAGE}', coverage);
  const url = new URL(`${base}/identify`);
  url.searchParams.set('geometry', JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('sr', '4326');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  const json = await fetchEsriJson(url);
  const value = json?.value ?? json?.results?.[0]?.attributes?.['Pixel Value'];
  const parsed = value === undefined || value === 'NoData' ? null : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getSoilReport(centroid) {
  const attributes = await Promise.all(
    SLGA.attributes.map(async (attr) => {
      const depths = await Promise.all(
        SLGA.depths.map(async (depth) => {
          const coverage = `${attr.coverage}_${depth.id}`;
          try {
            const value = await identifyPixel(coverage, centroid);
            return { label: depth.label, value };
          } catch (err) {
            return { label: depth.label, value: null, error: err.message };
          }
        })
      );
      return { key: attr.key, label: attr.label, unit: attr.unit, depths };
    })
  );

  return {
    source: 'CSIRO/TERN Soil and Landscape Grid of Australia (SLGA)',
    sourceUrl: 'https://esoil.io/TERNLandscapes/Public/Pages/SLGA/index.html',
    resolution: '~90 m grid cell at the area centroid (point sample, not an area average)',
    attributes
  };
}

// ---- Administrative boundaries (ABS ASGS) ----------------------------------

function toEsriPolygon(polygonFeature) {
  return { rings: polygonFeature.geometry.coordinates, spatialReference: { wkid: 4326 } };
}

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
  const url = new URL(`${ABS_ASGS.base}/${layer.service}/query`);
  url.searchParams.set('geometry', JSON.stringify(toEsriPolygon(polygon)));
  url.searchParams.set('geometryType', 'esriGeometryPolygon');
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

  const [location, soil, admin, planning] = await Promise.all([
    reverseGeocode(centroid),
    getSoilReport(centroid),
    getAdminReport(polygon),
    getPlanningReport(centroid)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    area: { type: area.type, centroid, bbox, areaHectares: Math.round(areaHectares * 100) / 100 },
    location,
    soil,
    admin,
    planning
  };
}
