import {
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  effect,
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
import { FsBackupService } from '../../../../core/services/fs-backup.service';

type ImageEntry = {
  id: string;
  dataUrl: string;
  mime: string;
  name: string;
};

type PhotoItem = {
  id: string;
  client: string;
  location: string;
  note: string;
  createdAt: number;
  images: ImageEntry[];
};

type Draft = {
  client: string;
  location: string;
  note: string;
  files: File[];
};

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
  fs = inject(FsBackupService); // public pour le template

  actionLoading: boolean = false; // loader du bouton "SAVE" (modal ajout)
  savingDb: boolean = false; // loader du bouton "Save" (DB)
  clearingDb: boolean = false; // loader du bouton "Clear" (DB)

  gridCols: number = this.readGridCols();

  // DnD
  isDragging = signal(false);

  // UI
  isAddOpen = signal(false);

  // Données
  private readonly STORAGE_KEY = 'client-photos-v1';
  items = signal<PhotoItem[]>([]);
  selectedDateFilter = signal<string | null>(null); // 'yyyy-MM-dd' ou null
  private hideSuggestTimer?: number;

  // Emplacement backup (nom du dossier, si choisi)
  backupFolderName: string | null = null;
  backupReady = signal<boolean>(false);

  suggestions = {
    customers: customer,
    locations: location,
  };

  // Form
  draft = signal<Draft>({ client: '', location: '', note: '', files: [] });

  @ViewChild('importInput', { static: false })
  importInput?: ElementRef<HTMLInputElement>;

  constructor() {
    void this.ensureBackup().then((ok) => {
      this.items.set(ok ? this.readAll() : []); // si pas de base -> rien à afficher
    });

    this.items.set(this.readAll());
    effect(() => this.writeAll(this.items()));
    // Récupération du handle dossier s'il existe déjà
    void this.fs.getHandle().then((h) => {
      this.backupFolderName = h ? (h as any).name ?? '…' : null;
      if (h) localStorage.setItem('backup-configured', '1');
    });
  }

  // ====== I18n helper ======
  private i18n(key: string, params?: Record<string, any>) {
    return this.t.instant(key, params);
  }

  get isGallery(): boolean {
    return this.gridCols >= 5;
  }

  private readGridCols(): number {
    try {
      const raw = localStorage.getItem('client-photos-grid-cols');
      const n = raw ? parseInt(raw, 10) : 2;
      // <— autoriser 1,2,3,5,6
      return [1, 2, 3, 5, 6].includes(n) ? n : 2;
    } catch {
      return 2;
    }
  }

  setGridCols(n: number) {
    // <— autoriser 1,2,3,5,6
    if (![1, 2, 3, 5, 6].includes(n)) return;
    this.gridCols = n;
    localStorage.setItem('client-photos-grid-cols', String(n));
  }

  // ====== Date utils ======
  private toISODateLocal(ts: number) {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  readonly todayISO = this.toISODateLocal(Date.now());

  // Groupement par date (yyyy-MM-dd)
  readonly groups = computed(() => {
    const map = new Map<string, PhotoItem[]>();
    for (const it of this.items()) {
      const key = this.toISODateLocal(it.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => b.createdAt - a.createdAt);
      map.set(k, arr);
    }
    const sortedKeys = Array.from(map.keys()).sort((a, b) =>
      b.localeCompare(a)
    );
    return sortedKeys.map((k) => ({ date: k, items: map.get(k)! }));
  });

  // Liste filtrée (si une date est sélectionnée)
  readonly filteredGroups = computed(() => {
    const f = this.selectedDateFilter();
    if (!f) return this.groups();
    return this.groups().filter((g) => g.date === f);
  });

  // ====== Storage (local) ======
  private readAll(): PhotoItem[] {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      const arr = raw ? (JSON.parse(raw) as PhotoItem[]) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  private writeAll(items: PhotoItem[]) {
    if (!items || items.length === 0) {
      localStorage.removeItem(this.STORAGE_KEY);
      return;
    }
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(items));
  }

  private async ensureBackup(): Promise<boolean> {
    if (!this.fs.isSupported) {
      this.backupReady.set(false);
      this.backupFolderName = null;
      localStorage.removeItem('backup-configured');
      return false;
    }

    const handle = await this.fs.getHandle();
    if (!handle) {
      this.backupReady.set(false);
      this.backupFolderName = null;
      localStorage.removeItem('backup-configured');
      return false;
    }

    try {
      // 1) S’assure d’avoir la permission RW
      const permFn = (handle as any).requestPermission?.bind(handle);
      if (permFn) {
        const p = await permFn({ mode: 'readwrite' });
        if (p !== 'granted') throw new Error('Permission denied');
      }

      // 2) PROBE: itère une entrée (si le dossier n’existe plus => NotFoundError)
      const entries = (handle as any).entries?.();
      if (entries && typeof entries[Symbol.asyncIterator] === 'function') {
        for await (const _ of entries) break; // on “pique” une entrée et stop
      } else {
        // Fallback minimal : pas d’API entries() (selon impl), on continue
      }

      // OK : base prête
      this.backupFolderName = (handle as any).name ?? '…';
      this.backupReady.set(true);
      localStorage.setItem('backup-configured', '1');
      return true;
    } catch {
      // Le dossier a été supprimé / inaccessible
      this.backupReady.set(false);
      this.backupFolderName = null;
      localStorage.removeItem('backup-configured');

      // On purge l’affichage pour éviter toute illusion de base existante
      this.items.set([]);
      return false;
    }
  }

  // ====== List actions ======
  async removeItem(id: string) {
    const ok = await this.alerts.confirm(
      this.t.instant('HOME.PHOTOS.CONFIRM_DELETE')
    );
    if (!ok) return;

    // retire l’élément de la liste locale
    this.items.update((arr) => arr.filter((x) => x.id !== id));

    // nettoie l’index de cover si présent
    delete this.coverIndex[id];

    // si on avait le viewer ouvert sur cet item, on peut le fermer (optionnel)
    if (
      this.viewerOpen &&
      this.viewerImages.length &&
      this.items().every((x) => x.id !== id)
    ) {
      this.closeViewer();
    }
  }

  // ====== Modal / Form ======
  openAddModal() {
    this.resetDraft();
    this.isAddOpen.set(true);
  }
  closeAddModal() {
    this.isAddOpen.set(false);
  }

  onDraftChange<K extends keyof Draft>(field: K, value: Draft[K]) {
    const d = { ...this.draft(), [field]: value };
    this.draft.set(d);
  }

  removeDraftFile(idx: number) {
    const d = { ...this.draft(), files: [...this.draft().files] };
    d.files.splice(idx, 1);
    this.draft.set(d);
  }
  getFilePreview(file: File): string {
    return URL.createObjectURL(file);
  }

  // Choisir le dossier de backup
  async chooseBackupFolder() {
    if (!this.fs.isSupported) {
      await this.alerts.alert(this.t.instant('HOME.BACKUP.NOT_SUPPORTED'));
      return;
    }
    const handle = await this.fs.pickFolder();
    if (!handle) return;

    this.backupFolderName = (handle as any).name ?? '…';
    localStorage.setItem('backup-configured', '1');
    await this.ensureBackup(); // revalide et active backupReady

    await this.alerts.alert(
      this.t.instant('HOME.BACKUP.SET_OK', { name: this.backupFolderName })
    );
  }

  // SUBMIT (modal) — sauvegarde locale + dossier (si configuré)
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

    const okBase = await this.ensureBackup();
    if (!okBase) {
      await this.alerts.alert(this.t.instant('HOME.BACKUP.REQUIRED')); // "Veuillez sélectionner une base avant d'ajouter des données."
      await this.chooseBackupFolder();
      return;
    }

    this.actionLoading = true;
    try {
      const imagesForApp: ImageEntry[] = [];
      const blobsById: Record<string, Blob> = {};

      for (const f of d.files) {
        const thumbDataUrl = await this.resizeToDataURL(f, 320, 0.7);
        const bigBlob = await this.resizeToBlob(f, 1280, 0.8);

        const id = crypto.randomUUID();
        imagesForApp.push({
          id,
          dataUrl: thumbDataUrl,
          mime: 'image/jpeg',
          name: f.name || 'image.jpg',
        });
        blobsById[id] = bigBlob;
      }

      const now = Date.now();
      const itemForApp: PhotoItem = {
        id: crypto.randomUUID(),
        client: d.client.trim(),
        location: d.location.trim(),
        note: d.note?.trim() ?? '',
        createdAt: now,
        images: imagesForApp,
      };

      // Local
      this.items.update((arr) => [itemForApp, ...arr]);
      this.isAddOpen.set(false);

      // Dossier (si configuré)
      try {
        await this.fs.writeItemTree(
          {
            id: itemForApp.id,
            client: itemForApp.client,
            location: itemForApp.location,
            note: itemForApp.note,
            createdAt: itemForApp.createdAt,
            images: imagesForApp.map((im) => ({
              id: im.id,
              name: im.name,
              mime: im.mime,
            })),
          },
          blobsById
        );
      } catch (e) {
        console.warn('Backup write failed:', e);
      }

      await this.alerts.alert(this.t.instant('HOME.PHOTOS.SAVED'));
    } finally {
      this.actionLoading = false;
    }
  }

  // ====== SAVE ALL to DB (dossier) ======
  async saveAllToDb() {
    if (!this.fs.isSupported) {
      await this.alerts.alert(this.t.instant('HOME.BACKUP.NOT_SUPPORTED'));
      return;
    }
    let handle = await this.fs.getHandle();
    if (!handle) {
      await this.chooseBackupFolder();
      handle = await this.fs.getHandle();
      if (!handle) return;
    }

    this.savingDb = true;
    try {
      const list = this.items();
      for (const it of list) {
        const blobs: Record<string, Blob> = {};
        for (const im of it.images) {
          // on convertit la miniature (dataURL) en blob
          blobs[im.id] = await this.dataUrlToBlob(im.dataUrl);
        }
        await this.fs.writeItemTree(
          {
            id: it.id,
            client: it.client,
            location: it.location,
            note: it.note,
            createdAt: it.createdAt,
            images: it.images.map((im) => ({
              id: im.id,
              name: im.name,
              mime: im.mime,
            })),
          },
          blobs
        );
      }
      await this.alerts.alert(this.t.instant('HOME.BACKUP.SAVE_DONE'));
    } catch (e: any) {
      await this.alerts.alert(
        this.t.instant('HOME.BACKUP.SAVE_FAILED', {
          message: e?.message || '',
        })
      );
    } finally {
      this.savingDb = false;
    }
  }

  async clearAll() {
    const ok = await this.alerts.confirm(
      this.t.instant('HOME.BACKUP.CONFIRM_CLEAR_DB')
    );
    if (!ok) return;

    this.clearingDb = true;
    try {
      // On vérifie d’abord que la base est là
      const okBase = await this.ensureBackup();
      if (!okBase) {
        await this.alerts.alert(this.t.instant('HOME.BACKUP.MISSING'));
        return;
      }

      await this.fs.clearFolder(); // vide contenu, ne supprime PAS le dossier
      // On nettoie uniquement les données de l’app (pas la connexion)
      localStorage.removeItem(this.STORAGE_KEY);
      localStorage.removeItem('client-photos-grid-cols');

      // Reset UI
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
      this.clearingDb = false;
    }
  }

  // ====== Date filter actions ======
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

  // ====== Export / Import JSON (local) ======
  exportAll() {
    const payload = {
      kind: 'client-photos.v1',
      exportedAt: Date.now(),
      items: this.items(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `client-photos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  openImportDialog() {
    this.importInput?.nativeElement.click();
  }

  async onImportChosen(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (
        !json ||
        json.kind !== 'client-photos.v1' ||
        !Array.isArray(json.items)
      ) {
        throw new Error('Unsupported file');
      }
      this.items.set(json.items as PhotoItem[]);
      await this.alerts.alert(this.i18n('HOME.PHOTOS.IMPORTED'));
    } catch (e: any) {
      await this.alerts.alert(
        this.i18n('HOME.PHOTOS.IMPORT_FAILED', { message: e?.message || '' })
      );
    } finally {
      if (this.importInput?.nativeElement)
        this.importInput.nativeElement.value = '';
    }
  }

  // ====== Utils ======
  private resetDraft() {
    this.draft.set({ client: '', location: '', note: '', files: [] });
  }

  private loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('file read error'));
      fr.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image decode error'));
        img.src = fr.result as string;
        img.decoding = 'async';
      };
      fr.readAsDataURL(file);
    });
  }
  private fit(w: number, h: number, maxDim: number) {
    if (w <= maxDim && h <= maxDim) return { w, h };
    const r = w > h ? maxDim / w : maxDim / h;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  }
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
    return canvas.toDataURL('image/jpeg', quality);
  }
  private async resizeToBlob(
    file: File,
    maxDim: number,
    quality: number
  ): Promise<Blob> {
    const img = await this.loadImage(file);
    const { w, h } = this.fit(img.width, img.height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality);
    });
  }
  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  // ---- DnD ----
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

  // ---- Suggestions ----
  openSuggest = signal<{ field: 'client' | 'location' | null }>({
    field: null,
  });
  isSuggestOpen(field: 'client' | 'location') {
    return this.openSuggest().field === field;
  }
  showSuggestions(field: 'client' | 'location') {
    if (this.hideSuggestTimer) {
      clearTimeout(this.hideSuggestTimer);
      this.hideSuggestTimer = undefined;
    }
    this.openSuggest.set({ field });
  }
  hideSuggestionsSoon() {
    if (this.hideSuggestTimer) clearTimeout(this.hideSuggestTimer);
    this.hideSuggestTimer = window.setTimeout(() => {
      this.openSuggest.set({ field: null });
      this.hideSuggestTimer = undefined;
    }, 120);
  }
  filterSuggestions(field: 'client' | 'location', query: string): string[] {
    const pool =
      field === 'client'
        ? this.suggestions.customers
        : this.suggestions.locations;
    const q = (query || '').toUpperCase().trim();
    if (!q) return pool.slice(0, 8);
    const starts: string[] = [];
    const contains: string[] = [];
    for (let i = 0; i < pool.length; i++) {
      const v = pool[i];
      const u = v.toUpperCase();
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

  // Viewer
  coverIndex: Record<string, number> = {};
  viewerOpen: boolean = false;
  viewerImages: ImageEntry[] = [];
  viewerIndex: number = 0;
  viewerTitle: string = '';

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
