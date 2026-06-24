// Map setup, polygon drawing and point+buffer tool.
const SpatialMap = (() => {
  const map = L.map('map').setView([-37.8136, 144.9631], 7); // default: Victoria, Australia

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  const drawnItems = new L.FeatureGroup().addTo(map);

  const drawControl = new L.Control.Draw({
    draw: {
      polygon: { allowIntersection: false, showArea: true },
      polyline: false,
      circle: false,
      circlemarker: false,
      marker: false,
      rectangle: false
    },
    edit: { featureGroup: drawnItems, remove: false }
  });
  map.addControl(drawControl);

  let mode = 'polygon';
  let currentArea = null; // { type: 'polygon', geojson } | { type: 'point', center, radiusMeters }
  let pointMarker = null;
  let pointCircle = null;
  let radiusMeters = 500;

  function clear() {
    drawnItems.clearLayers();
    if (pointMarker) map.removeLayer(pointMarker);
    if (pointCircle) map.removeLayer(pointCircle);
    pointMarker = null;
    pointCircle = null;
    currentArea = null;
    document.dispatchEvent(new CustomEvent('area-changed', { detail: null }));
  }

  function setMode(newMode) {
    mode = newMode;
    clear();
  }

  function setRadius(value) {
    radiusMeters = value;
    if (pointMarker) {
      const latlng = pointMarker.getLatLng();
      drawPointBuffer(latlng);
    }
  }

  function drawPointBuffer(latlng) {
    if (pointMarker) map.removeLayer(pointMarker);
    if (pointCircle) map.removeLayer(pointCircle);

    pointMarker = L.marker(latlng).addTo(map);
    pointCircle = L.circle(latlng, { radius: radiusMeters, color: '#2563eb', fillOpacity: 0.1 }).addTo(map);

    currentArea = {
      type: 'point',
      center: [latlng.lng, latlng.lat],
      radiusMeters
    };
    document.dispatchEvent(new CustomEvent('area-changed', { detail: currentArea }));
  }

  map.on('click', (e) => {
    if (mode !== 'point') return;
    drawPointBuffer(e.latlng);
  });

  map.on(L.Draw.Event.CREATED, (e) => {
    if (mode !== 'polygon') return;
    drawnItems.clearLayers();
    drawnItems.addLayer(e.layer);

    const geojson = e.layer.toGeoJSON();
    currentArea = { type: 'polygon', geojson };
    document.dispatchEvent(new CustomEvent('area-changed', { detail: currentArea }));
  });

  function getArea() {
    return currentArea;
  }

  function getMap() {
    return map;
  }

  // ---- Soil pits / sites layer ----------------------------------------------
  const soilSitesLayer = L.layerGroup();
  let soilSitesOn = false;

  function notifySites(detail) {
    document.dispatchEvent(new CustomEvent('soil-sites-status', { detail }));
  }

  function sitePopupHtml(site) {
    const a = site.attributes || {};
    const rows = Object.keys(a)
      .filter((k) => a[k] != null && a[k] !== '' && !/^(objectid|shape|globalid|gdb_)/i.test(k))
      .slice(0, 8)
      .map((k) => `<tr><th style="text-align:left;padding-right:6px;font-weight:600">${k}</th><td>${a[k]}</td></tr>`)
      .join('');
    return `<strong>Soil pit / sampling site</strong><br/>
      <span style="font-size:11px;color:#555">${site.source}</span>
      <table style="font-size:11px;margin-top:4px;border-collapse:collapse">${rows}</table>`;
  }

  function siteMarker(site) {
    return L.circleMarker([site.lat, site.lng], {
      radius: 4, color: '#7c2d12', weight: 1, fillColor: '#ea580c', fillOpacity: 0.85
    }).bindPopup(sitePopupHtml(site));
  }

  async function refreshSoilSites() {
    if (!soilSitesOn) return;
    if (map.getZoom() < SOIL_SITES.minZoom) {
      soilSitesLayer.clearLayers();
      notifySites({ tooFar: true });
      return;
    }
    notifySites({ loading: true });
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    try {
      const sites = await getSoilSites(bbox); // defined in js/services.js
      soilSitesLayer.clearLayers();
      sites.forEach((s) => siteMarker(s).addTo(soilSitesLayer));
      notifySites({ count: sites.length });
    } catch (err) {
      notifySites({ error: err.message });
    }
  }

  function toggleSoilSites(on) {
    soilSitesOn = on;
    if (on) {
      soilSitesLayer.addTo(map);
      refreshSoilSites();
    } else {
      map.removeLayer(soilSitesLayer);
      soilSitesLayer.clearLayers();
      notifySites({ off: true });
    }
  }

  map.on('moveend', () => { if (soilSitesOn) refreshSoilSites(); });

  return { setMode, setRadius, clear, getArea, getMap, toggleSoilSites };
})();
