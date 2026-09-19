// Aarya live search: finds hospitals near an approximate point using Amazon Location Service.
//
// Privacy rules for this function:
// - The browser rounds her location to 2 decimal places (about 1 km) before sending it.
// - The location arrives in the POST body, never in the URL, so it can't end up in access logs.
// - Nothing about the request is logged or stored. There is no console.log of input anywhere.
// - IntendedUse is SingleUse: results are shown once and never saved.

import { GeoPlacesClient, SearchNearbyCommand } from '@aws-sdk/client-geo-places';

const client = new GeoPlacesClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const RADIUS_METRES = 15000;
const MAX_RETURNED = 6;

// A guess from the name only. Shown to the user as a guess, never as a fact.
const GOVERNMENT_NAME = /\b(government|govt|district hospital|general hospital|taluk|phc|chc|uphc|primary health|community health|urban health|esi|esic|medical college|bbmp|referral hospital)\b/i;

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

// Accept only a plausible point inside India, and round it again in case the client didn't.
function readPoint(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    return null;
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 6 || lat > 37 || lng < 68 || lng > 98) return null;
  const round = (n) => Math.round(n * 100) / 100;
  return { lat: round(lat), lng: round(lng) };
}

function toPlace(item) {
  const [longitude, latitude] = item.Position || [];
  const phone = item.Contacts?.Phones?.[0]?.Value || '';
  return {
    name: item.Title || '',
    address: item.Address?.Label || '',
    latitude,
    longitude,
    phone,
    likelyGovernment: GOVERNMENT_NAME.test(item.Title || ''),
  };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== 'POST') return reply(405, { error: 'Use POST' });

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
  const point = readPoint(rawBody);
  if (!point) return reply(400, { error: 'Send lat and lng inside India' });

  try {
    const result = await client.send(new SearchNearbyCommand({
      QueryPosition: [point.lng, point.lat], // Amazon Location uses [longitude, latitude]
      QueryRadius: RADIUS_METRES,
      MaxResults: 20,
      Filter: {
        IncludeCategories: ['hospital', 'hospital_emergency_room'],
        IncludeCountries: ['IND'],
      },
      AdditionalFeatures: ['Contact'],
      IntendedUse: 'SingleUse',
    }));

    const places = (result.ResultItems || [])
      .map(toPlace)
      .filter((p) => p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

    // Likely government hospitals first, since care there is free. Each group keeps
    // Amazon Location's order, which is nearest first.
    const ordered = [...places.filter((p) => p.likelyGovernment), ...places.filter((p) => !p.likelyGovernment)];

    return reply(200, { places: ordered.slice(0, MAX_RETURNED) });
  } catch (error) {
    // Log the error type only, never the request.
    console.error('SearchNearby failed:', error.name);
    return reply(502, { error: 'Search failed' });
  }
};