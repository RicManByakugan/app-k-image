import { Injectable } from '@angular/core';
import { get, set, del, keys } from 'idb-keyval';

const HANDLE_KEY = 'backup-dir-handle-v1';
const MODE_KEY = 'backup-mode-v1'; // 'fs-access' | 'opfs' | 'idb'
const BASENAME_KEY = 'backup-basename-v1'; // ex: 'client-photos'
const DEFAULT_BASE = 'client-photos';

/**
 * Service de “BD locale” :
 * - Mode A (Chromium): File System Access API avec showDirectoryPicker (handle persistant en IndexedDB)
 * - Mode B (fallback): OPFS (Origin Private File System) via navigator.storage.getDirectory()
 * - Mode C (fallback ultime): IndexedDB (stockage clé/valeur) simulant l’arborescence
 *
 * Interface publique utilisée par HomeComponent :
 *  - isSupported: boolean (au moins un mode dispo)
 *  - pickFolder(): Promise<any>         -> configure/choisit la “base”
 *  - getHandle(): Promise<any | null>   -> récupère le handle ou un stub (avec .name)
 *  - verifyHandle(): Promise<any | null>-> revalide (permission + existence)
 *  - clearFolder(): Promise<void>       -> supprime le contenu (pas la base)
 *  - writeItemTree(meta, blobs): Promise<void> -> écrit un dossier d’item
 */
@Injectable({ providedIn: 'root' })
export class FsBackupService {
  // Support minimal : si on a *au moins* FS Access ou OPFS ou IndexedDB, on peut fonctionner
  isSupported =
    typeof window !== 'undefined' &&
    ('showDirectoryPicker' in window ||
      ((navigator as any).storage && (navigator as any).storage.getDirectory) ||
      true); // IndexedDB est dispo via idb-keyval

  /** --- MODE UTILS --- */
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

  /** --- PICK FOLDER --- */
  async pickFolder(): Promise<any | null> {
    // A) FS Access -> vrai dossier utilisateur
    if ('showDirectoryPicker' in window) {
      const dir = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });
      await set(HANDLE_KEY, dir);
      await this.setMode('fs-access');
      await this.setBaseName((dir as any).name ?? DEFAULT_BASE);
      // Demande à persister le storage (meilleure rétention mobile)
      try {
        await (navigator as any).storage?.persist?.();
      } catch {}
      return dir;
    }

    // B) OPFS -> “dossier privé” de l’origine (pas visible par l’utilisateur)
    const opfs = (navigator as any).storage?.getDirectory;
    if (opfs) {
      const root = await (navigator as any).storage.getDirectory();
      // on crée/retient un sous-dossier pour la “base”
      const baseName = DEFAULT_BASE;
      const baseDir = await root.getDirectoryHandle(baseName, { create: true });
      await set(HANDLE_KEY, baseDir);
      await this.setMode('opfs');
      await this.setBaseName(baseName);
      return baseDir;
    }

    // C) Fallback IndexedDB
    await this.setMode('idb');
    await this.setBaseName(DEFAULT_BASE);
    return { name: DEFAULT_BASE }; // stub
  }

  /** Retourne le handle/stub courant ou null */
  async getHandle(): Promise<any | null> {
    const mode = await this.getMode();
    if (!mode) return null;

    if (mode === 'fs-access' || mode === 'opfs') {
      const h = await get(HANDLE_KEY).catch(() => null);
      if (h) return h;
      return null;
    }

    // idb stub
    return { name: await this.getBaseName() };
  }

  /** Vérifie permission/existence ; renvoie le handle prêt à l’emploi ou null */
  async verifyHandle(): Promise<any | null> {
    const mode = await this.getMode();
    if (!mode) return null;

    if (mode === 'fs-access') {
      const dir = await this.getHandle();
      if (!dir) return null;

      // Permission RW
      try {
        const q = await (dir as any).queryPermission?.({ mode: 'readwrite' });
        if (q !== 'granted') {
          const r = await (dir as any).requestPermission?.({
            mode: 'readwrite',
          });
          if (r !== 'granted') return null;
        }
      } catch {
        // certains navigateurs n’ont pas ces méthodes
      }

      // Probe existence
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
      // On tente de récupérer la base depuis OPFS root
      try {
        const root = await (navigator as any).storage.getDirectory();
        const baseName = await this.getBaseName();
        const dir = await root.getDirectoryHandle(baseName, { create: true });
        // probe
        const it = (dir as any).entries?.();
        if (it && it[Symbol.asyncIterator]) {
          for await (const _ of it) break;
        }
        // sauvegarder le “handle” opfs pour cohérence
        await set(HANDLE_KEY, dir);
        return dir;
      } catch {
        return null;
      }
    }

    if (mode === 'idb') {
      // IndexedDB : rien à vérifier, la “base” existe tant que l’origine existe
      return { name: await this.getBaseName() };
    }

    return null;
  }

  /** Supprime tout le contenu de la base (sans supprimer la base elle-même) */
  async clearFolder(): Promise<void> {
    const mode = await this.getMode();
    if (!mode) throw new Error('No mode');

    if (mode === 'fs-access' || mode === 'opfs') {
      const dir = await this.verifyHandle();
      if (!dir) throw new Error('No folder selected');

      // supprimer tous les enfants
      // @ts-ignore types non standard
      for await (const [name] of (dir as any).entries()) {
        await dir.removeEntry(name, { recursive: true });
      }
      return;
    }

    // idb : on supprime toutes les clés qui appartiennent à notre “base”
    // Clés utilisées : meta:<itemId> et blob:<itemId>:<imgId>
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

  /**
   * Ecrit un item :
   *  - crée /meta.json
   *  - crée /images/<imgId>.(jpg/…) à partir de blobsById
   */
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

      // item dir
      const itemDir = await base.getDirectoryHandle(meta.id, { create: true });

      // meta.json
      const metaFile = await itemDir.getFileHandle('meta.json', {
        create: true,
      });
      let w = await metaFile.createWritable();
      await w.write(
        new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
      );
      await w.close();

      // images/
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

    // IndexedDB fallback : stocker meta + blobs
    await set(`meta:${meta.id}`, meta);
    const promises: Promise<any>[] = [];
    for (const im of meta.images) {
      const blob = blobsById[im.id];
      promises.push(set(`blob:${meta.id}:${im.id}`, blob));
    }
    await Promise.all(promises);
  }

  /** Utilitaire pour lire meta+images depuis IndexedDB (fallback) si besoin */
  async readAllFromIdb(): Promise<
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
