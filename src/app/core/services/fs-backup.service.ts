import { Injectable } from '@angular/core';
import { get, set, del, keys } from 'idb-keyval';

const HANDLE_KEY = 'backup-dir-handle-v1';
const MODE_KEY = 'backup-mode-v1'; // 'fs-access' | 'opfs' | 'idb'
const BASENAME_KEY = 'backup-basename-v1';
const DEFAULT_BASE = 'client-photos';

@Injectable({ providedIn: 'root' })
export class FsBackupService {
  isSupported =
    typeof window !== 'undefined' &&
    ('showDirectoryPicker' in window ||
      ((navigator as any).storage && (navigator as any).storage.getDirectory) ||
      true);

  private async getMode(): Promise<'fs-access' | 'opfs' | 'idb' | null> {
    return (await get(MODE_KEY)) ?? null;
  }
  private async setMode(m: 'fs-access' | 'opfs' | 'idb') {
    await set(MODE_KEY, m);
  }
  private async setBaseName(name: string) {
    await set(BASENAME_KEY, name);
  }
  private async getBaseName(): Promise<string> {
    return (await get(BASENAME_KEY)) ?? DEFAULT_BASE;
  }

  async pickFolder(): Promise<any | null> {
    if ('showDirectoryPicker' in window) {
      const dir = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      await set(HANDLE_KEY, dir);
      await this.setMode('fs-access');
      await this.setBaseName((dir as any).name ?? DEFAULT_BASE);
      try {
        await (navigator as any).storage?.persist?.();
      } catch {}
      return dir;
    }
    const opfs = (navigator as any).storage?.getDirectory;
    if (opfs) {
      const root = await (navigator as any).storage.getDirectory();
      const baseName = DEFAULT_BASE;
      const baseDir = await root.getDirectoryHandle(baseName, { create: true });
      await set(HANDLE_KEY, baseDir);
      await this.setMode('opfs');
      await this.setBaseName(baseName);
      return baseDir;
    }
    await this.setMode('idb');
    await this.setBaseName(DEFAULT_BASE);
    return { name: DEFAULT_BASE };
  }

  async getHandle(): Promise<any | null> {
    const mode = await this.getMode();
    if (!mode) return null;
    if (mode === 'fs-access' || mode === 'opfs') {
      const h = await get(HANDLE_KEY).catch(() => null);
      return h ?? null;
    }
    return { name: await this.getBaseName() };
  }

  async verifyHandle(): Promise<any | null> {
    const mode = await this.getMode();
    if (!mode) return null;

    if (mode === 'fs-access') {
      const dir = await this.getHandle();
      if (!dir) return null;
      try {
        const q = await (dir as any).queryPermission?.({ mode: 'readwrite' });
        if (q !== 'granted') {
          const r = await (dir as any).requestPermission?.({
            mode: 'readwrite',
          });
          if (r !== 'granted') return null;
        }
      } catch {}
      try {
        const it = (dir as any).entries?.();
        if (it && it[Symbol.asyncIterator]) {
          for await (const _ of it) break;
        }
        return dir;
      } catch {
        return null;
      }
    }

    if (mode === 'opfs') {
      try {
        const root = await (navigator as any).storage.getDirectory();
        const baseName = await this.getBaseName();
        const dir = await root.getDirectoryHandle(baseName, { create: true });
        const it = (dir as any).entries?.();
        if (it && it[Symbol.asyncIterator]) {
          for await (const _ of it) break;
        }
        await set(HANDLE_KEY, dir);
        return dir;
      } catch {
        return null;
      }
    }

    if (mode === 'idb') {
      return { name: await this.getBaseName() };
    }
    return null;
  }

  async clearFolder(): Promise<void> {
    const mode = await this.getMode();
    if (!mode) throw new Error('No mode');

    if (mode === 'fs-access' || mode === 'opfs') {
      const dir = await this.verifyHandle();
      if (!dir) throw new Error('No folder selected');
      // @ts-ignore
      for await (const [name] of (dir as any).entries()) {
        await dir.removeEntry(name, { recursive: true });
      }
      return;
    }

    // idb
    const ks = await keys();
    const toDelete: any[] = [];
    for (const k of ks) {
      if (
        typeof k === 'string' &&
        (k.startsWith('meta:') || k.startsWith('blob:'))
      ) {
        toDelete.push(k);
      }
    }
    await Promise.all(toDelete.map((k) => del(k)));
  }

  async writeItemTree(
    meta: {
      id: string;
      client: string;
      location: string;
      note: string;
      createdAt: number;
      images: { id: string; name: string; mime: string }[];
    },
    blobsById: Record<string, Blob>
  ): Promise<void> {
    const mode = await this.getMode();
    if (!mode) throw new Error('No base configured');

    if (mode === 'fs-access' || mode === 'opfs') {
      const base = await this.verifyHandle();
      if (!base) throw new Error('No folder selected');

      const itemDir = await base.getDirectoryHandle(meta.id, { create: true });
      const metaFile = await itemDir.getFileHandle('meta.json', {
        create: true,
      });
      let w = await metaFile.createWritable();
      await w.write(
        new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
      );
      await w.close();

      const imgsDir = await itemDir.getDirectoryHandle('images', {
        create: true,
      });
      for (const im of meta.images) {
        const ext = this.extFromMime(im.mime) ?? 'jpg';
        const fh = await imgsDir.getFileHandle(`${im.id}.${ext}`, {
          create: true,
        });
        const ww = await fh.createWritable();
        await ww.write(blobsById[im.id]);
        await ww.close();
      }
      return;
    }

    // idb
    await set(`meta:${meta.id}`, meta);
    await Promise.all(
      meta.images.map((im) => set(`blob:${meta.id}:${im.id}`, blobsById[im.id]))
    );
  }

  /** NOUVEAU : lit tous les items depuis la base (meta + blobs) */
  async getAllItems(): Promise<{ meta: any; blobs: Record<string, Blob> }[]> {
    const mode = await this.getMode();
    if (!mode) return [];

    if (mode === 'fs-access' || mode === 'opfs') {
      const base = await this.verifyHandle();
      if (!base) return [];

      const results: { meta: any; blobs: Record<string, Blob> }[] = [];
      // @ts-ignore
      for await (const [name, handle] of (base as any).entries()) {
        // on ne prend que les dossiers (items)
        // certains navigateurs n'ont pas handle.kind => on tente quand même
        const itemDir =
          handle?.kind === 'directory'
            ? handle
            : await base.getDirectoryHandle(name).catch(() => null);
        if (!itemDir) continue;

        // meta.json
        let meta: any | null = null;
        try {
          const metaHandle = await itemDir.getFileHandle('meta.json', {
            create: false,
          });
          const metaFile = await metaHandle.getFile();
          const text = await metaFile.text();
          meta = JSON.parse(text);
        } catch {
          continue; // pas de meta -> ignorer
        }

        // images blobs
        const blobs: Record<string, Blob> = {};
        try {
          const imgsDir = await itemDir.getDirectoryHandle('images', {
            create: false,
          });
          for (const im of meta.images ?? []) {
            const ext = this.extFromMime(im.mime) ?? 'jpg';
            try {
              const fh = await imgsDir.getFileHandle(`${im.id}.${ext}`, {
                create: false,
              });
              const file = await fh.getFile();
              blobs[im.id] = file; // File est un Blob
            } catch {
              // ignore missing
            }
          }
        } catch {
          // aucun dossier images -> ok
        }

        results.push({ meta, blobs });
      }
      return results;
    }

    // idb
    return await this.readAllFromIdb();
  }

  /** util idb (fallback) */
  private async readAllFromIdb(): Promise<
    { meta: any; blobs: Record<string, Blob> }[]
  > {
    const out: { meta: any; blobs: Record<string, Blob> }[] = [];
    const ks = await keys();
    const metas: string[] = ks.filter(
      (k: any) => typeof k === 'string' && k.startsWith('meta:')
    ) as string[];

    for (const mk of metas) {
      const meta = await get(mk);
      const blobs: Record<string, Blob> = {};
      for (const im of meta.images ?? []) {
        const b = await get(`blob:${meta.id}:${im.id}`).catch(() => null);
        if (b) blobs[im.id] = b as Blob;
      }
      out.push({ meta, blobs });
    }
    return out;
  }

  private extFromMime(mime: string | undefined): string | null {
    if (!mime) return null;
    if (mime.includes('jpeg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return null;
  }
}
