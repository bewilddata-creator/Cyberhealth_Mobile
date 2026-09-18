const CACHE = "cyberhealth-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/main.js",
  "js/app.js",
  "js/api.js",
  "js/apiurl.js",
  "js/config.js",
  "js/schedule.js",
  "js/viewmodel.js",
  "js/html.js",
  "js/format.js",
  "js/icons.js",
  "js/mockphoto.js",
  "js/photoinput.js",
  "js/views/common.js",
  "js/views/shell.js",
  "js/views/connect.js",
  "js/views/login.js",
  "js/views/today.js",
  "js/views/meds.js",
  "js/views/detail.js",
  "js/views/forms.js",
  "js/views/doctors.js",
  "js/views/emergency.js",
  "js/views/more.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
