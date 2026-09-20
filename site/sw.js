'use strict';

// Aarya service worker.
// It is registered ONLY when Aarya runs as an installed app, never in a normal
// browser tab, so visiting the website leaves no offline copy on a shared phone.
//
// Strategy: show the saved copy immediately (works with no internet), and fetch
// a fresh copy in the background for next time. Requests to other sites, such as
// the map search, are never touched or saved.

const VERSION = 'aarya-v4'; // change this on every deploy that changes files below
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'favicon.svg',
  'hero.svg',
  'icon-192.png',
  'manifest.webmanifest',
  'data/config.json',
  'data/content.en.json',
  'data/content.hi.json',
  'data/facilities.json',
  'data/pincodes.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // map search and other sites: not handled

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('index.html') : undefined);

    const fresh = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => undefined);

    if (cached) {
      event.waitUntil(fresh); // update quietly in the background
      return cached;
    }
    return (await fresh) || new Response('Offline. If you are in danger, call 112.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});