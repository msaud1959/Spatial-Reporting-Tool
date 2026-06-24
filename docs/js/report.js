const ReportView = (() => {
  function fmt(value, digits = 1) {
    if (value === null || value === undefined) return '—';
    return typeof value === 'number' ? Number(value.toFixed(digits)) : value;
  }

  // Plain-English helper text for each soil property, keyed by SLGA attribute code.
  const SOIL_INFO = {
    CLY: { name: 'Clay', plain: 'Fine particles. More clay holds water and nutrients but drains slowly.' },
    SLT: { name: 'Silt', plain: 'Medium-sized particles — smooth and floury when dry.' },
    SND: { name: 'Sand', plain: 'Coarse particles. More sand drains fast but holds little water.' },
    PHW: { name: 'Acidity (pH)', plain: 'How acid or alkaline the soil is. Around 6–7.5 suits most plants.' },
    SOC: { name: 'Organic carbon', plain: 'A sign of healthy, fertile soil rich in organic matter.' },
    AWC: { name: 'Water-holding capacity', plain: 'How much water the soil can store for plants.' },
    BDW: { name: 'Soil density', plain: 'How tightly packed the soil is. Very high can mean compaction.' },
    NTO: { name: 'Nitrogen', plain: 'A key nutrient plants need to grow.' }
  };

  // Turn the 0–5 cm topsoil numbers into a one-line plain description per property.
  function describe(code, value) {
    if (value === null || value === undefined) return '';
    if (code === 'PHW') {
      if (value < 5.5) return 'Acidic';
      if (value <= 7.3) return 'Near neutral — good for most plants';
      return 'Alkaline';
    }
    if (code === 'SOC') {
      if (value < 1) return 'Low';
      if (value < 2.5) return 'Moderate';
      return 'High — fertile';
    }
    if (code === 'SND') return value >= 60 ? 'Sandy soil' : '';
    if (code === 'CLY') return value >= 35 ? 'Heavy clay soil' : '';
    return '';
  }

  // Describe the overall topsoil texture in one friendly phrase.
  function textureClass(byCode) {
    const clay = byCode.CLY, sand = byCode.SND;
    if (clay == null || sand == null) return null;
    if (clay >= 35) return 'Clay';
    if (sand >= 70) return 'Sandy';
    if (sand >= 43 && clay < 27) return 'Sandy loam';
    if (clay >= 20) return 'Clay loam';
    return 'Loam';
  }

  // ---- Area overview ---------------------------------------------------------
  function renderLocation(report) {
    const { area, location } = report;
    const place = location.displayName || 'this area';
    return `
      <div class="report-section">
        <h3>📍 Area overview</h3>
        <p class="lead">You selected an area of about <strong>${area.areaHectares} hectares</strong>
        ${location.displayName ? `near <strong>${location.displayName}</strong>` : ''}.</p>
        <table class="kv">
          <tr><th>Size</th><td>${area.areaHectares} ha (${(area.areaHectares * 2.471).toFixed(1)} acres)</td></tr>
          <tr><th>Shape</th><td>${area.type === 'point' ? 'Point with a buffer circle' : 'Drawn polygon'}</td></tr>
          <tr><th>Centre point</th><td>${area.centroid[1].toFixed(4)}, ${area.centroid[0].toFixed(4)}</td></tr>
        </table>
      </div>`;
  }

  // ---- Where is this area? (administrative) ----------------------------------
  function renderAdmin(admin) {
    // Friendly label + helper for each ASGS layer, in the order people expect.
    const friendly = {
      state: { label: 'State / Territory', help: '' },
      lga: { label: 'Local council', help: 'The local government area responsible for this land.' },
      locality: { label: 'Suburb / locality', help: '' },
      sa2: { label: 'Statistical area', help: 'ABS region used for population & census statistics.' },
      sa1: { label: 'Small statistical units', help: 'The smallest ABS building blocks for statistics.' }
    };
    const order = ['state', 'lga', 'locality', 'sa2', 'sa1'];
    const byId = Object.fromEntries(admin.boundaries.map((b) => [b.id, b]));

    const rows = order.filter((id) => byId[id]).map((id) => {
      const b = byId[id];
      const f = friendly[id] || { label: b.name, help: '' };
      let value;
      if (b.error) value = `<span class="error-note">unavailable</span>`;
      else if (!b.matches.length) value = '—';
      else if (id === 'sa1') value = `${b.totalMatches} small area${b.totalMatches === 1 ? '' : 's'}`;
      else {
        const hidden = (b.totalMatches || b.matches.length) - b.matches.length;
        value = b.matches.join(', ') + (hidden > 0 ? ` <em>+${hidden} more</em>` : '');
      }
      const help = f.help ? `<div class="help">${f.help}</div>` : '';
      return `<tr><th>${f.label}${help}</th><td>${value}</td></tr>`;
    }).join('');

    return `
      <div class="report-section">
        <h3>🗺️ Where is this area?</h3>
        <table class="kv">${rows}</table>
        <p class="source-note">Source: <a href="${admin.sourceUrl}" target="_blank" rel="noopener">Australian Bureau of Statistics (ASGS)</a></p>
      </div>`;
  }

  // ---- How the land is used (planning context) -------------------------------
  function renderPlanning(planning) {
    let body;
    if (planning.error || !planning.landUse) {
      body = `<p class="muted">Land-use information isn't available for this exact spot.</p>`;
    } else {
      // CLUM property names vary; surface the most descriptive text value found.
      const entries = Object.entries(planning.landUse).filter(([, v]) => v != null && v !== '');
      const best = entries.find(([k]) => /desc|class|land|use|name|tert|second|primary/i.test(k));
      const headline = best ? best[1] : entries[0]?.[1];
      const rest = entries
        .filter(([, v]) => v !== headline)
        .map(([k, v]) => `<tr><th>${prettifyKey(k)}</th><td>${v}</td></tr>`)
        .join('');
      body = `
        ${headline ? `<p class="lead">${headline}</p>` : ''}
        ${rest ? `<table class="kv">${rest}</table>` : ''}`;
    }
    return `
      <div class="report-section">
        <h3>🏞️ How the land is used</h3>
        ${body}
        <p class="source-note">A national land-use guide. Always check your local council's planning scheme for exact zoning.<br/>
        Source: <a href="${planning.sourceUrl}" target="_blank" rel="noopener">ABARES land use (CLUM)</a></p>
      </div>`;
  }

  function prettifyKey(k) {
    return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ---- Soil ------------------------------------------------------------------
  function renderSoil(soil) {
    const byCode = {};
    soil.attributes.forEach((a) => { byCode[a.key] = a.depths[0]?.value ?? null; });

    // "At a glance" cards based on the topsoil (0–5 cm) layer.
    const texture = textureClass(byCode);
    const cards = soil.attributes.map((attr) => {
      const info = SOIL_INFO[attr.key] || { name: attr.label, plain: '' };
      const top = attr.depths[0]?.value;
      const note = describe(attr.key, top);
      return `
        <div class="soil-card">
          <div class="soil-card-top">
            <span class="soil-name">${info.name}</span>
            <span class="soil-value">${fmt(top)}${top != null ? ` <small>${attr.unit}</small>` : ''}</span>
          </div>
          ${note ? `<div class="soil-tag">${note}</div>` : ''}
          <div class="soil-plain">${info.plain}</div>
        </div>`;
    }).join('');

    // Detailed by-depth table, tucked into a collapsible for those who want it.
    const depthHeaders = soil.attributes[0]?.depths.map((d) => `<th>${d.label}</th>`).join('') ?? '';
    const detailRows = soil.attributes.map((attr) => {
      const info = SOIL_INFO[attr.key] || { name: attr.label };
      const cells = attr.depths.map((d) => `<td>${fmt(d.value)}</td>`).join('');
      return `<tr><th>${info.name} <small>(${attr.unit})</small></th>${cells}</tr>`;
    }).join('');

    return `
      <div class="report-section">
        <h3>🌱 Soil at a glance</h3>
        ${texture ? `<p class="lead">The topsoil here is broadly <strong>${texture}</strong>.</p>` : ''}
        <p class="muted">Values below are for the topsoil (0–5 cm). Tap "Show all depths" for the full profile.</p>
        <div class="soil-grid">${cards}</div>

        <details class="depth-details">
          <summary>Show all depths (0–200 cm)</summary>
          <table class="depth-table">
            <tr><th>Property</th>${depthHeaders}</tr>
            ${detailRows}
          </table>
        </details>

        <p class="source-note">Estimated from a ~90 m national soil grid at the area's centre — a guide, not a substitute for a soil test.<br/>
        Source: <a href="${soil.sourceUrl}" target="_blank" rel="noopener">CSIRO / TERN Soil &amp; Landscape Grid of Australia</a></p>
      </div>`;
  }

  // ---- Soil pits in the selected area ----------------------------------------
  function renderSoilSites(report) {
    const sites = report.sites || [];
    let body;
    if (!sites.length) {
      body = `<p class="muted">No public soil pits / sampling sites were found inside this area. These points come from openly available government soil-site datasets, which don't yet cover every region.</p>`;
    } else {
      const rows = sites.slice(0, 20).map((s, i) => {
        const a = s.attributes || {};
        const label = a.SITE_ID || a.site_id || a.PROJ_SITE_ID || a.NAME || a.name || `Site ${i + 1}`;
        return `<tr><td>${label}</td><td>${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}</td><td>${s.source}</td></tr>`;
      }).join('');
      const more = sites.length > 20 ? `<p class="muted">Showing 20 of ${sites.length}.</p>` : '';
      body = `
        <p class="lead"><strong>${sites.length}</strong> soil pit${sites.length === 1 ? '' : 's'} / sampling site${sites.length === 1 ? '' : 's'} fall inside this area.</p>
        <table class="kv"><tr><th>Site</th><th>Location</th><th>Source</th></tr>${rows}</table>
        ${more}`;
    }
    return `
      <div class="report-section">
        <h3>📌 Soil pits in this area</h3>
        ${body}
        <p class="source-note">Openly available government soil-site point data. The full national set (CSIRO NatSoil) is accessible through ANSIS with a free login.</p>
      </div>`;
  }

  function render(report) {
    const allFailed = report.soil.attributes.every((a) => a.depths.every((d) => d.value == null))
      && report.admin.boundaries.every((b) => b.error || !b.matches.length);
    const banner = allFailed
      ? `<div class="warn-banner">We couldn't reach the data services just now. Check your connection and try again.</div>`
      : '';

    document.getElementById('report-content').innerHTML = banner
      + renderLocation(report)
      + renderAdmin(report.admin)
      + renderSoil(report.soil)
      + renderSoilSites(report)
      + renderPlanning(report.planning);
    document.getElementById('report-panel').classList.remove('hidden');
  }

  return { render };
})();
