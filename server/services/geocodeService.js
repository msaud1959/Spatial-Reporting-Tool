import { NOMINATIM } from '../config/dataSources.js';

const FETCH_TIMEOUT_MS = 8000;

export async function reverseGeocode([lng, lat]) {
  const url = new URL(NOMINATIM.reverseUrl);
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'spatial-reporting-tool/1.0 (educational use)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return { displayName: json.display_name ?? null, address: json.address ?? null, error: null };
  } catch (err) {
    return { displayName: null, address: null, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}
