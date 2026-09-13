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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIdb) {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
