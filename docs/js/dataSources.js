// Public/open data source endpoints used by the reporting tool (browser version).
// Mirrors server/config/dataSources.js — see that file's comments for source details.

const SLGA = {
  restBase: 'https://www.asris.csiro.au/arcgis/rest/services/TERN/{COVERAGE}/MapServer',
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

const ABS_ASGS = {
  base: 'https://geo.abs.gov.au/arcgis/rest/services',
  layers: [
    { id: 'state', name: 'State / Territory', service: 'ASGS2021/STE/MapServer/0' },
    { id: 'lga', name: 'Local Government Area', service: 'ASGS2021/LGA/MapServer/0' },
    { id: 'sa2', name: 'Statistical Area Level 2 (SA2)', service: 'ASGS2021/SA2/MapServer/0' },
    { id: 'sa1', name: 'Statistical Area Level 1 (SA1)', service: 'ASGS2021/SA1/MapServer/0' },
    { id: 'locality', name: 'Suburb / Locality', service: 'ASGS2021/LOCALITY/MapServer/0' }
  ]
};

const ABARES_LANDUSE = {
  wmsBase: 'https://www.agriculture.gov.au/abares/aclump/geoserver/wms',
  layer: 'aclump:clum_50m_2023'
};

const NOMINATIM = {
  reverseUrl: 'https://nominatim.openstreetmap.org/reverse'
};
