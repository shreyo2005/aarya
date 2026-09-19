// CSV -> site/data/facilities.json, no AWS needed. Use this while building locally.
// Usage: node scripts/build-facilities.js data/facilities.csv site/data/facilities.json
import { readFacilitiesCsv, writeFacilitiesJson } from './lib/facilities.js';

const [csvPath, jsonPath] = process.argv.slice(2);
if (!csvPath || !jsonPath) {
  console.error('Usage: node scripts/build-facilities.js <facilities.csv> <output.json>');
  process.exit(1);
}

try {
  const count = writeFacilitiesJson(jsonPath, readFacilitiesCsv(csvPath));
  console.log(`Wrote ${count} facilities to ${jsonPath}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
