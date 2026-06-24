import { ABARES_LANDUSE } from '../config/dataSources.js';

const FETCH_TIMEOUT_MS = 10000;

// WMS GetFeatureInfo at the centroid, using a tiny 3x3 pixel bbox around the point
// so the request works regardless of the layer's native pixel size.
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.features?.[0]?.properties ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

// National land-use mapping is used as a proxy for "planning context": Australia
// has no single national zoning API (each of the ~550 councils/states publishes
// its own planning scheme), so this gives a consistent national baseline that can
// be supplemented with a state-specific planning WFS where one is configured.
export async function getPlanningReport(centroid) {
  try {
    const properties = await getFeatureInfo(centroid);
    return {
      source: 'ABARES Catchment Scale Land Use of Australia (CLUM)',
      sourceUrl: 'https://www.agriculture.gov.au/abares/aclump/land-use/data-download',
      note: 'National land use is provided as a general planning/land-use baseline. Check your state/local planning scheme for zoning specifics not covered by a national API.',
      landUse: properties,
      error: null
    };
  } catch (err) {
    return {
      source: 'ABARES Catchment Scale Land Use of Australia (CLUM)',
      sourceUrl: 'https://www.agriculture.gov.au/abares/aclump/land-use/data-download',
      note: 'National land use is provided as a general planning/land-use baseline. Check your state/local planning scheme for zoning specifics not covered by a national API.',
      landUse: null,
      error: err.message
    };
  }
}
