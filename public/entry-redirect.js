/*
 * 入口纠正（由 `vite.config.ts` 的 `workbox.importScripts` 注入，**排在 workbox 之前**执行）。
 *
 * ## 为什么需要它
 * 线上 `/index.html` 这一条路径上，服务器给的一直是 **2026-09-15 那一版**的旧包
 * （实测：该响应的 Last-Modified 就是 `15 Sep 2026 11:40:31`，内容引用 `index-DCs-mNb3.js`），
 * 而每次部署都刷不到它 —— 根路径 `/` 是新的，`/index.html` 是死的。
 *
 * 而这一版旧包的「有新版本」按钮**点了没有用**（它的更新逻辑还处在 `reload()` 死循环形态），
 * 于是从这条路径进来的玩家，**怎么刷新都出不去**。用户已经被它卡住三次。
 *
 * ## 做法
 * 把 `/index.html` 的**导航请求**改写成根路径 `/`，直接去拿真正的那份入口。
 * 这个监听器在 workbox 之前注册，所以 `respondWith` 由我们赢；
 * 其余请求一律不动，交给 workbox 照常处理。
 *
 * ## 安全
 * 全部包在 try/catch 里：这里出任何错都不能连累 SW 安装 ——
 * 最坏情况只是这条纠正不生效，页面本身照常打开。
 */
self.addEventListener('fetch', function (event) {
  try {
    var req = event.request;
    // 只管导航（打开页面 / 刷新 / 前进后退），别碰资源请求
    if (!req || req.mode !== 'navigate') return;
    var url = new URL(req.url);
    if (!/\/index\.html$/.test(url.pathname)) return;
    // 换成根路径，并带时间戳绕开任何一层缓存
    url.pathname = url.pathname.replace(/\/index\.html$/, '/');
    url.searchParams.set('_v', Date.now().toString(36));
    event.respondWith(
      fetch(url.toString(), { cache: 'no-store' }).catch(function () {
        return fetch(req);
      })
    );
  } catch (e) {
    /* 尽力而为：纠正失败就让 workbox 走它自己的流程 */
  }
});
