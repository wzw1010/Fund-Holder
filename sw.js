/* ================================================================
   Fund-Holder · Service Worker
   策略：
     · 静态资源（HTML/图标/manifest/CDN 库）→ Cache First
     · 跨域 API（腾讯/东方财富/天天基金）→ Network Only（不缓存）
     · 导航请求 → Network First，失败回退到缓存的 index.html
   ================================================================ */

const CACHE_VERSION = 'fund-holder-v1';

// 预缓存的核心资源
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './icon-1024.png',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// 需要放行（不缓存）的跨域 API 域名
const API_HOSTS = [
    'qt.gtimg.cn',
    'push2.eastmoney.com',
    'fund.eastmoney.com',
    'fundgz.1234567.com.cn'
];

/* ---------------- install ---------------- */
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_VERSION)
        .then(function(cache) {
            // 逐个添加，避免某一个失败导致整体 install 失败
            return Promise.all(
                PRECACHE_URLS.map(function(url) {
                    return cache.add(url).catch(function(err) {
                        console.warn('[SW] 预缓存失败:', url, err);
                    });
                })
            );
        })
        .then(function() {
            return self.skipWaiting();
        })
    );
});

/* ---------------- activate ---------------- */
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys()
        .then(function(keys) {
            return Promise.all(
                keys.map(function(key) {
                    if (key !== CACHE_VERSION) {
                        console.log('[SW] 清理旧缓存:', key);
                        return caches.delete(key);
                    }
                })
            );
        })
        .then(function() {
            return self.clients.claim();
        })
    );
});

/* ---------------- fetch ---------------- */
self.addEventListener('fetch', function(event) {
    const req = event.request;

    // 只处理 GET
    if (req.method !== 'GET') return;

    let url;
    try {
        url = new URL(req.url);
    } catch (e) {
        return;
    }

    // 1) 跨域 API → Network Only，直接放行
    if (API_HOSTS.indexOf(url.hostname) !== -1) {
        return; // 不调用 respondWith，走浏览器默认网络请求
    }

    // 2) 导航请求（HTML）→ Network First，失败回退缓存
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
            .then(function(res) {
                const copy = res.clone();
                caches.open(CACHE_VERSION).then(function(cache) {
                    cache.put('./index.html', copy).catch(function() {});
                });
                return res;
            })
            .catch(function() {
                return caches.match('./index.html').then(function(cached) {
                    return cached || caches.match('./');
                });
            })
        );
        return;
    }

    // 3) 其他同源 / CDN 静态资源 → Cache First
    event.respondWith(
        caches.match(req).then(function(cached) {
            if (cached) return cached;

            return fetch(req).then(function(res) {
                // 只缓存成功响应（含 opaque 类型，如 CDN 资源）
                if (!res || (res.status !== 200 && res.type !== 'opaque')) {
                    return res;
                }
                const copy = res.clone();
                caches.open(CACHE_VERSION).then(function(cache) {
                    cache.put(req, copy).catch(function() {});
                });
                return res;
            }).catch(function() {
                // 网络失败且无缓存 → 返回简单离线提示
                return new Response('离线，且无可用缓存', {
                    status: 503,
                    statusText: 'Offline',
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            });
        })
    );
});

/* ---------------- message ---------------- */
// 支持从页面主动触发"跳过等待"，方便更新后立即生效
self.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});