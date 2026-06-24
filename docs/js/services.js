// Client-side data services: calls each public API directly from the browser
// (no backend needed). Each function fails independently and returns an
// `error` field instead of throwing, so one unreachable source never breaks
// the whole report.

const FETCH_TIMEOUT_MS = 10000;

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
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

  const json = await fetchJson(url);
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

function pickName(attrs) {
  const candidate = Object.keys(attrs).find((k) => /name$/i.test(k));
  return candidate ? attrs[candidate] : JSON.stringify(attrs);
}

async function queryLayer(layer, polygon) {
  const url = new URL(`${ABS_ASGS.base}/${layer.service}/query`);
  url.searchParams.set('geometry', JSON.stringify(toEsriPolygon(polygon)));
  url.searchParams.set('geometryType', 'esriGeometryPolygon');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  const json = await fetchJson(url);
  if (json.error) throw new Error(json.error.message || 'ArcGIS error');
  return (json.features || []).map((f) => f.attributes);
}

async function getAdminReport(polygon) {
  const boundaries = await Promise.all(
    ABS_ASGS.layers.map(async (layer) => {
      try {
        const features = await queryLayer(layer, polygon);
        return { id: layer.id, name: layer.name, matches: features.map(pickName), error: null };
      } catch (err) {
        return { id: layer.id, name: layer.name, matches: [], error: err.message };
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
