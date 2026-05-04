const CACHE_NAME = 'sft-paper-v1.1';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './student.html',
  './remote-scanner.html',
  './css/style.css',
  './js/supabase-config.js',
  './js/instructor.js',
  './js/admin.js',
  './js/student.js',
  './logo.png',
  './MiniLogo.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
