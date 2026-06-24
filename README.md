# Spatial Reporting Tool

Draw a polygon or place a point with a buffer radius on a map of Australia, then
generate a report combining public **soil**, **administrative**, and
**planning/land-use** data for that area.

Inspired by the [Visualising Australasia's Soils (VAS)](https://vas.soilcrc.com.au/map)
portal, but built around a draw-an-area → generate-a-report workflow using
nationally available open data APIs rather than VAS's own (non-public) dataset.

## Stack

- **Backend**: Node.js (Express) — aggregates data from public APIs per request.
- **Frontend**: Leaflet + Leaflet.draw (plain JS, no build step).
- **Geometry**: Turf.js, on both client (buffer preview) and server (centroid/area/clipping).

## Data sources

| Report section | Source | Access method |
|---|---|---|
| Soil properties | [CSIRO/TERN Soil and Landscape Grid of Australia (SLGA)](https://esoil.io/TERNLandscapes/Public/Pages/SLGA/index.html) — clay, silt, sand, pH, organic carbon, available water capacity, bulk density, nitrogen, at 6 standard depths (0-5cm to 100-200cm) | ArcGIS REST `identify` on the public SLGA MapServer, sampled at the area centroid |
| Administrative boundaries | [ABS Australian Statistical Geography Standard (ASGS)](https://geo.abs.gov.au/) — State, LGA, SA2, SA1, Suburb/Locality | ArcGIS REST FeatureServer spatial query (`intersects` the drawn polygon) |
| Planning / land-use | [ABARES Catchment Scale Land Use of Australia (CLUM)](https://www.agriculture.gov.au/abares/aclump/land-use/data-download) | WMS `GetFeatureInfo` at the area centroid |
| Location summary | [OpenStreetMap Nominatim](https://nominatim.org/) | Reverse geocoding at the centroid |

Australia has no single national zoning/planning API — each state and ~550 local
councils publish their own planning scheme — so CLUM land-use is used as a
consistent national baseline. `server/config/dataSources.js` is the place to plug
in a state-specific planning WFS/REST endpoint if you need exact zoning for one
jurisdiction.

## Running it

```bash
npm install
npm start
```

Then open http://localhost:3000.

1. Choose **Draw Polygon** (use the polygon tool in the map's top-left corner) or
   **Point + Buffer** (click the map to place a centre point, drag the radius slider).
2. Click **Generate Report**.
3. Use **Print / Save PDF** to export the report.

## API

`POST /api/report`

Body — one of:
```json
{ "type": "polygon", "geojson": { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [...] } } }
{ "type": "point", "center": [lng, lat], "radiusMeters": 500 }
```

Returns combined JSON with `location`, `soil`, `admin`, and `planning` sections.
Areas are capped at 100,000 ha to keep external API calls bounded. Each data
source fails independently — if one upstream service is unreachable, its section
reports an `error` field while the rest of the report still renders.

## Known limitation from this development environment

This tool was built in a network-restricted sandbox that blocks outbound calls to
the government/research domains used above (CSIRO/TERN, ABS, ABARES, OSM), so the
live API responses could not be verified end-to-end here — only the request
pipeline, geometry handling, and per-source error isolation were tested (confirmed
working, with each section correctly reporting connection errors instead of
crashing the report). Endpoint shapes were taken from each provider's published
documentation; run it from a normal internet connection and check the browser
console / server logs if any single source needs a URL adjustment — they're all
isolated in `server/config/dataSources.js`.
