# Spatial Reporting Tool

Draw a polygon or place a point with a buffer radius on a map of Australia, then
generate a report combining public **soil**, **administrative**, and
**planning/land-use** data for that area.

Inspired by the [Visualising Australasia's Soils (VAS)](https://vas.soilcrc.com.au/map)
portal, but built around a draw-an-area → generate-a-report workflow using
nationally available open data APIs rather than VAS's own (non-public) dataset.

## Live hosted version (no install needed)

The `docs/` folder is a fully client-side build (same UI, calls the public APIs
directly from the browser — no backend, no secrets involved). Enable it via
**GitHub Pages**:

Settings → Pages → Source: *Deploy from a branch* → Branch: `claude/festive-goldberg-skgax3` (or `main` once merged), folder **/docs** → Save.

GitHub will publish it at `https://msaud1959.github.io/Spatial-Reporting-Tool/`
within a minute or two. No Node, no npm, nothing to install.

## Stack

Two equivalent UIs are kept in sync:

- **`docs/`** — pure static site (HTML/CSS/JS), calls all public APIs directly
  from the browser. Use this for GitHub Pages.
- **`public/` + `server/`** — same UI, but data calls are proxied through a
  small Node/Express backend. Use this if you'd rather run it locally with
  `npm start` or want a place to add server-side logic (caching, auth, a
  state-specific planning API, etc.) later.

Both use Leaflet + Leaflet.draw for the map/drawing tools and Turf.js for
geometry (centroid, area, point-buffer circles).

## Data sources

| Report section | Source | Access method |
|---|---|---|
| Soil properties | [CSIRO/TERN Soil and Landscape Grid of Australia (SLGA)](https://esoil.io/TERNLandscapes/Public/Pages/SLGA/index.html) — clay, silt, sand, pH, organic carbon, available water capacity, bulk density, nitrogen, at 6 standard depths (0-5cm to 100-200cm) | ASRIS SLGA point "Drill" API, queried at up to 9 points spread across the drawn area (centroid + an interior grid clipped to the polygon) and averaged per attribute/depth — falls back to a single centroid sample for very small areas |
| Administrative boundaries | [ABS Australian Statistical Geography Standard (ASGS)](https://geo.abs.gov.au/) — State, LGA, SA2, SA1, Suburb/Locality | ArcGIS REST FeatureServer spatial query (`intersects` the drawn polygon) |
| Planning / land-use | [ABARES Catchment Scale Land Use of Australia (CLUM)](https://www.agriculture.gov.au/abares/aclump/land-use/data-download) | WMS `GetFeatureInfo` at the area centroid |
| Location summary | [OpenStreetMap Nominatim](https://nominatim.org/) | Reverse geocoding at the centroid |
| Soil pits / sampling sites (map points + report) | Openly accessible government soil-site point services (e.g. [Queensland Soils and Land Resource](https://spatial-gis.information.qld.gov.au/arcgis/rest/services/GeoscientificInformation/SoilsAndLandResource/MapServer)) | ArcGIS REST envelope query for the current map view; points falling inside the drawn area are listed in the report |

### A note on soil pits and Visualising Australasia's Soils (VAS)

VAS displays soil observation points that are federated — via [ANSIS](https://ansis.net/) and the
[TERN Soil Data Federator](https://esoil.io/TERNLandscapes/Public/Pages/SoilDataFederator/SoilDataFederator.html) —
from CSIRO's **NatSoil** national soil-site database (~40,000 sites). Those national
services require a **free login / API key** to return the actual point data, which a
keyless, fully-static GitHub Pages site cannot use. So the "Soil pits" map layer here
uses the **openly accessible (no-login)** government soil-site point services instead.
Add more sources to `SOIL_SITES.sources` in `docs/js/dataSources.js` to extend coverage,
or wire in an ANSIS/Federator key if you deploy a small backend that can hold it securely.

Australia has no single national zoning/planning API — each state and ~550 local
councils publish their own planning scheme — so CLUM land-use is used as a
consistent national baseline. `server/config/dataSources.js` is the place to plug
in a state-specific planning WFS/REST endpoint if you need exact zoning for one
jurisdiction.

## Running it locally (Node version)

```bash
npm install
npm start
```

Then open http://localhost:3000.

1. Choose **Draw Polygon** (use the polygon tool in the map's top-left corner) or
   **Point + Buffer** (click the map to place a centre point, drag the radius slider).
2. Click **Generate Report**.
3. Use **Print / Save PDF** to export the report.

## API (Node version only)

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
