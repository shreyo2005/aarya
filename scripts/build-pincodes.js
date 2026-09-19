// India Post pincode directory CSV (from data.gov.in) -> site/data/pincodes.json for Bengaluru.
// Usage: node scripts/build-pincodes.js <pincode-directory.csv> [site/data/pincodes.json]
// Check the column names in your downloaded file; this looks for pincode, latitude, longitude,
// district and statename, ignoring case.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const [csvPath, outPath = 'site/data/pincodes.json'] = process.argv.slice(2);
if (!csvPath) {
  console.error('Usage: node scripts/build-pincodes.js <pincode-directory.csv> [output.json]');
  process.exit(1);
}

const rows = parse(readFileSync(csvPath, 'utf8'), { columns: (h) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, bom: true, relax_column_count: true });

const sums = {};
let skipped = 0;
for (const row of rows) {
  const state = (row.statename || '').toLowerCase();
  const district = (row.district || '').toLowerCase();
  if (!state.includes('karnataka') || !/bangalore|bengaluru/.test(district)) continue;

  const pin = String(row.pincode || '').trim();
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  // The directory has missing and wrong coordinates; keep only ones near Bengaluru.
  if (!/^\d{6}$/.test(pin) || !(lat > 12.6 && lat < 13.4 && lng > 77.2 && lng < 78.0)) {
    skipped++;
    continue;
  }
  sums[pin] ??= { lat: 0, lng: 0, n: 0 };
  sums[pin].lat += lat;
  sums[pin].lng += lng;
  sums[pin].n++;
}

// A pincode has several post offices; use the average of their coordinates.
const pincodes = Object.fromEntries(
  Object.entries(sums)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pin, s]) => [pin, [Number((s.lat / s.n).toFixed(4)), Number((s.lng / s.n).toFixed(4))]])
);

writeFileSync(outPath, JSON.stringify({ source: 'India Post pincode directory, data.gov.in', sample: false, pincodes }, null, 2) + '\n');
console.log(`Wrote ${Object.keys(pincodes).length} Bengaluru pincodes to ${outPath} (skipped ${skipped} rows with missing or out-of-area coordinates)`);
console.log('Spot-check a few against a map before trusting them.');
