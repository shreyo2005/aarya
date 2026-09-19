'use strict';

// ---------------------------------------------------------------------------
// Aarya
//
// Privacy: everything she chooses or types lives only in this page's memory.
// Nothing is written to the URL, cookies or browser storage. Her location is
// sent nowhere, except an approximate area (about 1 km) if she taps
// "Search the map" herself. What she types in the form is never sent anywhere.
//
// Advice: every suggestion comes from fixed rules in buildAdvice() below,
// using text written in data/content.*.json. Nothing is generated or guessed.
// ---------------------------------------------------------------------------

const QUICK_EXIT_URL = 'https://www.google.com/search?q=weather';
const FETCH_TIMEOUT_MS = 10000;
const LIVE_TIMEOUT_MS = 12000;

const state = {
  lang: 'en',
  helper: false,
  service: null,   // key from content.services, e.g. 'pep'
  origin: null,    // { lat, lng }
  live: null,      // map search results, once she has asked for them
  previous: [],    // in-page back stack (browser history is never touched)
};

let config = { liveSearchUrl: '' };
let base = null;    // English content: the fallback for anything missing
let content = null; // content in the current language
let data = null;    // promise of { facilities, pincodes }
const contentCache = {};

// Words that should raise an urgent card even if she only typed them.
// Checked on the phone only. English words match whole words.
const TEXT_FLAGS = {
  emergency: {
    en: ['bleeding', 'unconscious', 'fainted', 'fainting', 'passed out', "can't breathe", 'cannot breathe', 'not breathing'],
    hi: ['खून बह', 'बेहोश', 'सांस नहीं', 'साँस नहीं'],
  },
  selfharm: {
    en: ['suicide', 'kill myself', 'end my life', 'want to die', 'hurt myself'],
    hi: ['आत्महत्या', 'मर जाना', 'मरना चाहती', 'जान दे'],
  },
};

// ---------- Small helpers ----------

const $ = (selector) => document.querySelector(selector);

function el(tag, { text, className, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  }
  return node;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadJson(path) {
  const response = await fetchWithTimeout(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function loadContent(lang) {
  if (!contentCache[lang]) {
    const loaded = await loadJson(`data/content.${lang}.json`);
    if (!loaded || typeof loaded.ui !== 'object') throw new Error(`content.${lang}.json has no "ui" section`);
    contentCache[lang] = loaded;
  }
  return contentCache[lang];
}

function ensureData() {
  if (!data) {
    data = Promise.all([loadJson('data/facilities.json'), loadJson('data/pincodes.json')])
      .then(([facilities, pincodes]) => ({
        facilities: Array.isArray(facilities?.facilities) ? facilities.facilities.filter(isValidFacility) : [],
        pincodes: pincodes && typeof pincodes.pincodes === 'object' ? pincodes.pincodes : {},
      }))
      .catch((error) => {
        data = null; // allow a retry next time
        throw error;
      });
  }
  return data;
}

function isValidFacility(f) {
  return f && typeof f.name === 'string' && Number.isFinite(f.latitude) && Number.isFinite(f.longitude) && Array.isArray(f.services);
}

// Text lookup with fallbacks: helper wording, then the current language, then English, then the key itself.
function t(key, vars = {}) {
  const pick = (c) => c && ((state.helper && c.ui.helper && c.ui.helper[key]) || c.ui[key]);
  let text = pick(content) || pick(base) || key;
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text;
}

// Section lookup (services, check, rights...) with English as the fallback.
function section(name) {
  const found = (content && content[name]) || (base && base[name]);
  return found || {};
}

function adviceText(id) {
  return (content?.advice && content.advice[id]) || (base?.advice && base.advice[id]) || null;
}

function showFatal() {
  const fatal = $('#fatal');
  if (fatal) fatal.hidden = false;
}

// ---------- Screens ----------

function applyStaticText() {
  document.documentElement.lang = content.lang || state.lang;
  document.querySelectorAll('[data-t]').forEach((node) => {
    node.textContent = t(node.dataset.t);
  });
  document.querySelectorAll('[data-t-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.tPlaceholder);
  });
  $('#lang-button').lang = state.lang === 'en' ? 'hi' : 'en';
  $('#helper-banner').hidden = !state.helper;
  renderCheckForm();
  renderHelplines();
}

function currentScreenId() {
  const visible = document.querySelector('.screen:not([hidden])');
  return visible ? visible.id : 'home';
}

function show(id, { remember = true } = {}) {
  const target = document.getElementById(id);
  if (!target) return;
  const current = currentScreenId();
  if (remember && current !== id) state.previous.push(current);
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.hidden = screen.id !== id;
  });
  renderScreen(id);
  window.scrollTo(0, 0);
  const heading = target.querySelector('h1, h2');
  if (heading) heading.focus();
}

function renderScreen(id) {
  if (id === 'advice') renderAdvice();
  if (id === 'results') renderResults();
  if (id === 'rights') renderRights();
  if (id === 'area') clearAreaMessages();
  if (id === 'check') $('#check-error').hidden = true;
}

// ---------- The form ----------

// Reads what she has chosen so far. Works before and after a language switch.
function readAnswers() {
  const chosen = new Set();
  let when = null;
  document.querySelectorAll('#check-groups input:checked').forEach((input) => {
    if (input.type === 'radio') when = input.value;
    else chosen.add(input.value);
  });
  const notes = ($('#notes').value || '').trim();
  return { chosen, when, notes };
}

// Builds the form from content, keeping any answers already given.
function renderCheckForm() {
  const holder = $('#check-groups');
  const previous = readAnswers();
  holder.replaceChildren();

  const groups = Array.isArray(section('check').groups) ? section('check').groups : [];
  groups.forEach((group) => {
    const fieldset = el('fieldset', { className: 'group' });
    fieldset.append(el('legend', { text: (state.helper && group.legendHelper) || group.legend }));
    if (group.hint) fieldset.append(el('p', { className: 'hint', text: group.hint }));

    (group.options || []).forEach((option) => {
      const id = `q-${group.id}-${option.id}`;
      const type = group.type === 'radio' ? 'radio' : 'checkbox';
      const input = el('input', { attrs: { type, id, name: group.id, value: option.id } });
      input.checked = type === 'radio' ? previous.when === option.id : previous.chosen.has(option.id);
      const label = el('label', { className: 'choice', attrs: { for: id } });
      label.append(input, el('span', { text: option.label }));
      fieldset.append(label);
    });
    holder.append(fieldset);
  });
}

function containsAny(text, words) {
  const lower = text.toLowerCase();
  return words.some((word) => {
    if (/^[\x00-\x7F]+$/.test(word)) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(lower);
    }
    return lower.includes(word);
  });
}

function textFlag(notes, kind) {
  if (!notes) return false;
  const lists = TEXT_FLAGS[kind];
  return containsAny(notes, [...lists.en, ...lists.hi]);
}

// The rules. Input: her answers. Output: advice ids, most urgent first.
function buildAdvice({ chosen, when, notes }) {
  const has = (id) => chosen.has(id);
  const recent = when !== 'older'; // 'not sure' and no answer are treated as recent, to be safe
  const exposure = has('forced') || has('condom');
  const emergency = has('bleeding') || has('bellypain') || has('head') || has('breathing') || textFlag(notes, 'emergency');
  const selfharm = has('selfharm') || textFlag(notes, 'selfharm');

  const ids = [];
  const add = (id) => { if (!ids.includes(id)) ids.push(id); };

  // Life and safety first.
  if (emergency) add('emergency');
  if (selfharm) add('selfharm');
  if (has('unsafe')) add('unsafe');

  // Time-critical care.
  if (exposure && recent) add('pep');
  if (exposure && recent) add('ec');
  if (has('cantgo') || (exposure && recent)) add('cantgo');
  if (has('drugged')) add('drugged');

  // Care that matters but is less time-critical.
  if (has('hurt')) add('injury');
  if (exposure && !recent) add('pepLate');
  if (exposure && !recent) add('ecLate');
  if (exposure || has('urine') || has('discharge') || has('fever')) add('sti');
  if (has('pregnant')) add('pregnancy');
  if (has('under18')) add('under18');
  if (has('forced')) add('complaint');
  if (has('forced') || has('hurt') || has('unsafe') || has('drugged') || selfharm) add('talk');

  if (ids.length === 0) add('general');
  return ids;
}

function handleCheckSubmit(event) {
  event.preventDefault();
  const answers = readAnswers();
  const error = $('#check-error');
  if (answers.chosen.size === 0 && !answers.notes && !answers.when) {
    error.textContent = t('check.errorEmpty');
    error.hidden = false;
    return;
  }
  error.hidden = true;
  show('advice');
}

// ---------- Advice ----------

function renderAdvice() {
  const answers = readAnswers();
  const list = $('#advice-list');
  list.replaceChildren();

  buildAdvice(answers).forEach((id) => {
    const card = adviceText(id);
    if (card) list.append(adviceCard(card));
  });

  $('#notes-box').hidden = !answers.notes;
  $('#notes-show').textContent = answers.notes;
}

function adviceCard(card) {
  const item = el('li', { className: card.urgent ? 'advice-card advice-card--urgent' : 'advice-card' });
  item.append(el('h3', { text: card.title }));
  if (card.body) item.append(el('p', { text: card.body }));

  if (Array.isArray(card.points) && card.points.length) {
    const points = el('ul', { className: 'advice-points' });
    card.points.forEach((point) => points.append(el('li', { text: point })));
    item.append(points);
  }

  if (Array.isArray(card.calls) && card.calls.length) {
    const calls = el('div', { className: 'advice-calls' });
    card.calls.forEach((call) => {
      calls.append(el('a', {
        className: card.urgent ? 'button button--danger' : 'button',
        text: `${call.label}: ${call.number}`,
        attrs: { href: `tel:${String(call.number).replace(/[^\d+]/g, '')}` },
      }));
    });
    item.append(calls);
  }

  if (card.service && section('services')[card.service]) {
    const where = el('button', { className: 'button button--primary', text: t('advice.where'), attrs: { type: 'button' } });
    where.addEventListener('click', () => chooseService(card.service));
    item.append(where);
  }

  if (card.source) item.append(el('p', { className: 'source', text: t('advice.source', { source: card.source }) }));
  return item;
}

function clearNotes() {
  $('#notes').value = '';
  $('#notes-show').textContent = '';
  $('#notes-box').hidden = true;
}

function chooseService(service) {
  state.service = service;
  show(state.origin ? 'results' : 'area');
}

// ---------- Area (pincode or GPS) ----------

function clearAreaMessages() {
  $('#area-status').textContent = '';
  $('#area-error').hidden = true;
}

function showAreaError(key) {
  $('#area-status').textContent = '';
  const error = $('#area-error');
  error.textContent = t(key);
  error.hidden = false;
}

async function handlePincode(event) {
  event.preventDefault();
  clearAreaMessages();
  const input = $('#pincode');
  const pin = input.value.trim();
  if (!/^\d{6}$/.test(pin)) return showAreaError('errors.pinInvalid');

  let loaded;
  try {
    loaded = await ensureData();
  } catch {
    return showAreaError('errors.dataFailed');
  }

  const coords = loaded.pincodes[pin];
  if (Array.isArray(coords) && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
    state.origin = { lat: coords[0], lng: coords[1] };
  } else {
    // Fall back to a facility in the same pincode, if there is one.
    const match = loaded.facilities.find((facility) => facility.pincode === pin);
    if (!match) return showAreaError('errors.pinUnknown');
    state.origin = { lat: match.latitude, lng: match.longitude };
  }

  input.value = ''; // don't leave the pincode sitting on screen
  state.live = null;
  show('results');
}

let locating = false;

function handleGps() {
  if (locating) return;
  clearAreaMessages();
  if (!('geolocation' in navigator)) return showAreaError('errors.gpsUnavailable');

  locating = true;
  $('#area-status').textContent = t('area.gpsWait');

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      locating = false;
      try {
        await ensureData();
      } catch {
        return showAreaError('errors.dataFailed');
      }
      // Kept in memory in this tab only. Distances are calculated on the phone.
      state.origin = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.live = null;
      show('results');
    },
    (error) => {
      locating = false;
      showAreaError(error.code === error.PERMISSION_DENIED ? 'errors.gpsDenied' : 'errors.gpsUnavailable');
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
  );
}

// ---------- Results ----------

// Haversine formula: straight-line distance between two points on a sphere.
function distanceKm(a, b) {
  const earthRadiusKm = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

let resultsRender = 0; // ignores a slow render if a newer one has started

async function renderResults() {
  const token = ++resultsRender;
  const list = $('#results-list');
  list.replaceChildren();
  $('#results-empty').hidden = true;

  const service = section('services')[state.service];
  if (!service || !state.origin) return;

  $('#results-title').textContent = t('results.title', { service: service.name });
  $('#results-say').textContent = service.say || '';
  const note = $('#results-note');
  note.hidden = !service.note;
  note.textContent = service.note || '';

  let loaded;
  try {
    loaded = await ensureData();
  } catch {
    if (token !== resultsRender) return;
    $('#results-empty').hidden = false;
    renderLive();
    return;
  }
  if (token !== resultsRender) return;

  // Children's hospitals are shown only if she said she is under 18.
  const under18 = readAnswers().chosen.has('under18');
  const matches = loaded.facilities
    .filter((facility) => facility.services.includes(state.service))
    .filter((facility) => under18 || !facility.onlyUnder18)
    .map((facility) => ({
      ...facility,
      km: distanceKm(state.origin, { lat: facility.latitude, lng: facility.longitude }),
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 5);

  $('#results-empty').hidden = matches.length > 0;
  matches.forEach((facility) => list.append(facilityCard(facility)));
  renderLive();
}

function freeText(free) {
  if (free === 'yes') return t('results.free');
  if (free === 'no') return t('results.paid');
  return t('results.freeUnknown');
}

function minorsText(value) {
  if (value === 'yes') return t('results.minorsYes');
  if (value === 'no') return t('results.minorsNo');
  return t('results.minorsUnknown');
}

function facilityCard(facility) {
  const item = el('li', { className: 'place' });

  const head = el('div', { className: 'place-head' });
  head.append(el('h3', { text: facility.name }));
  if (facility.sample) head.append(el('span', { className: 'badge', text: t('results.sample') }));
  item.append(head);

  const facts = el('ul', { className: 'place-facts' });
  [
    t('results.km', { km: facility.km.toFixed(1) }),
    freeText(facility.free),
    facility.hours ? t('results.hours', { hours: facility.hours }) : null,
    minorsText(facility.handlesMinors),
    facility.address,
  ]
    .filter(Boolean)
    .forEach((text) => facts.append(el('li', { text })));
  item.append(facts, placeActions(facility));

  if (facility.verifiedOn) {
    item.append(el('p', { className: 'place-checked', text: t('results.checked', { date: facility.verifiedOn }) }));
  }
  return item;
}

// Call and Directions buttons, shared by checked places and map results.
function placeActions(place) {
  const actions = el('div', { className: 'place-actions' });
  const phone = String(place.phone || '').replace(/[^\d+]/g, '');
  if (phone) {
    actions.append(el('a', { className: 'button', text: t('results.call'), attrs: { href: `tel:${phone}` } }));
  }
  // Only the place's coordinates go into this link, never hers.
  actions.append(el('a', {
    className: 'button',
    text: t('results.directions'),
    attrs: {
      href: `https://www.google.com/maps/dir/?api=1&destination=${Number(place.latitude)},${Number(place.longitude)}`,
      rel: 'noreferrer noopener',
    },
  }));
  return actions;
}

// ---------- Map search (only when she asks for it) ----------

function renderLive() {
  const block = $('#live');
  block.hidden = !config.liveSearchUrl || !state.origin;
  if (block.hidden) return;

  const list = $('#live-list');
  list.replaceChildren();
  $('#live-results').hidden = !state.live;
  $('#live-button').hidden = Boolean(state.live);
  if (!state.live) return;

  $('#live-none').hidden = state.live.length > 0;
  state.live.forEach((place) => list.append(liveCard(place)));
}

function liveCard(place) {
  const item = el('li', { className: 'place' });

  const head = el('div', { className: 'place-head' });
  head.append(el('h3', { text: place.name }), el('span', { className: 'badge', text: t('live.badge') }));
  item.append(head);

  const km = distanceKm(state.origin, { lat: place.latitude, lng: place.longitude });
  const facts = el('ul', { className: 'place-facts' });
  [
    t('results.km', { km: km.toFixed(1) }),
    place.likelyGovernment ? t('live.likelyGov') : null,
    place.address,
  ]
    .filter(Boolean)
    .forEach((text) => facts.append(el('li', { text })));
  item.append(facts, placeActions(place));
  return item;
}

function isValidLivePlace(p) {
  return p && typeof p.name === 'string' && p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
}

let searchingLive = false;

async function liveSearch() {
  if (searchingLive || !config.liveSearchUrl || !state.origin) return;
  searchingLive = true;
  const status = $('#live-status');
  status.textContent = t('live.searching');

  // Round to 2 decimal places (about 1 km) before anything leaves the phone.
  const round = (n) => Math.round(n * 100) / 100;

  try {
    const response = await fetchWithTimeout(config.liveSearchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: round(state.origin.lat), lng: round(state.origin.lng) }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    }, LIVE_TIMEOUT_MS);
    if (!response.ok) throw new Error(String(response.status));
    const result = await response.json();
    state.live = Array.isArray(result?.places) ? result.places.filter(isValidLivePlace) : [];
    status.textContent = '';
    renderLive();
  } catch {
    status.textContent = t('live.failed');
  } finally {
    searchingLive = false;
  }
}

// ---------- Rights and helplines ----------

function renderRights() {
  const list = $('#rights-list');
  list.replaceChildren();
  const rights = section('rights');
  (Array.isArray(rights) ? rights : []).forEach((right) => {
    const item = el('li');
    item.append(el('h3', { text: right.title }), el('p', { text: right.body }));
    if (right.source) item.append(el('p', { className: 'source', text: t('rights.source', { source: right.source }) }));
    list.append(item);
  });
}

// Shown in the footer, so they are visible on every screen.
function renderHelplines() {
  const list = $('#helplines');
  list.replaceChildren();
  const lines = section('helplines');
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const item = el('li');
    const number = String(line.number || '');
    item.append(`${line.label}: `, el('a', { text: number, attrs: { href: `tel:${number.replace(/[^\d+]/g, '')}` } }));
    list.append(item);
  });
}


// ---------- Installable app ----------

let installPrompt = null;

function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function setupInstall() {
  // Offline copy only for the installed app, so a normal visit leaves nothing saved on the phone.
  if (isInstalledApp() && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Show our own Install button only when the browser says installing is possible.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('#install').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('#install').hidden = true;
  });
}

async function installApp() {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  $('#install').hidden = true;
  try {
    await prompt.prompt();
  } catch {
    // the browser refused or the user closed it; nothing else to do
  }
}


// ---------- Actions ----------

function quickExit() {
  try {
    document.body.replaceChildren(); // blank the screen immediately
  } finally {
    window.location.replace(QUICK_EXIT_URL); // replaces this page in history instead of adding to it
  }
}

async function switchLanguage() {
  const next = state.lang === 'en' ? 'hi' : 'en';
  try {
    content = await loadContent(next);
    state.lang = next;
    applyStaticText();
    renderScreen(currentScreenId());
  } catch {
    // keep the current language if the other file fails to load
  }
}

function setHelper(on) {
  state.helper = on;
  applyStaticText();
  renderScreen(currentScreenId());
}

function restart() {
  $('#check-form').reset(); // clears every answer and what she typed
  clearNotes();
  state.service = null;
  state.origin = null;
  state.live = null;
  state.previous = [];
  show('home', { remember: false });
}

function back() {
  show(state.previous.pop() || 'home', { remember: false });
}

const actions = {
  leave: quickExit,
  lang: switchLanguage,
  'helper-on': () => setHelper(true),
  'helper-off': () => setHelper(false),
  back,
  restart,
  'go-check': () => show('check'),
  'go-rights': () => show('rights'),
  'go-checkup': () => chooseService('checkup'),
  'clear-notes': clearNotes,
  gps: handleGps,
  'live-search': liveSearch,
    install: installApp,
};

async function init() {
  // If anything unexpected breaks, show a message with 112 instead of a blank page.
  window.addEventListener('error', showFatal);
  window.addEventListener('unhandledrejection', showFatal);

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target && actions[target.dataset.action]) actions[target.dataset.action](target);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') quickExit();
  });
  $('#pin-form').addEventListener('submit', handlePincode);
  $('#check-form').addEventListener('submit', handleCheckSubmit);
    setupInstall();

  try {
    base = await loadContent('en');
    content = base;
  } catch {
    showFatal();
    return;
  }
  try {
    config = { ...config, ...(await loadJson('data/config.json')) };
  } catch {
    // no config file: the map search stays switched off
  }
  applyStaticText();
  show('home', { remember: false });
  ensureData().catch(() => {}); // start loading the lists in the background
}

init();