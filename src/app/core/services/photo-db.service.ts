import { Injectable } from '@angular/core';

export type ImageEntry = {
  id: string;
  dataUrl: string; // on garde ton format actuel (dataURL)
  mime: string;
  name: string;
};

export type PhotoItem = {
  id: string;
  client: string;
  location: string;
  note: string;
  createdAt: number;
  images: ImageEntry[];
};

@Injectable({ providedIn: 'root' })
export class PhotoDbService {
  private db!: IDBDatabase;
  private readonly DB_NAME = 'client-photos-db';
  private readonly DB_VERSION = 1;
  private readonly STORE_ITEMS = 'items';

  /** Ouvre la DB (ou la crée) */
  async init(): Promise<void> {
    if (this.db) return;
    await this.requestPersistentStorage(); // demande “non-evictable” quand dispo
    this.db = await this.openDb();
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE_ITEMS)) {
          const store = db.createObjectStore(this.STORE_ITEMS, {
            keyPath: 'id',
          });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async requestPersistentStorage() {
    try {
      // Chrome/Edge/Firefox: réduit drastiquement le risque d'éviction
      if ('storage' in navigator && 'persist' in navigator.storage) {
        await navigator.storage.persist();
      }
    } catch {
      /* noop */
    }
  }

  /** Récupère tous les items (trié desc par date) */
  async getAll(): Promise<PhotoItem[]> {
    await this.init();
    return new Promise<PhotoItem[]>((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_ITEMS, 'readonly');
      const store = tx.objectStore(this.STORE_ITEMS);
      const req = store.getAll();
      req.onsuccess = () => {
        const arr = (req.result as PhotoItem[] | undefined) ?? [];
        arr.sort((a, b) => b.createdAt - a.createdAt);
        resolve(arr);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Ajoute ou remplace un item */
  async put(item: PhotoItem): Promise<void> {
    await this.init();
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_ITEMS, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(this.STORE_ITEMS).put(item);
    });
  }

  /** Supprime un item par id */
  async delete(id: string): Promise<void> {
    await this.init();
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_ITEMS, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(this.STORE_ITEMS).delete(id);
    });
  }

  /** Remplace tout (pour import) */
  async replaceAll(items: PhotoItem[]): Promise<void> {
    await this.init();
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_ITEMS, 'readwrite');
      const store = tx.objectStore(this.STORE_ITEMS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const clearReq = store.clear();
      clearReq.onsuccess = () => {
        for (const it of items) store.put(it);
      };
    });
  }

  /** Vide la base */
  async clear(): Promise<void> {
    await this.init();
    return new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction(this.STORE_ITEMS, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(this.STORE_ITEMS).clear();
    });
  }
}
