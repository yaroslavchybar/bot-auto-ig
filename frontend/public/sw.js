// Retire the previously installed offline worker. New installs do not register one.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith('workbox-precache-')).map((name) => caches.delete(name)))
    await self.registration.unregister()
  })())
})
