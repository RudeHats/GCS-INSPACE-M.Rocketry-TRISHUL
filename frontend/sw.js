/**
 * Service Worker for CanSat Dashboard
 * Provides offline functionality and caching
 */

const CACHE_NAME = 'cansat-dashboard-v1';
const STATIC_CACHE_URLS = [
    '/',
    '/gui.html',
    '/script.js',
    '/style.css',
    '/libs/font-awesome.css',
    '/libs/chart.js',
    '/libs/leaflet.js',
    '/libs/leaflet.css',
    '/libs/iceland-font.css',
    '/libs/all.min.css',
    '/assets/rocket.png',
    '/assets/cansat.png',
    '/assets/psit.png'
];

// Install event - cache static resources
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching static resources...');
                return cache.addAll(STATIC_CACHE_URLS);
            })
            .then(() => {
                console.log('Static resources cached successfully');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('Failed to cache static resources:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('Service Worker activated');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip WebSocket connections
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        return;
    }

    // Skip API calls to backend
    if (url.hostname === 'localhost' && url.port === '8080') {
        return;
    }

    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    console.log('Serving from cache:', request.url);
                    return cachedResponse;
                }

                // If not in cache, try to fetch from network
                return fetch(request)
                    .then((response) => {
                        // Don't cache if not a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response for caching
                        const responseToCache = response.clone();

                        // Cache the response for future use
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(request, responseToCache);
                            });

                        return response;
                    })
                    .catch((error) => {
                        console.log('Network fetch failed, serving offline page:', error);
                        
                        // If it's a navigation request, serve the main page
                        if (request.mode === 'navigate') {
                            return caches.match('/gui.html');
                        }
                        
                        // For other requests, return a basic offline response
                        return new Response('Offline - Resource not available', {
                            status: 503,
                            statusText: 'Service Unavailable',
                            headers: new Headers({
                                'Content-Type': 'text/plain'
                            })
                        });
                    });
            })
    );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
    const { type, data } = event.data;

    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
        case 'CACHE_DATA':
            // Cache telemetry data for offline use
            cacheTelemetryData(data);
            break;
        case 'GET_CACHED_DATA':
            // Retrieve cached telemetry data
            getCachedTelemetryData().then((cachedData) => {
                event.ports[0].postMessage({ type: 'CACHED_DATA', data: cachedData });
            });
            break;
        default:
            console.log('Unknown message type:', type);
    }
});

// Cache telemetry data for offline use
async function cacheTelemetryData(data) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' }
        });
        await cache.put('/telemetry-data', response);
    } catch (error) {
        console.error('Failed to cache telemetry data:', error);
    }
}

// Retrieve cached telemetry data
async function getCachedTelemetryData() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match('/telemetry-data');
        if (response) {
            return await response.json();
        }
    } catch (error) {
        console.error('Failed to retrieve cached telemetry data:', error);
    }
    return null;
}

// Background sync for offline data
self.addEventListener('sync', (event) => {
    if (event.tag === 'background-sync') {
        event.waitUntil(syncOfflineData());
    }
});

// Sync offline data when connection is restored
async function syncOfflineData() {
    try {
        const cachedData = await getCachedTelemetryData();
        if (cachedData) {
            // Send data to main thread for processing
            const clients = await self.clients.matchAll();
            clients.forEach(client => {
                client.postMessage({
                    type: 'SYNC_OFFLINE_DATA',
                    data: cachedData
                });
            });
        }
    } catch (error) {
        console.error('Failed to sync offline data:', error);
    }
}