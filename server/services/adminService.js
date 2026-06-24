import { ABS_ASGS } from '../config/dataSources.js';

const FETCH_TIMEOUT_MS = 10000;

async function queryLayer(layer, polygonGeoJSON) {
  const url = new URL(`${ABS_ASGS.base}/${layer.service}/query`);
  url.searchParams.set('geometry', JSON.stringify(toEsriPolygon(polygonGeoJSON)));
  url.searchParams.set('geometryType', 'esriGeometryPolygon');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'ArcGIS error');
    return (json.features || []).map((f) => f.attributes);
  } finally {
    clearTimeout(timeout);
  }
}

function toEsriPolygon(geojsonPolygon) {
  const coords = geojsonPolygon.geometry.coordinates;
  return { rings: coords, spatialReference: { wkid: 4326 } };
}

function pickName(attrs) {
  const candidate = Object.keys(attrs).find((k) => /name$/i.test(k));
  return candidate ? attrs[candidate] : JSON.stringify(attrs);
}

// Returns the administrative boundaries (state, LGA, SA2, SA1, locality) that
// intersect the drawn polygon.
export async function getAdminReport(polygon) {
  const results = await Promise.all(
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
    boundaries: results
  };
}
