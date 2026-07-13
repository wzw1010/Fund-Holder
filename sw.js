// sw.js
// Fund Holder Service Worker - 离线缓存加速

const CACHE_NAME = 'fund-holder-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-1024.png',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// 安装时缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 缓存资源成功');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key !== CACHE_NAME) {
          console.log('[SW] 删除旧缓存:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  // 立即接管所有页面
  self.clients.claim();
});

// 拦截请求，智能缓存
self.addEventListener('fetch', event => {
  // 1. 如果是基金/指数数据API（JSONP或JSON），直接走网络，不缓存，保证实时性
  const url = event.request.url;
  if (url.includes('fundgz.1234567.com.cn') ||
      url.includes('qt.gtimg.cn') ||
      url.includes('push2.eastmoney.com') ||
      url.includes('jsonp') ||
      url.includes('cb=') ||
      url.includes('_jsonpCB')) {
    // 直接请求网络，如果失败则返回空响应，避免页面卡死
    return event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 408 }))
    );
  }

  // 2. 其他请求（HTML、JS、CSS、图标等）：缓存优先，网络回退
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // 命中缓存，直接返回
          return cachedResponse;
        }
        // 未命中缓存，发起网络请求
        return fetch(event.request)
          .then(response => {
            // 只缓存成功的响应（状态200且为同源或CDN资源）
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            return response;
          })
          .catch(() => {
            // 离线且无缓存时，返回简单的离线提示
            return new Response('网络未连接，请稍后重试', { status: 503 });
          });
      })
  );
});