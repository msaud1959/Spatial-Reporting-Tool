import express from 'express';
import { normaliseArea } from '../utils/geometry.js';
import { getSoilReport } from '../services/soilService.js';
import { getAdminReport } from '../services/adminService.js';
import { getPlanningReport } from '../services/planningService.js';
import { reverseGeocode } from '../services/geocodeService.js';

const router = express.Router();

const MAX_AREA_HECTARES = 100000; // sanity cap to avoid runaway queries over huge areas

router.post('/report', async (req, res) => {
  try {
    const area = req.body;
    if (!area || (area.type !== 'polygon' && area.type !== 'point')) {
      return res.status(400).json({ error: 'Body must be { type: "polygon", geojson } or { type: "point", center, radiusMeters }' });
    }

    const { polygon, centroid, areaHectares, bbox } = normaliseArea(area);

    if (!Number.isFinite(areaHectares) || areaHectares <= 0) {
      return res.status(400).json({ error: 'Could not compute a valid area from the supplied geometry.' });
    }
    if (areaHectares > MAX_AREA_HECTARES) {
      return res.status(400).json({ error: `Area too large (${areaHectares.toFixed(0)} ha). Please draw a smaller area (max ${MAX_AREA_HECTARES} ha).` });
    }

    const [location, soil, admin, planning] = await Promise.all([
      reverseGeocode(centroid),
      getSoilReport(centroid),
      getAdminReport(polygon),
      getPlanningReport(centroid)
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      area: {
        type: area.type,
        centroid,
        bbox,
        areaHectares: Math.round(areaHectares * 100) / 100
      },
      location,
      soil,
      admin,
      planning
    });
  } catch (err) {
    console.error('Report generation failed:', err);
    res.status(500).json({ error: err.message || 'Report generation failed.' });
  }
});

export default router;
