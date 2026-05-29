/* ===========================================================
 * sw.js
 * ===========================================================
 * Copyright 2016 @huxpro
 * Licensed under Apache 2.0
 * Register service worker.
 * ========================================================== */

const PRECACHE = 'precache-v5';
const RUNTIME = 'runtime';
const HOSTNAME_WHITELIST = [
  self.location.hostname,
  'lvdobby.github.io',
  'cdnjs.cloudflare.com'
];

const getFixedUrl = (req) => {
  const url = new URL(req.url);
  url.protocol = self.location.protocol;
  url.search += (url.search ? '&' : '?') + 'cache-bust=' + Date.now();
  return url.href;
};

const isNavigationReq = (req) => (
  req.mode === 'navigate' ||
  (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'))
);

const endWithExtension = (req) => /\.\w+$/.test(new URL(req.url).pathname);

const shouldRedirect = (req) => {
  const pathname = new URL(req.url).pathname;
  return isNavigationReq(req) && !pathname.endsWith('/') && !endWithExtension(req);
};

const getRedirectUrl = (req) => {
  const url = new URL(req.url);
  url.pathname += '/';
  return url.href;
};

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => cache.add('offline.html'))
      .then(() => self.skipWaiting())
      .catch((err) => console.error(err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  // blob:/data: 由页面内存生成，不可走 SW 缓存逻辑（否则会破坏手绘注释页的本地预览）
  if (requestUrl.protocol === 'blob:' || requestUrl.protocol === 'data:') {
    return;
  }

  const { hostname } = requestUrl;
  if (!HOSTNAME_WHITELIST.includes(hostname)) {
    return;
  }

  // 手绘注释页脚本需及时更新，不走 SW 缓存
  if (/\/js\/sketch-(annotate|auth)\.js/i.test(requestUrl.pathname)) {
    return;
  }

  if (shouldRedirect(event.request)) {
    event.respondWith(Response.redirect(getRedirectUrl(event.request)));
    return;
  }

  const cached = caches.match(event.request);
  const fixedUrl = getFixedUrl(event.request);
  const fetched = fetch(fixedUrl, { cache: 'no-store' });
  const fetchedCopy = fetched.then((resp) => resp.clone());

  event.respondWith(
    Promise.race([fetched.catch(() => cached), cached])
      .then((resp) => resp || fetched)
      .catch(() => caches.match('offline.html'))
  );

  event.waitUntil(
    Promise.all([fetchedCopy, caches.open(RUNTIME)])
      .then(([response, cache]) => response.ok && cache.put(event.request, response))
      .catch(() => {})
  );
});
