/**
 * 通用 IndexedDB 键值存储
 *
 * 为什么需要它：生图接口返回的是 base64 data URI，一张动辄几百 KB。
 * 全塞 localStorage（约 5MB 上限）会直接超配额、保存静默失败——
 * 表现就是"场景立绘莫名其妙消失了"。图片这类大件必须走 IndexedDB。
 */

const DB_NAME = 'trpg-store';
const STORE = 'kv';

/** 环境是否支持 IndexedDB（单测 / 老旧浏览器里没有这个全局） */
const hasIdb = typeof indexedDB !== 'undefined';

/*
 * 连接**只开一次**（协作方 §五 性能三连 ②）。
 *
 * 为什么原来那样不行：`indexedDB.open()` 每次都要走一遍"打开请求 → 版本检查 → 建事务"，
 * 而 `idbSet` 是一张图一次调用 —— 一个回合连着生几张图，就是几趟完整的开库流程，
 * 主线程被这些往返一段段掐住，表现是**生图那几秒界面明显发涩**。
 * 连上一个之后，后续读写只是开个事务，便宜得多。
 *
 * 缓存的是 **Promise** 而不是 db：并发调用会共用同一个"正在打开"的结果，
 * 不会各开各的（也就不会撞上"同一个库被开两次"的版本竞态）。
 *
 * 两种失效必须处理，否则会拿着一个死连接一直用下去：
 * - 打开失败 → 丢掉缓存，下次重试（否则一次失败就永久不可用）；
 * - 连接被关掉 / 别处要升版本 → 丢掉缓存（`onclose` / `onversionchange`）。
 *   后者常见于"另一个标签页改了库结构"——这时必须主动 `close()` 让出，
 *   否则那个标签页会一直卡在 `blocked` 上。
 */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIdb) {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // 让出连接：另一个标签页要升版本时，我们不能再占着
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    // 失败的 Promise 不能留在缓存里，否则以后每次都直接拿到这个失败
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // 存不下也要让界面继续用内存里的那份，不能整个崩掉。
    // 环境本来就没有 IndexedDB 时（单测）不必刷警告。
    if (hasIdb) console.warn('[跑团] IndexedDB 写入失败', key, e);
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
}
