import { Injectable } from '@angular/core';

type DirHandle = FileSystemDirectoryHandle;

@Injectable({ providedIn: 'root' })
export class FsBackupService {
  private db!: IDBDatabase;
  private readonly DB_NAME = 'client-photos-fs';
  private readonly DB_VERSION = 1;
  private readonly STORE = 'handle';
  private readonly KEY = 'root';

  /** FS Access supporté ? (Chrome/Edge/Android ok, iOS Safari nope) */
  get isSupported() {
    return 'showDirectoryPicker' in window;
  }

  /** Ouvre la DB (pour stocker le handle) */
  private openDb(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE);
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Sauvegarde le handle en IDB (structured clone) */
  private async saveHandle(handle: DirHandle) {
    const db = await this.openDb();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(this.STORE).put(handle as any, this.KEY);
    });
  }

  /** Récupère le handle depuis IDB (ou null) */
  async getHandle(): Promise<DirHandle | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(this.KEY);
      req.onsuccess = () => resolve((req.result as DirHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Demande de permission (read ou readwrite) */
  async ensurePermission(
    handle: DirHandle,
    mode: 'read' | 'readwrite' = 'readwrite'
  ) {
    // @ts-ignore
    const opts = { mode };
    // @ts-ignore
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    // @ts-ignore
    return (await handle.requestPermission(opts)) === 'granted';
  }

  /** Ouvre le selecteur de dossier et stocke le handle */
  async pickFolder(): Promise<DirHandle | null> {
    if (!this.isSupported) return null;
    // @ts-ignore
    const handle = (await (window as any).showDirectoryPicker?.()) as DirHandle;
    if (!handle) return null;
    const ok = await this.ensurePermission(handle, 'readwrite');
    if (!ok) return null;
    await this.saveHandle(handle);
    return handle;
  }

  /** Écrit un fichier texte/JSON */
  private async writeText(dir: DirHandle, name: string, content: string) {
    const file = await dir.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(content);
    await w.close();
  }

  /** Écrit un fichier binaire (Blob) */
  private async writeBlob(dir: DirHandle, name: string, blob: Blob) {
    const file = await dir.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(blob);
    await w.close();
  }

  /** Crée (items/<itemId>/...) et écrit meta + images */
  async writeItemTree(
    item: {
      id: string;
      client: string;
      location: string;
      note: string;
      createdAt: number;
      images: { id: string; name: string; mime: string }[];
    },
    blobsById: Record<string, Blob> // imageId -> Blob (JPEG)
  ): Promise<void> {
    const root = await this.getHandle();
    if (!root) return;

    const ok = await this.ensurePermission(root, 'readwrite');
    if (!ok) return;

    const itemsDir = await root.getDirectoryHandle('items', { create: true });
    const itemDir = await itemsDir.getDirectoryHandle(item.id, {
      create: true,
    });

    // meta.json
    const meta = {
      id: item.id,
      client: item.client,
      location: item.location,
      note: item.note,
      createdAt: item.createdAt,
      images: item.images.map((im, idx) => ({
        id: im.id,
        name: im.name || `image-${idx + 1}.jpg`,
        mime: im.mime || 'image/jpeg',
        file: `img-${idx + 1}.jpg`,
      })),
    };
    await this.writeText(itemDir, 'meta.json', JSON.stringify(meta, null, 2));

    // images
    for (let i = 0; i < item.images.length; i++) {
      const im = item.images[i];
      const blob = blobsById[im.id];
      if (!blob) continue;
      await this.writeBlob(itemDir, `img-${i + 1}.jpg`, blob);
    }
  }

  /** Supprime tout le contenu du dossier root (items/...) */
  async clearFolder(): Promise<void> {
    const root = await this.getHandle();
    if (!root) return;
    const ok = await this.ensurePermission(root, 'readwrite');
    if (!ok) return;

    // Supprimer récursivement tout
    // @ts-ignore removeEntry est sur le parent
    for await (const [name] of (root as any).entries?.() ?? []) {
      // @ts-ignore
      await root.removeEntry(name, { recursive: true });
    }
  }
}
