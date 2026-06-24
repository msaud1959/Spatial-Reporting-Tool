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

  return { setMode, setRadius, clear, getArea, getMap };
})();
