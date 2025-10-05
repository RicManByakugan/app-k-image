import { Injectable } from '@angular/core';
import { get, set, del } from 'idb-keyval';
import {
  Client,
  Account,
  Databases,
  Storage,
  ID,
  Permission,
  Role,
  Query,
} from 'appwrite';
import { environment } from '../../../environments/environment';
import { TranslateService } from '@ngx-translate/core';
import { AlertService } from './alert.service';

const HANDLE_KEY = 'backup-dir-handle-v1';
const MODE_KEY = 'backup-mode-v1'; // 'appwrite'
const BASENAME_KEY = 'backup-basename-v1';
const DEFAULT_BASE = environment.appwrite?.displayName || 'Appwrite Cloud';

type MetaIn = {
  id: string;
  client: string;
  location: string;
  note: string;
  createdAt: number;
  images: { id: string; name: string; mime: string }[];
};

@Injectable({ providedIn: 'root' })
export class FsBackupService {
  isSupported =
    typeof window !== 'undefined' &&
    !!environment.appwrite?.endpoint &&
    !!environment.appwrite?.projectId &&
    !!environment.appwrite?.databaseId &&
    !!environment.appwrite?.collectionId &&
    !!environment.appwrite?.bucketId;

  private client = new Client();
  private account: Account;
  private db: Databases;
  private storage: Storage;

  private userId: string | null = null;

  constructor() {
    this.client
      .setEndpoint(environment.appwrite.endpoint)
      .setProject(environment.appwrite.projectId);
    this.account = new Account(this.client);
    this.db = new Databases(this.client);
    this.storage = new Storage(this.client);
  }

  // --- Session (anonyme, persistante)
  private async ensureSession(): Promise<boolean> {
    try {
      const me = await this.account.get();
      this.userId = me.$id;
      return true;
    } catch {
      try {
        await this.account.createAnonymousSession();
        const me = await this.account.get();
        this.userId = me.$id;
        return true;
      } catch {
        this.userId = null;
        return false;
      }
    }
  }

  // --- Petits helpers pour garder la même UI
  private async getMode(): Promise<'appwrite' | null> {
    return (await get(MODE_KEY)) ?? null;
  }
  private async setMode() {
    await set(MODE_KEY, 'appwrite');
  }
  private async setBaseName(name: string) {
    await set(BASENAME_KEY, name);
  }
  private async getBaseName(): Promise<string> {
    return (await get(BASENAME_KEY)) ?? DEFAULT_BASE;
  }
  private async urlToBlob(u: string | URL): Promise<Blob> {
    const res = await fetch(u.toString());
    return await res.blob();
  }

  // --- API compatible avec ton composant
  async pickFolder(): Promise<any | null> {
    if (!this.isSupported) return null;
    const ok = await this.ensureSession();
    if (!ok || !this.userId) return null;

    const baseName = `${DEFAULT_BASE} • ${this.userId.slice(0, 6)}`;
    await set(HANDLE_KEY, { userId: this.userId, name: baseName });
    await this.setMode();
    await this.setBaseName(baseName);
    return { name: baseName };
  }

  async getHandle(): Promise<any | null> {
    const mode = await this.getMode();
    if (mode !== 'appwrite') return null;
    return (await get(HANDLE_KEY)) ?? null;
  }

  async verifyHandle(): Promise<any | null> {
    if (!this.isSupported) return null;
    const ok = await this.ensureSession();
    if (!ok || !this.userId) return null;

    let h = await this.getHandle();
    if (!h) {
      const baseName = `${DEFAULT_BASE} • ${this.userId.slice(0, 6)}`;
      await set(HANDLE_KEY, { userId: this.userId, name: baseName });
      await this.setMode();
      await this.setBaseName(baseName);
      h = { name: baseName };
    }
    return h;
  }

  async clearFolder(): Promise<void> {
    const ok = await this.ensureSession();
    if (!ok || !this.userId) throw new Error('No session');

    const { databaseId, collectionId, bucketId } = environment.appwrite;

    const docs = await this.db.listDocuments(databaseId, collectionId, [
      Query.limit(1000),
      Query.orderDesc('createdAt'),
    ]);

    for (const d of docs.documents) {
      const ids: string[] = (d as any).imageIds ?? [];
      for (const fid of ids) {
        try {
          await this.storage.deleteFile(bucketId, fid);
        } catch {}
      }
      try {
        await this.db.deleteDocument(databaseId, collectionId, d.$id);
      } catch {}
    }
  }

  async writeItemTree(
    meta: MetaIn,
    blobsById: Record<string, Blob>
  ): Promise<void> {
    const ok = await this.ensureSession();
    if (!ok || !this.userId) throw new Error('No session');

    const { databaseId, collectionId, bucketId } = environment.appwrite;

    const imageIds: string[] = [];
    const imageNames: string[] = [];
    const imageMimes: string[] = [];

    const filePerms = [
      Permission.read(Role.user(this.userId)),
      Permission.update(Role.user(this.userId)),
      Permission.delete(Role.user(this.userId)),
      Permission.write(Role.user(this.userId)),
    ];

    // Upload fichiers (ID fixe = meta.images[i].id)
    for (const im of meta.images) {
      const blob = blobsById[im.id];
      if (!blob) continue;
      await this.storage.createFile(
        bucketId,
        im.id,
        new File([blob], im.name, { type: im.mime }),
        filePerms
      );
      imageIds.push(im.id);
      imageNames.push(im.name);
      imageMimes.push(im.mime);
    }

    // Document meta
    const docPerms = [
      Permission.read(Role.user(this.userId)),
      Permission.update(Role.user(this.userId)),
      Permission.delete(Role.user(this.userId)),
      Permission.write(Role.user(this.userId)),
    ];

    await this.db.createDocument(
      databaseId,
      collectionId,
      meta.id,
      {
        client: meta.client,
        location: meta.location,
        note: meta.note,
        imageIds,
        imageNames,
        imageMimes,
      },
      docPerms
    );
  }

  async getAllItems(): Promise<{ meta: any; blobs: Record<string, Blob> }[]> {
    const ok = await this.ensureSession();
    if (!ok || !this.userId) return [];

    const { databaseId, collectionId, bucketId } = environment.appwrite;
    const docs = await this.db.listDocuments(databaseId, collectionId, [
      Query.limit(1000),
      Query.orderDesc('createdAt'),
    ]);

    const out: { meta: any; blobs: Record<string, Blob> }[] = [];

    for (const d of docs.documents) {
      const imageIds: string[] = (d as any).imageIds ?? [];
      const imageNames: string[] = (d as any).imageNames ?? [];
      const imageMimes: string[] = (d as any).imageMimes ?? [];

      const meta = {
        id: d.$id,
        client: (d as any).client ?? '',
        location: (d as any).location ?? '',
        note: (d as any).note ?? '',
        createdAt: Date.parse(d.$createdAt), // <-- on prend le système
        images: imageIds.map((id, i) => ({
          id,
          name: imageNames[i] ?? 'image.jpg',
          mime: imageMimes[i] ?? 'image/jpeg',
        })),
      };

      const blobs: Record<string, Blob> = {};
      for (const fid of imageIds) {
        // miniature 320px (si indispo, fallback sur original)
        const previewUrl = this.storage.getFilePreview(
          bucketId,
          fid,
          320,
          0,
          undefined,
          70
        );
        try {
          blobs[fid] = await this.urlToBlob(previewUrl);
        } catch {
          try {
            const viewUrl = this.storage.getFileView(bucketId, fid);
            blobs[fid] = await this.urlToBlob(viewUrl);
          } catch {}
        }
      }

      out.push({ meta, blobs });
    }
    return out;
  }

  async deleteItemTree(itemId: string, imageIds: string[]): Promise<void> {
    const ok = await this.ensureSession();
    if (!ok || !this.userId) throw new Error('No session');
    const { databaseId, collectionId, bucketId } = environment.appwrite;

    for (const fid of imageIds || []) {
      try {
        await this.storage.deleteFile(bucketId, fid);
      } catch {}
    }
    try {
      await this.db.deleteDocument(databaseId, collectionId, itemId);
    } catch {}
  }

  async forgetConnection(): Promise<void> {
    try {
      await this.account.deleteSessions();
    } catch {}
    await Promise.all([del(HANDLE_KEY), del(MODE_KEY), del(BASENAME_KEY)]);
    this.userId = null;
  }

  async getRememberedBaseName(): Promise<string | null> {
    const mode = await this.getMode();
    if (mode !== 'appwrite') return null;
    try {
      return await this.getBaseName();
    } catch {
      return null;
    }
  }
}
