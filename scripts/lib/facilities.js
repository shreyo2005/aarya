import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from 'csv-parse/sync';

export const ALLOWED_SERVICES = ['pep', 'ec', 'injury', 'sti', 'counselling', 'checkup'];
const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'];

function slugify(text) {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function yesNoUnknown(value) {
  const v = (value || '').trim().toLowerCase();
  return YES_NO_UNKNOWN.includes(v) ? v : 'unknown';
}

// Reads the spreadsheet export and returns clean facility objects.
// Throws with every problem listed, so you can fix the sheet in one go.
export function readFacilitiesCsv(path) {
  const rows = parse(readFileSync(path, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
  const errors = [];
  const ids = new Set();

  const facilities = rows.map((row, index) => {
    const line = index + 2; // +1 for header, +1 for 1-based
    const problem = (message) => errors.push(`Row ${line} (${row.name || 'no name'}): ${message}`);

    if (!row.name) problem('name is empty');

    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!Number.isFinite(latitude) || latitude < 6 || latitude > 37) problem(`latitude "${row.latitude}" is not valid for India`);
    if (!Number.isFinite(longitude) || longitude < 68 || longitude > 98) problem(`longitude "${row.longitude}" is not valid for India`);

    if (!/^\d{6}$/.test(row.pincode || '')) problem(`pincode "${row.pincode}" must be 6 digits`);

    const services = (row.services || '')
      .split(';')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (services.length === 0) problem('services is empty');
    services.filter((s) => !ALLOWED_SERVICES.includes(s)).forEach((s) => problem(`unknown service "${s}". Use: ${ALLOWED_SERVICES.join(', ')}`));

    if (!row.source) problem('source is empty. Every facility needs a source');

    const facilityId = row.id || slugify(`${row.name}-${row.pincode}`);
    if (ids.has(facilityId)) problem(`duplicate id "${facilityId}"`);
    ids.add(facilityId);

    return {
      facilityId,
      name: row.name,
      type: row.type || '',
      address: row.address || '',
      pincode: row.pincode,
      latitude,
      longitude,
      services,
      free: yesNoUnknown(row.free),
      hours: row.hours || '',
      handlesMinors: yesNoUnknown(row.handles_minors),
      phone: row.phone || '',
      source: row.source || '',
      verifiedOn: row.verified_on || '',
      onlyUnder18: yesNoUnknown(row.only_under_18) === 'yes',
      sample: yesNoUnknown(row.sample) === 'yes',
    };
  });

  if (errors.length) throw new Error(`Fix these in the spreadsheet:\n  ${errors.join('\n  ')}`);
  return facilities;
}

export function writeFacilitiesJson(path, facilities) {
  const sorted = [...facilities].sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), facilities: sorted }, null, 2) + '\n');
  return sorted.length;
}