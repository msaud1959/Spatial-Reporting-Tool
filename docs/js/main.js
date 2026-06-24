(() => {
  const modePolygonBtn = document.getElementById('mode-polygon');
  const modePointBtn = document.getElementById('mode-point');
  const pointControls = document.getElementById('point-controls');
  const polygonHint = document.getElementById('polygon-hint');
  const radiusInput = document.getElementById('radius');
  const radiusValue = document.getElementById('radius-value');
  const clearBtn = document.getElementById('clear-btn');
  const generateBtn = document.getElementById('generate-btn');
  const statusEl = document.getElementById('status');
  const reportPanel = document.getElementById('report-panel');
  const closeReportBtn = document.getElementById('close-report-btn');
  const printBtn = document.getElementById('print-btn');
  const soilSitesToggle = document.getElementById('soil-sites-toggle');
  const soilSitesStatus = document.getElementById('soil-sites-status');

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = `status ${kind || ''}`;
  }

  modePolygonBtn.addEventListener('click', () => {
    modePolygonBtn.classList.add('active');
    modePointBtn.classList.remove('active');
    pointControls.classList.add('hidden');
    polygonHint.classList.remove('hidden');
    SpatialMap.setMode('polygon');
    generateBtn.disabled = true;
    setStatus('');
  });

  modePointBtn.addEventListener('click', () => {
    modePointBtn.classList.add('active');
    modePolygonBtn.classList.remove('active');
    pointControls.classList.remove('hidden');
    polygonHint.classList.add('hidden');
    SpatialMap.setMode('point');
    generateBtn.disabled = true;
    setStatus('');
  });

  radiusInput.addEventListener('input', () => {
    const value = Number(radiusInput.value);
    radiusValue.textContent = `${value} m`;
    SpatialMap.setRadius(value);
  });

  clearBtn.addEventListener('click', () => {
    SpatialMap.clear();
    generateBtn.disabled = true;
    setStatus('');
    reportPanel.classList.add('hidden');
  });

  document.addEventListener('area-changed', (e) => {
    generateBtn.disabled = !e.detail;
  });

  generateBtn.addEventListener('click', async () => {
    const area = SpatialMap.getArea();
    if (!area) return;

    generateBtn.disabled = true;
    setStatus('Generating report — querying soil, administrative and land-use data sources…', 'loading');

    try {
      const data = await generateReport(area); // defined in js/services.js, runs entirely in the browser
      ReportView.render(data);
      setStatus('Report generated.', '');
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      generateBtn.disabled = false;
    }
  });

  closeReportBtn.addEventListener('click', () => reportPanel.classList.add('hidden'));
  printBtn.addEventListener('click', () => window.print());

  // Soil pits / sites layer toggle.
  soilSitesToggle.addEventListener('change', () => {
    SpatialMap.toggleSoilSites(soilSitesToggle.checked);
  });

  document.addEventListener('soil-sites-status', (e) => {
    const d = e.detail || {};
    if (d.off) soilSitesStatus.textContent = 'Tick the box, then zoom in to a region to see soil sampling sites (orange dots). Click a dot for details.';
    else if (d.tooFar) soilSitesStatus.textContent = 'Zoom in closer to load soil sampling sites for the area in view.';
    else if (d.loading) soilSitesStatus.textContent = 'Loading soil sampling sites…';
    else if (d.error) soilSitesStatus.textContent = `Couldn't load soil sites just now (${d.error}).`;
    else if (typeof d.count === 'number') soilSitesStatus.textContent = d.count
      ? `${d.count} soil sampling site${d.count === 1 ? '' : 's'} shown in this view. Click a dot for details.`
      : 'No public soil sampling sites found in this view (coverage varies by region).';
  });
})();
