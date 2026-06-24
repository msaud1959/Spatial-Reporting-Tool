// Public/open data source endpoints used by the reporting tool.
// All sources are free, publicly accessible Australian government / research datasets.
// Endpoints are centralised here so they can be swapped or extended (e.g. adding a
// state-specific planning WFS) without touching service logic.

export const SLGA = {
  // CSIRO/TERN "Soil and Landscape Grid of Australia" - national 90m soil attribute
  // rasters, served from an ArcGIS Server instance. Each coverage is exposed both as
  // OGC WCS and as a standard ArcGIS REST MapServer - we use the REST "identify"
  // operation since it returns pixel values as plain JSON (no raster decoding needed).
  // Reference: https://esoil.io/TERNLandscapes/Public/Pages/SLGA/GetData.html
  restBase: 'https://www.asris.csiro.au/arcgis/rest/services/TERN/{COVERAGE}/MapServer',
  // Each attribute has 6 depth-specific coverages (the "_1".."_6" suffix = depth slice).
  depths: [
    { id: 1, label: '0-5 cm' },
    { id: 2, label: '5-15 cm' },
    { id: 3, label: '15-30 cm' },
    { id: 4, label: '30-60 cm' },
    { id: 5, label: '60-100 cm' },
    { id: 6, label: '100-200 cm' }
  ],
  attributes: [
    { key: 'CLY', label: 'Clay content', unit: '%', coverage: 'CLY_ACLEP_AU_NAT_C' },
    { key: 'SLT', label: 'Silt content', unit: '%', coverage: 'SLT_ACLEP_AU_NAT_C' },
    { key: 'SND', label: 'Sand content', unit: '%', coverage: 'SND_ACLEP_AU_NAT_C' },
    { key: 'PHW', label: 'pH (water)', unit: 'pH', coverage: 'PHW_ACLEP_AU_NAT_C' },
    { key: 'SOC', label: 'Organic carbon', unit: '%', coverage: 'SOC_ACLEP_AU_NAT_C' },
    { key: 'AWC', label: 'Available water capacity', unit: 'mm/mm', coverage: 'AWC_ACLEP_AU_NAT_C' },
    { key: 'BDW', label: 'Bulk density (whole earth)', unit: 'g/cm3', coverage: 'BDW_ACLEP_AU_NAT_C' },
    { key: 'NTO', label: 'Total nitrogen', unit: '%', coverage: 'NTO_ACLEP_AU_NAT_C' }
  ]
};

export const ABS_ASGS = {
  // ABS Australian Statistical Geography Standard digital boundaries, served via
  // ArcGIS REST FeatureServer (geo.abs.gov.au). Used for administrative context.
  // Reference: https://geo.abs.gov.au/arcgis/rest/services
  base: 'https://geo.abs.gov.au/arcgis/rest/services',
  layers: [
    { id: 'state', name: 'State / Territory', service: 'ASGS2021/STE/MapServer/0' },
    { id: 'lga', name: 'Local Government Area', service: 'ASGS2021/LGA/MapServer/0' },
    { id: 'sa2', name: 'Statistical Area Level 2 (SA2)', service: 'ASGS2021/SA2/MapServer/0' },
    { id: 'sa1', name: 'Statistical Area Level 1 (SA1)', service: 'ASGS2021/SA1/MapServer/0' },
    { id: 'locality', name: 'Suburb / Locality', service: 'ASGS2021/LOCALITY/MapServer/0' }
  ]
};

export const ABARES_LANDUSE = {
  // ABARES Catchment Scale Land Use of Australia (CLUM) - national land use mapping,
  // a reasonable proxy for "planning context" given zoning data is fragmented across
  // ~550 individual council/state planning schemes with no single national API.
  // Reference: https://www.agriculture.gov.au/abares/aclump/land-use/data-download
  wmsBase: 'https://www.agriculture.gov.au/abares/aclump/geoserver/wms',
  layer: 'aclump:clum_50m_2023'
};

export const NOMINATIM = {
  // OpenStreetMap Nominatim - free reverse geocoding for a human-readable address
  // / place name at the area's centroid. Please respect the 1 req/sec usage policy.
  // Reference: https://nominatim.org/release-docs/develop/api/Reverse/
  reverseUrl: 'https://nominatim.openstreetmap.org/reverse'
};
