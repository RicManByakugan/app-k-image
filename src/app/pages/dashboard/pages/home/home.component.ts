import {
  Component,
  inject,
  signal,
  computed,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../../shared/layout/main/header/header.component';
import { FooterComponent } from '../../../../shared/layout/main/footer/footer.component';
import { AlertService } from '../../../../core/services/alert.service';
import { customer, location } from '../../../../core/const/suggestion';
import { PhotoCloudService } from '../../../../core/services/photo-cloud.service';

type ImageEntry = { id: string; dataUrl: string; mime: string; name: string };
type PhotoItem = {
  id: string;
  client: string;
  location: string;
  note: string;
  createdAt: number;
  images: ImageEntry[];
};
type Draft = { client: string; location: string; note: string; files: File[] };

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    HeaderComponent,
    FooterComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent {
  private t = inject(TranslateService);
  private alerts = inject(AlertService);
  private cloud = inject(PhotoCloudService);

  actionLoading = false;
  clearingAll = false;

  // NEW: loader for cloud fetches
  loadingItems = signal(false);

  // UI prefs (grid only)
  gridCols: number = this.readGridCols();
  get isGallery(): boolean {
    return this.gridCols >= 5;
  }

  isDragging = signal(false);
  isAddOpen = signal(false);

  items = signal<PhotoItem[]>([]);
  selectedDateFilter = signal<string | null>(null);

  suggestions = { customers: customer, locations: location };
  draft = signal<Draft>({ client: '', location: '', note: '', files: [] });

  constructor() {
    this.refreshFromCloud();
  }

  private async refreshFromCloud() {
    this.loadingItems.set(true);
    try {
      const remote = await this.cloud.listPhotos();
      this.items.set(remote);
    } catch (e) {
      console.warn('Cloud load failed:', e);
      await this.alerts.alert(
        this.t.instant('HOME.BACKUP.LOAD_ERR') || 'Load failed'
      );
    } finally {
      this.loadingItems.set(false);
    }
  }

  // ---- images helpers (unchanged) ----
  private loadImage(fileOrBlob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('file read error'));
      fr.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image decode error'));
        img.src = fr.result as string;
        (img as any).decoding = 'async';
      };
      fr.readAsDataURL(fileOrBlob);
    });
  }
  private fit(w: number, h: number, maxDim: number) {
    if (w <= maxDim && h <= maxDim) return { w, h };
    const r = w > h ? maxDim / w : maxDim / h;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  }
  private async resizeToDataURL(
    fileOrBlob: Blob,
    maxDim: number,
    quality: number
  ): Promise<string> {
    const img = await this.loadImage(fileOrBlob);
    const { w, h } = this.fit(img.width, img.height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  }
  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  // ---- dates / groups (unchanged) ----
  private toISODateLocal(ts: number) {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  readonly todayISO = this.toISODateLocal(Date.now());

  readonly groups = computed(() => {
    const map = new Map<string, PhotoItem[]>();
    for (const it of this.items()) {
      const key = this.toISODateLocal(it.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    for (const [k, arr] of map.entries())
      arr.sort((a, b) => b.createdAt - a.createdAt);
    const sortedKeys = Array.from(map.keys()).sort((a, b) =>
      b.localeCompare(a)
    );
    return sortedKeys.map((k) => ({ date: k, items: map.get(k)! }));
  });

  readonly filteredGroups = computed(() => {
    const f = this.selectedDateFilter();
    if (!f) return this.groups();
    return this.groups().filter((g) => g.date === f);
  });

  // ---- grid prefs only in localStorage ----
  private readGridCols(): number {
    try {
      const raw = localStorage.getItem('client-photos-grid-cols');
      const n = raw ? parseInt(raw, 10) : 2;
      return [1, 2, 3, 5, 6].includes(n) ? n : 2;
    } catch {
      return 2;
    }
  }
  setGridCols(n: number) {
    if (![1, 2, 3, 5, 6].includes(n)) return;
    this.gridCols = n;
    localStorage.setItem('client-photos-grid-cols', String(n));
  }

  // ---- filters / draft / dnd / viewer (unchanged) ----
  toggleDateFilter(date: string) {
    this.selectedDateFilter.set(
      this.selectedDateFilter() === date ? null : date
    );
  }
  clearFilter() {
    this.selectedDateFilter.set(null);
  }
  onDateInputChange(val: string) {
    this.selectedDateFilter.set(val?.trim() ? val : null);
  }

  openAddModal() {
    this.resetDraft();
    this.isAddOpen.set(true);
  }
  closeAddModal() {
    this.isAddOpen.set(false);
  }
  onDraftChange<K extends keyof Draft>(field: K, value: Draft[K]) {
    this.draft.set({ ...this.draft(), [field]: value });
  }
  removeDraftFile(idx: number) {
    const d = { ...this.draft(), files: [...this.draft().files] };
    d.files.splice(idx, 1);
    this.draft.set(d);
  }
  getFilePreview(file: File) {
    return URL.createObjectURL(file);
  }
  private resetDraft() {
    this.draft.set({ client: '', location: '', note: '', files: [] });
  }

  async submit() {
    const d = this.draft();
    if (!d.client.trim()) {
      await this.alerts.alert(
        this.t.instant('HOME.PHOTOS.VALIDATION_REQUIRED')
      );
      return;
    }
    if (!d.files.length) {
      await this.alerts.alert(this.t.instant('HOME.PHOTOS.NO_FILES'));
      return;
    }

    this.actionLoading = true;
    try {
      const imagesForMeta: { id: string; name: string; mime: string }[] = [];
      const blobsById: Record<string, Blob> = {};
      for (const f of d.files) {
        const dataUrl = await this.resizeToDataURL(f, 1280, 0.8);
        const id = crypto.randomUUID();
        imagesForMeta.push({
          id,
          name: f.name || 'image.jpg',
          mime: 'image/jpeg',
        });
        blobsById[id] = await this.dataUrlToBlob(dataUrl);
      }

      const now = Date.now();
      await this.cloud.upsertPhoto(
        {
          id: crypto.randomUUID(),
          client: d.client.trim(),
          location: d.location.trim(),
          note: d.note?.trim() ?? '',
          createdAt: now,
          images: imagesForMeta,
        },
        blobsById
      );

      // show loader while reloading
      await this.refreshFromCloud();

      this.resetDraft();
      this.isAddOpen.set(false);
      await this.alerts.alert(this.t.instant('HOME.PHOTOS.SAVED'));
    } catch (e: any) {
      console.error(e);
      await this.alerts.alert(
        this.t.instant('HOME.PHOTOS.SAVE_FAILED', { message: e?.message || '' })
      );
    } finally {
      this.actionLoading = false;
    }
  }

  async removeItem(id: string) {
    const ok = await this.alerts.confirm(
      this.t.instant('HOME.PHOTOS.CONFIRM_DELETE')
    );
    if (!ok) return;
    const toRemove = this.items().find((x) => x.id === id);
    if (!toRemove) return;

    try {
      await this.cloud.deletePhoto(
        toRemove.id,
        toRemove.images.map((i) => ({ id: i.id, mime: i.mime }))
      );
      await this.refreshFromCloud();
      if (this.viewerOpen) this.closeViewer();
    } catch (e) {
      console.warn('Cloud delete failed:', e);
    }
  }

  async clearAll() {
    const ok = await this.alerts.confirm(
      this.t.instant('HOME.BACKUP.CONFIRM_CLEAR_DB')
    );
    if (!ok) return;
    this.clearingAll = true;
    try {
      await this.cloud.clearAll();
      this.items.set([]);
      this.selectedDateFilter.set(null);
      this.coverIndex = {};
      this.viewerOpen = false;
      this.viewerImages = [];
      this.viewerIndex = 0;
      this.viewerTitle = '';
      this.resetDraft();
      await this.alerts.alert(this.t.instant('HOME.BACKUP.CLEARED'));
    } catch (e: any) {
      await this.alerts.alert(
        this.t.instant('HOME.BACKUP.CLEAR_FAILED', {
          message: e?.message || '',
        })
      );
    } finally {
      this.clearingAll = false;
    }
  }

  onDragOver(ev: DragEvent) {
    ev.preventDefault();
    this.isDragging.set(true);
  }
  onDragLeave(ev: DragEvent) {
    ev.preventDefault();
    this.isDragging.set(false);
  }
  onDropFiles(ev: DragEvent) {
    ev.preventDefault();
    this.isDragging.set(false);
    const files = Array.from(ev.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length) this.mergeFilesIntoDraft(files);
  }
  mergeFilesIntoDraft(files: File[]) {
    const existing = new Set(
      this.draft().files.map((f) => `${f.name}::${f.size}`)
    );
    const add = files.filter(
      (f) =>
        f.type.startsWith('image/') && !existing.has(`${f.name}::${f.size}`)
    );
    if (!add.length) return;
    this.onDraftChange('files', [...this.draft().files, ...add]);
  }
  onPickFiles(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) =>
      f.type.startsWith('image/')
    );
    this.mergeFilesIntoDraft(files);
  }

  openSuggest = signal<{ field: 'client' | 'location' | null }>({
    field: null,
  });
  isSuggestOpen(field: 'client' | 'location') {
    return this.openSuggest().field === field;
  }
  showSuggestions(field: 'client' | 'location') {
    this.openSuggest.set({ field });
  }
  hideSuggestionsSoon() {
    window.setTimeout(() => this.openSuggest.set({ field: null }), 120);
  }
  filterSuggestions(field: 'client' | 'location', query: string): string[] {
    const pool =
      field === 'client'
        ? this.suggestions.customers
        : this.suggestions.locations;
    const q = (query || '').toUpperCase().trim();
    if (!q) return pool.slice(0, 8);
    const starts: string[] = [],
      contains: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      const v = pool[i],
        u = v.toUpperCase();
      if (u.startsWith(q)) starts.push(v);
      else if (u.includes(q)) contains.push(v);
      if (starts.length + contains.length >= 24) break;
    }
    return starts.concat(contains).slice(0, 8);
  }
  pickSuggestion(field: 'client' | 'location', value: string) {
    const d = { ...this.draft() };
    if (field === 'client') d.client = value;
    else d.location = value;
    this.draft.set(d);
    this.openSuggest.set({ field: null });
  }

  coverIndex: Record<string, number> = {};
  viewerOpen = false;
  viewerImages: ImageEntry[] = [];
  viewerIndex = 0;
  viewerTitle = '';

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.viewerOpen) return;
    if (e.key === 'Escape') this.closeViewer();
    else if (e.key === 'ArrowLeft') this.prevImage();
    else if (e.key === 'ArrowRight') this.nextImage();
  }
  getCoverIndex(it: PhotoItem): number {
    const idx = this.coverIndex[it.id];
    return Number.isInteger(idx) ? idx : 0;
  }
  coverOf(it: PhotoItem): ImageEntry | null {
    const idx = this.getCoverIndex(it);
    return it.images?.[idx] ?? it.images?.[0] ?? null;
  }
  openViewer(it: PhotoItem, idx: number = 0) {
    if (!it.images?.length) return;
    this.viewerImages = it.images;
    this.viewerIndex = Math.min(Math.max(0, idx), it.images.length - 1);
    this.viewerTitle = it.client || '';
    this.viewerOpen = true;
    try {
      document.body.classList.add('overflow-hidden');
    } catch {}
  }
  closeViewer() {
    this.viewerOpen = false;
    this.viewerImages = [];
    this.viewerIndex = 0;
    try {
      document.body.classList.remove('overflow-hidden');
    } catch {}
  }
  prevImage() {
    if (!this.viewerImages.length) return;
    this.viewerIndex =
      (this.viewerIndex - 1 + this.viewerImages.length) %
      this.viewerImages.length;
  }
  nextImage() {
    if (!this.viewerImages.length) return;
    this.viewerIndex = (this.viewerIndex + 1) % this.viewerImages.length;
  }
}
