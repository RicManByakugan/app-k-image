import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

type ImageMeta = { id: string; name: string; mime: string };
type ImageEntry = { id: string; dataUrl: string; mime: string; name: string };

type PhotoItem = {
  id: string;
  client: string;
  location: string;
  note: string;
  createdAt: number;
  images: ImageEntry[];
};

@Injectable({ providedIn: 'root' })
export class PhotoCloudService {
  readonly isEnabled: boolean;
  private readonly bucket: string;
  private readonly table: string;
  private readonly sb: SupabaseClient | null;

  constructor() {
    const cfg = (environment as any)?.supabase || {};
    this.isEnabled = !!cfg.url && !!cfg.anonKey;
    this.bucket = cfg.bucket || 'photos';
    this.table = cfg.table || 'photos';
    this.sb = this.isEnabled ? createClient(cfg.url, cfg.anonKey) : null;
  }

  /** Upload images (in parallel) and upsert/merge row. */
  async upsertPhoto(
    meta: {
      id: string;
      client: string;
      location: string;
      note: string;
      createdAt: number;
      images: ImageMeta[];
    },
    blobsById: Record<string, Blob>
  ): Promise<void> {
    if (!this.sb) return;

    // 1) Upload all images in parallel
    await Promise.all(
      meta.images.map(async (im) => {
        const path = `${meta.id}/${im.id}.${this.extFromMime(im.mime)}`;
        const blob = blobsById[im.id];
        if (!blob) return;
        const { error: uErr } = await this.sb!.storage.from(this.bucket).upload(
          path,
          blob,
          { contentType: im.mime, upsert: true }
        );
        if (uErr) throw uErr;
      })
    );

    // 2) Merge with existing images (fixes “only one image saved”)
    const { data: existing } = await this.sb
      .from(this.table)
      .select('images')
      .eq('id', meta.id)
      .maybeSingle();

    const oldImages: ImageMeta[] = Array.isArray(existing?.images)
      ? (existing!.images as ImageMeta[])
      : [];

    const merged = this.mergeImages(oldImages, meta.images);

    // 3) Upsert the full row
    const row = {
      id: meta.id,
      client: meta.client,
      location: meta.location,
      note: meta.note,
      created_at: meta.createdAt, // bigint or timestamp column
      images: merged, // jsonb array
    };

    const { error } = await this.sb
      .from(this.table)
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
  }

  /** Read all items and resolve public URLs. */
  async listPhotos(): Promise<PhotoItem[]> {
    if (!this.sb) return [];
    const { data, error } = await this.sb
      .from(this.table)
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) return [];

    return (data as any[]).map((d) => {
      const metaImages: ImageMeta[] = Array.isArray(d.images) ? d.images : [];
      const images: ImageEntry[] = metaImages.map((im) => {
        const path = `${d.id}/${im.id}.${this.extFromMime(im.mime)}`;
        const { data: pub } = this.sb!.storage.from(this.bucket).getPublicUrl(
          path
        );
        return {
          id: im.id,
          name: im.name || 'image.jpg',
          mime: im.mime || 'image/jpeg',
          dataUrl: pub.publicUrl,
        };
      });

      return {
        id: String(d.id),
        client: d.client || '',
        location: d.location || '',
        note: d.note || '',
        createdAt:
          typeof d.created_at === 'number'
            ? d.created_at
            : Date.parse(
                d.created_at || d.createdAt || new Date().toISOString()
              ),
        images,
      };
    });
  }

  /** Delete one item + its images. */
  async deletePhoto(
    id: string,
    images: { id: string; mime: string }[]
  ): Promise<void> {
    if (!this.sb) return;

    const paths = images.map(
      (im) => `${id}/${im.id}.${this.extFromMime(im.mime)}`
    );
    if (paths.length) {
      await this.sb.storage.from(this.bucket).remove(paths);
    }

    const { error } = await this.sb.from(this.table).delete().eq('id', id);
    if (error) throw error;
  }

  /** Danger: delete everything. */
  async clearAll(): Promise<void> {
    if (!this.sb) return;
    const { data } = await this.sb.from(this.table).select('id, images');
    const all = (data as any[]) || [];

    const allPaths: string[] = [];
    for (const row of all) {
      const imgs: ImageMeta[] = Array.isArray(row.images) ? row.images : [];
      imgs.forEach((im) => {
        allPaths.push(`${row.id}/${im.id}.${this.extFromMime(im.mime)}`);
      });
    }
    if (allPaths.length)
      await this.sb.storage.from(this.bucket).remove(allPaths);
    await this.sb.from(this.table).delete().neq('id', ''); // delete all rows
  }

  private mergeImages(
    existing: ImageMeta[],
    incoming: ImageMeta[]
  ): ImageMeta[] {
    const byId = new Map<string, ImageMeta>();
    for (const im of existing) byId.set(im.id, im);
    for (const im of incoming) byId.set(im.id, im); // overwrite/insert
    return Array.from(byId.values());
  }

  private extFromMime(mime: string | undefined): string {
    if (!mime) return 'jpg';
    if (mime.includes('jpeg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'jpg';
  }
}
