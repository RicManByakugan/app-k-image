import { Injectable, Pipe, PipeTransform } from '@angular/core';

export type ImageEntry = {
  id: string;
  dataUrl: string; // image compressée
  mime: string;
  name: string;
  fp: string; // empreinte pour détection doublon
};

export type PhotoItem = {
  id: string;
  client: string;
  location: string;
  note: string;
  createdAt: number;
  images: ImageEntry[];
};

export type NewPhotoItem = {
  client: string;
  location: string;
  note?: string;
  files: File[];
};

type ExportPayload = {
  kind: 'client-photos.v1';
  exportedAt: number;
  items: PhotoItem[];
};

@Injectable({ providedIn: 'root' })
export class PhotoStoreService {
  private readonly KEY = 'client-photos-v1';

  readAll(): PhotoItem[] {
    try {
      const raw = localStorage.getItem(this.KEY);
      const arr = raw ? (JSON.parse(raw) as PhotoItem[]) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  writeAll(items: PhotoItem[]) {
    localStorage.setItem(this.KEY, JSON.stringify(items));
  }

  async filesToImages(
    files: File[],
    maxDim = 1280,
    quality = 0.8
  ): Promise<ImageEntry[]> {
    const out: ImageEntry[] = [];
    for (const f of files) {
      const dataUrl = await this.resizeToDataURL(f, maxDim, quality);
      const fp = this.fingerprint(dataUrl);
      out.push({
        id: crypto.randomUUID(),
        dataUrl,
        mime: f.type || 'image/jpeg',
        name: f.name || 'image',
        fp,
      });
    }
    return out;
  }

  exportAll(items: PhotoItem[]) {
    const payload: ExportPayload = {
      kind: 'client-photos.v1',
      exportedAt: Date.now(),
      items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `client-photos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async parseImport(file: File): Promise<PhotoItem[]> {
    const text = await file.text();
    const json = JSON.parse(text);
    if (
      !json ||
      json.kind !== 'client-photos.v1' ||
      !Array.isArray(json.items)
    ) {
      throw new Error('Unsupported file format');
    }
    return json.items as PhotoItem[];
  }

  // --- Utils ---
  private async resizeToDataURL(
    file: File,
    maxDim: number,
    quality: number
  ): Promise<string> {
    const img = await this.loadImage(file);
    const { w, h } = this.fit(img.width, img.height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    // Utiliser JPEG pour compresser
    return canvas.toDataURL('image/jpeg', quality);
  }

  private fit(w: number, h: number, maxDim: number) {
    if (w <= maxDim && h <= maxDim) return { w, h };
    const r = w > h ? maxDim / w : maxDim / h;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  }

  private loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('file read error'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image decode error'));
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  /** Empreinte rapide (taille + 32 premiers + 32 derniers chars du base64) */
  private fingerprint(dataUrl: string): string {
    const b64 = dataUrl.split(',')[1] || dataUrl;
    const len = b64.length;
    const head = b64.slice(0, 32);
    const tail = b64.slice(-32);
    return `${len}-${head}-${tail}`;
  }
}

/** Pipe utilitaire pour preview File -> dataURL (sans compression) */
@Pipe({ name: 'filePreview', standalone: true })
export class FilePreviewPipe implements PipeTransform {
  transform(file: File | null): string | null {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    return url;
  }
}
