// 保存層: 端末内(IndexedDB)に単語帳の全体を置く。規則は Docs/22_Storage.md。
// 置く形はバックアップと同じ(core/backup.js の toBackup)で、読むときも同じ読み手(readBackup)を通す。
// こうすると、保存した中身も INV-3(過去の版をすべて読める)の対象になる。
// IndexedDB の実体は引数で受け取る(ブラウザでは indexedDB、Node のテストでは fake-indexeddb)。

import { toBackup, readBackup } from '../core/backup.js';
import { emptyBook } from '../core/book.js';

/** @typedef {import('../core/book.js').Book} Book */

export const DB_NAME = 'tango-drill';
const DB_VERSION = 1;
const STORE = 'kv';
/** 今の単語帳 */
const BOOK = 'book';
/** 復元(C1)の直前の単語帳。次の復元まで残し、元に戻すと消す。値 null は「復元の直前に何も保存されていなかった」 */
const UNDO = 'undo';
/** 設定。単語帳とは別に置き、バックアップには入れない(端末ごとの好み) */
const SETTINGS = 'settings';

/**
 * 設定。項目を足すときは DEFAULT_SETTINGS にも足す(保存してある古い設定に無い項目は既定値で補う)。
 * @typedef {object} Settings
 * @property {boolean} useBuiltin 4 択の誤答に内蔵語彙を使う(Docs/21_Quiz.md §1)
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({ useBuiltin: true });

/**
 * @typedef {object} StorageOptions
 * @property {string} [name] データベース名(既定: DB_NAME)
 * @property {() => string} [now] 保存した日時(ISO 8601)を返す。既定は現在時刻
 */

/**
 * @typedef {object} Loaded
 * @property {Book} book
 * @property {string[]} warnings 読み手が知らせること(版の違いで捨てた項目など)
 */

/**
 * @typedef {object} Storage
 * @property {(today: string) => Promise<Loaded>} load 何も保存されていなければ空の単語帳を返す
 * @property {(book: Book) => Promise<void>} save
 * @property {(book: Book) => Promise<void>} restore 今の単語帳を退避してから、渡した単語帳で置き換える(C1)
 * @property {() => Promise<boolean>} canUndo 復元の直前の単語帳が退避してあるか
 * @property {() => Promise<void>} undoRestore 退避した単語帳に戻し、退避を消す。復元のあとの変更は消える
 * @property {() => Promise<Settings>} loadSettings 保存してある設定。無い項目・型の違う項目は既定値で補う
 * @property {(settings: Settings) => Promise<void>} saveSettings
 * @property {() => void} close
 */

/**
 * @param {IDBFactory} factory
 * @param {StorageOptions} [opts]
 * @returns {Promise<Storage>}
 */
export async function openStorage(factory, opts = {}) {
  const now = opts.now ?? (() => new Date().toISOString());
  const db = await openDb(factory, opts.name ?? DB_NAME);

  return {
    async load(today) {
      const raw = await get(db, BOOK);
      if (raw === undefined) return { book: emptyBook(), warnings: [] };
      const r = readBackup(raw, { today });
      // 読めない中身を空の単語帳として扱うと、次の保存で上書きして失う。読めないことを呼ぶ側に伝える
      if (r.fatal !== undefined || !r.book) throw new Error('保存してある単語帳が読めません: ' + r.fatal);
      return { book: r.book, warnings: r.warnings };
    },

    async save(book) {
      await write(db, (s) => {
        s.put(toBackup(book, now()), BOOK);
      });
    },

    async restore(book) {
      await write(db, (s) => {
        const req = s.get(BOOK);
        req.onsuccess = () => {
          s.put(req.result === undefined ? null : req.result, UNDO);
          s.put(toBackup(book, now()), BOOK);
        };
      });
    },

    async canUndo() {
      return (await get(db, UNDO)) !== undefined;
    },

    async undoRestore() {
      let missing = false;
      try {
        await write(db, (s) => {
          const req = s.get(UNDO);
          req.onsuccess = () => {
            const prev = req.result;
            if (prev === undefined) {
              missing = true;
              s.transaction.abort();
              return;
            }
            if (prev === null) s.delete(BOOK);
            else s.put(prev, BOOK);
            s.delete(UNDO);
          };
        });
      } catch (e) {
        if (missing) throw new Error('元に戻す単語帳がありません');
        throw e;
      }
    },

    async loadSettings() {
      const raw = await get(db, SETTINGS);
      /** @type {Settings} */
      const out = { ...DEFAULT_SETTINGS };
      if (typeof raw === 'object' && raw !== null) {
        for (const k of /** @type {(keyof Settings)[]} */ (Object.keys(DEFAULT_SETTINGS))) {
          const v = /** @type {Record<string, unknown>} */ (raw)[k];
          if (typeof v === typeof DEFAULT_SETTINGS[k]) out[k] = /** @type {any} */ (v);
        }
      }
      return out;
    },

    async saveSettings(settings) {
      await write(db, (s) => {
        s.put({ ...settings }, SETTINGS);
      });
    },

    close() {
      db.close();
    },
  };
}

/**
 * @param {IDBFactory} factory
 * @param {string} name
 * @returns {Promise<IDBDatabase>}
 */
function openDb(factory, name) {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('他のタブがデータベースを使っているため開けません'));
  });
}

/**
 * @param {IDBDatabase} db
 * @param {string} key
 * @returns {Promise<unknown>}
 */
function get(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 1 つのトランザクションで書く。全部書けるか、何も書かないかのどちらかになる。
 * @param {IDBDatabase} db
 * @param {(store: IDBObjectStore) => void} body
 * @returns {Promise<void>}
 */
function write(db, body) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('保存を取り消しました'));
    body(tx.objectStore(STORE));
  });
}
