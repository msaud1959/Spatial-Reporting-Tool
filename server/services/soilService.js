import { SLGA } from '../config/dataSources.js';

const FETCH_TIMEOUT_MS = 10000;

async function identifyPixel(coverage, [lng, lat]) {
  const base = SLGA.restBase.replace('{COVERAGE}', coverage);
  const url = new URL(`${base}/identify`);
  url.searchParams.set('geometry', JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('sr', '4326');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const value = json?.value ?? json?.results?.[0]?.attributes?.['Pixel Value'];
    const parsed = value === undefined || value === 'NoData' ? null : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } finally {
    clearTimeout(timeout);
  }
}

// Fetches each soil attribute at the area centroid, for every depth slice.
// Returns: [{ key, label, unit, depths: [{ label, value }] }]
export async function getSoilReport(centroid) {
  const results = await Promise.all(
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
    attributes: results
  };
}
