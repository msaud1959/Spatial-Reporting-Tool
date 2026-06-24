const ReportView = (() => {
  function fmt(value) {
    return value === null || value === undefined ? '—' : value;
  }

  function renderLocation(report) {
    const { area, location } = report;
    return `
      <div class="report-section">
        <h3>Location summary</h3>
        <table>
          <tr><th>Area type</th><td>${area.type === 'point' ? 'Point + buffer' : 'Polygon'}</td></tr>
          <tr><th>Area size</th><td>${area.areaHectares} ha</td></tr>
          <tr><th>Centroid</th><td>${area.centroid[1].toFixed(5)}, ${area.centroid[0].toFixed(5)}</td></tr>
          <tr><th>Nearest address</th><td>${fmt(location.displayName)}</td></tr>
        </table>
        ${location.error ? `<p class="error-note">Reverse geocoding unavailable: ${location.error}</p>` : ''}
      </div>`;
  }

  function renderAdmin(admin) {
    const rows = admin.boundaries.map((b) => {
      if (b.error) return `<li><strong>${b.name}:</strong> <span class="error-note">unavailable (${b.error})</span></li>`;
      if (!b.matches.length) return `<li><strong>${b.name}:</strong> no match</li>`;
      const hidden = (b.totalMatches || b.matches.length) - b.matches.length;
      const more = hidden > 0 ? ` <em>…and ${hidden} more (${b.totalMatches} total)</em>` : '';
      return `<li><strong>${b.name}:</strong> ${b.matches.join(', ')}${more}</li>`;
    }).join('');

    return `
      <div class="report-section">
        <h3>Administrative boundaries</h3>
        <ul class="boundary-list">${rows}</ul>
        <p class="source-note">Source: <a href="${admin.sourceUrl}" target="_blank" rel="noopener">${admin.source}</a></p>
      </div>`;
  }

  function renderPlanning(planning) {
    let body;
    if (planning.error) {
      body = `<p class="error-note">Land-use lookup unavailable: ${planning.error}</p>`;
    } else if (!planning.landUse) {
      body = `<p>No land-use data returned for this location.</p>`;
    } else {
      const rows = Object.entries(planning.landUse)
        .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
        .join('');
      body = `<table>${rows}</table>`;
    }

    return `
      <div class="report-section">
        <h3>Planning &amp; land-use context</h3>
        ${body}
        <p class="source-note">${planning.note}<br/>Source: <a href="${planning.sourceUrl}" target="_blank" rel="noopener">${planning.source}</a></p>
      </div>`;
  }

  function renderSoil(soil) {
    const depthHeaders = soil.attributes[0]?.depths.map((d) => `<th>${d.label}</th>`).join('') ?? '';
    const rows = soil.attributes.map((attr) => {
      const cells = attr.depths.map((d) => `<td>${fmt(d.value)}</td>`).join('');
      return `<tr><th>${attr.label} (${attr.unit})</th>${cells}</tr>`;
    }).join('');

    return `
      <div class="report-section">
        <h3>Soil properties</h3>
        <table>
          <tr><th>Attribute</th>${depthHeaders}</tr>
          ${rows}
        </table>
        <p class="source-note">${soil.resolution}<br/>Source: <a href="${soil.sourceUrl}" target="_blank" rel="noopener">${soil.source}</a></p>
      </div>`;
  }

  function render(report) {
    const html = [
      renderLocation(report),
      renderAdmin(report.admin),
      renderPlanning(report.planning),
      renderSoil(report.soil)
    ].join('');

    document.getElementById('report-content').innerHTML = html;
    document.getElementById('report-panel').classList.remove('hidden');
  }

  return { render };
})();
