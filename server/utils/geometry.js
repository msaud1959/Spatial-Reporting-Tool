import * as turf from '@turf/turf';

// Accepts either:
//   { type: 'polygon', geojson: <GeoJSON Polygon> }
//   { type: 'point', center: [lng, lat], radiusMeters: number }
// and returns a normalised { polygon, centroid, areaHectares } shape used by all
// downstream report services.
export function normaliseArea(area) {
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
