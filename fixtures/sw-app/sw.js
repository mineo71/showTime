// Answers the counter itself, as an offline-first app would: the page never reaches the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname === '/api/count') {
    e.respondWith(new Response(JSON.stringify({ n: 'from-sw' }), { headers: { 'content-type': 'application/json' } }));
  }
});
