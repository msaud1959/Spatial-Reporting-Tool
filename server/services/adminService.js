import { ABS_ASGS } from '../config/dataSources.js';

const FETCH_TIMEOUT_MS = 10000;

async function queryLayer(layer, polygonGeoJSON) {
  const url = new URL(`${ABS_ASGS.base}/${layer.service}/query`);
  url.searchParams.set('geometry', JSON.stringify(toEsriPolygon(polygonGeoJSON)));
  url.searchParams.set('geometryType', 'esriGeometryPolygon');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  // SA1 is only displayed as a count, and a large area returns hundreds of
  // features - so ask the server for just the count.
  const countOnly = layer.id === 'sa1';
  if (countOnly) url.searchParams.set('returnCountOnly', 'true');
  else url.searchParams.set('outFields', '*');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'ArcGIS error');
    if (countOnly) return { names: null, count: json.count ?? 0 };
    const names = (json.features || []).map((f) => pickName(f.attributes, layer.id));
    return { names, count: names.length };
  } finally {
    clearTimeout(timeout);
  }
}

function toEsriPolygon(geojsonPolygon) {
  const coords = geojsonPolygon.geometry.coordinates;
  return { rings: coords, spatialReference: { wkid: 4326 } };
}

function pickName(attrs, layerId) {
  // Prefer the field that matches this layer (e.g. lga_name_2021 for the LGA
  // layer), then a code field, then any *_name field. ASGS SA1 has no name
  // field, so it falls back to sa1_code_2021.
  const byLayer = layerId && (attrs[`${layerId}_name_2021`] || attrs[`${layerId}_code_2021`]);
  if (byLayer) return byLayer;
  const candidate = Object.keys(attrs).find((k) => /name$/i.test(k));
  return candidate ? attrs[candidate] : JSON.stringify(attrs);
}

const MAX_NAMES_SHOWN = 12;

// Returns the administrative boundaries (state, LGA, SA2, SA1, locality) that
// intersect the drawn polygon.
export async function getAdminReport(polygon) {
  const results = await Promise.all(
    ABS_ASGS.layers.map(async (layer) => {
      try {
        const { names, count } = await queryLayer(layer, polygon);
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
    boundaries: results
  };
}
