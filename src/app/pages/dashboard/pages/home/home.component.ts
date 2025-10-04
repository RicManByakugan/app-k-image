import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  FileStoreService,
  Row,
  Snapshot,
} from '../../../../core/services/file-store.service';
import { LanguageService } from '../../../../core/services/language.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../../shared/layout/main/header/header.component';
import { FooterComponent } from '../../../../shared/layout/main/footer/footer.component';
import {
  SuggestField,
  SuggestionsJson,
} from '../../../../core/interface/suggestion.interface';
import {
  customer,
  location,
  province,
} from '../../../../core/const/suggestion';
import { AlertService } from '../../../../core/services/alert.service';

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
  @ViewChild('optionsMenu') optionsMenu!: ElementRef<HTMLDetailsElement>;

  @ViewChild('fileInput', { static: false })
  fileInput?: ElementRef<HTMLInputElement>;

  suggestions = signal<SuggestionsJson>({
    types: province,
    locations: location,
    customers: customer,
  });

  private openSuggest = signal<{
    rowId: string | null;
    field: SuggestField | null;
  }>({
    rowId: null,
    field: null,
  });
  private hideSuggestTimer?: number;

  private t = inject(TranslateService);
  private alerts = inject(AlertService);

  private readonly STORAGE_PREFIX = 'stride-parcels-';
  private readonly SNAPSHOTS_KEY = 'stride-parcels-snapshots';
  private readonly SESSION_WORK_KEY = 'stride-parcels-working';

  couriers = ['DERA', 'HERY', 'ALPHA', 'NJAKA', 'MAMY'];

  private toISODateLocal(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  private fromISODateLocal(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }

  readonly todayISO = this.toISODateLocal(new Date());
  selectedDate = signal<string>(this.todayISO);

  dayName = computed(() => {
    const d = this.fromISODateLocal(this.selectedDate());
    const locale = this.lang.current();
    return d.toLocaleDateString(locale, { weekday: 'long' });
  });

  rows = signal<Row[]>([this.makeEmptyRow(1)]);
  currentSnapshotId = signal<string | null>(null);

  showHistory = signal<boolean>(false);
  snapshots = signal<Snapshot[]>([]);

  totalsByCourier = computed(() => {
    const map = new Map<string, { gross: number; fees: number }>();
    for (const r of this.rows()) {
      if (!r.delivered) continue;
      const gross = this.parseAmount(r.amount);
      const fee = this.parseAmount(r.coast);
      const key = r.courier || '—';
      const cur = map.get(key) || { gross: 0, fees: 0 };
      cur.gross += gross;
      cur.fees += fee;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([courier, v]) => ({
        courier,
        gross: v.gross,
        fees: v.fees,
        net: v.gross - v.fees,
      }))
      .sort((a, b) => a.courier.localeCompare(b.courier));
  });

  deliveredStats = computed(() => {
    let count = 0;
    let total = 0;
    for (const r of this.rows()) {
      if (r.delivered) {
        count++;
        total += this.parseAmount(r.amount);
      }
    }
    return { count, total };
  });

  private saveDebounce?: number;

  constructor(
    private fileStore: FileStoreService,
    private lang: LanguageService
  ) {
    this.loadFromStorage(this.selectedDate());
    this.loadSnapshots();

    effect(() => {
      this.rows();
      this.debouncedSave();
      this.saveWorkingSession();
    });

    effect(
      () => {
        const d = this.selectedDate();
        this.currentSnapshotId.set(null);
        this.loadFromStorage(d);

        const open = this.showHistory();
        try {
          document.body.classList.toggle('overflow-hidden', open);
        } catch {}
      },
      { allowSignalWrites: true }
    );

    this.maybeRestoreWorkingFromSession();
  }

  openHistoryModal() {
    this.showHistory.set(true);
  }

  closeHistoryModal() {
    this.showHistory.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.showHistory()) this.closeHistoryModal();
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    const target = event.target as HTMLElement;
    if (this.optionsMenu && !this.optionsMenu.nativeElement.contains(target)) {
      this.optionsMenu.nativeElement.open = false;
    }
  }

  // ---------- i18n helpers (use AlertService) ----------
  private i18n(key: string, params?: Record<string, any>): string {
    return this.t.instant(key, params);
  }
  private async alertK(key: string, params?: Record<string, any>) {
    await this.alerts.alert(this.i18n(key, params));
  }
  private async confirmK(
    key: string,
    params?: Record<string, any>
  ): Promise<boolean> {
    return await this.alerts.confirm(this.i18n(key, params));
  }
  private async promptK(
    key: string,
    def?: string,
    params?: Record<string, any>
  ): Promise<string | null> {
    return await this.alerts.prompt(this.i18n(key, params), def ?? '');
  }

  private sanitizeExpr(raw: string): string {
    return (raw || '')
      .toLowerCase()
      .replace(/[^0-9k+\-\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private group3(digits: string): string {
    const clean = digits.replace(/\D/g, '');
    return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  formatAmountExpr(raw: string): string {
    const s = this.sanitizeExpr(raw).replace(/\s+/g, '');
    if (!s) return '';

    const parts = s.split(/([+\-])/).filter((p) => p.length > 0);

    const fmt: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const token = parts[i];

      if (token === '+' || token === '-') {
        fmt.push(token);
        continue;
      }

      const hasK = /k$/i.test(token);
      const digits = token.replace(/k$/i, '');
      const grouped = this.group3(digits);
      fmt.push(hasK ? grouped + 'k' : grouped);
    }

    return fmt.join('');
  }

  private evalAmount(raw: string): number {
    if (!raw) return 0;
    const s = this.sanitizeExpr(raw).replace(/\s+/g, '');
    let sum = 0,
      sign = 1,
      i = 0;

    while (i < s.length) {
      const ch = s[i];
      if (ch === '+') {
        sign = 1;
        i++;
        continue;
      }
      if (ch === '-') {
        sign = -1;
        i++;
        continue;
      }

      let j = i;
      while (j < s.length && /[0-9k]/.test(s[j])) j++;
      const term = s.slice(i, j);
      let n = 0;
      if (/^\d+k$/.test(term)) n = parseInt(term.slice(0, -1), 10) * 1000;
      else if (/^\d+$/.test(term)) n = parseInt(term, 10);

      sum += sign * (isFinite(n) ? n : 0);
      i = j;
    }
    return sum;
  }

  private parseAmount(raw: string): number {
    return this.evalAmount(raw);
  }

  onAmountPaste(e: ClipboardEvent, row: Row) {
    const pasted = e.clipboardData?.getData('text') ?? '';
    row.amount = this.formatAmountExpr(pasted);
    e.preventDefault();
    this.markDirtyAndSave();
  }
  onCoastPaste(e: ClipboardEvent, row: Row) {
    const pasted = e.clipboardData?.getData('text') ?? '';
    row.coast = this.formatAmountExpr(pasted);
    e.preventDefault();
    this.markDirtyAndSave();
  }

  formatAmount(val: string): string {
    if (!val) return '';
    const digits = val.replace(/\D+/g, '');
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // onAmountPaste(e: ClipboardEvent, row: Row) {
  //   const pasted = e.clipboardData?.getData('text') ?? '';
  //   row.amount = this.sanitizeAmountExpression(pasted);
  //   e.preventDefault();
  //   this.markDirtyAndSave();
  // }

  // onCoastPaste(e: ClipboardEvent, row: Row) {
  //   const pasted = e.clipboardData?.getData('text') ?? '';
  //   row.coast = this.sanitizeAmountExpression(pasted);
  //   e.preventDefault();
  //   this.markDirtyAndSave();
  // }

  exportSheetToFile() {
    this.fileStore.exportCurrentSheet(
      this.selectedDate(),
      this.rows(),
      this.currentSnapshotId()
    );
  }
  exportAllToFile() {
    this.fileStore.exportEverything();
  }
  openImportDialog() {
    this.fileInput?.nativeElement.click();
  }

  async onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const result = await this.fileStore.parseImportFile(file);

      if (result.type === 'sheet') {
        const dateISO = result.payload.dateISO || this.selectedDate();
        const normalized = result.payload.rows.map((r, i) =>
          this.normalizeRow(r, i)
        );
        this.selectedDate.set(dateISO);
        this.rows.set(normalized.length ? normalized : [this.makeEmptyRow(1)]);
        this.currentSnapshotId.set(result.payload.currentSnapshotId ?? null);
        await this.alertK('HOME.ALERT.SHEET_IMPORTED');
      } else if (result.type === 'all') {
        if (await this.confirmK('HOME.CONFIRM.IMPORT_ALL')) {
          this.fileStore.applyAllImport(result.payload);
          this.loadSnapshots();
          const hasCurrent = !!result.payload.autosaves[this.selectedDate()];
          if (hasCurrent) {
            this.loadFromStorage(this.selectedDate());
          } else {
            this.rows.set([this.makeEmptyRow(1)]);
          }
          this.currentSnapshotId.set(null);
          await this.alertK('HOME.ALERT.ALL_DATA_IMPORTED');
        }
      }
    } catch (err: any) {
      console.error(err);
      await this.alertK('HOME.ALERT.FAILED_IMPORT', {
        message: err?.message || '',
      });
    } finally {
      if (this.fileInput?.nativeElement) {
        this.fileInput.nativeElement.value = '';
      }
    }
  }

  // ---------- Actions ----------
  addRow() {
    const nextNum = (this.rows().at(-1)?.num ?? 0) + 1;
    this.rows.update((arr) => [...arr, this.makeEmptyRow(nextNum)]);
  }

  addTenRow() {
    const lastNum = this.rows().at(-1)?.num ?? 0;
    const newRows = Array.from({ length: 10 }, (_, i) =>
      this.makeEmptyRow(lastNum + i + 1)
    );
    this.rows.update((arr) => [...arr, ...newRows]);
  }

  async removeRow(index: number) {
    if (await this.confirmK('HOME.CONFIRM.REMOVE_ROW')) {
      this.rows.update((arr) => arr.filter((_, i) => i !== index));
    }
  }

  checkAllPacked() {
    this.rows.update((arr) => arr.map((r) => ({ ...r, packed: true })));
  }

  toggleHistory() {
    this.showHistory.update((v) => !v);
  }

  // ====== SNAPSHOT COMMANDS ======
  async saveOrUpdateSnapshot() {
    const now = Date.now();
    const dateISO = this.selectedDate();
    const rowsCopy = structuredClone(this.rows());
    const id = this.currentSnapshotId();

    if (id) {
      const list = this.readSnapshots();
      const idx = list.findIndex((s) => s.id === id);
      if (idx >= 0) {
        list[idx].rows = rowsCopy;
        list[idx].ts = now;
        this.writeSnapshots(list);
        this.loadSnapshots();
        await this.alertK('HOME.ALERT.SNAPSHOT_UPDATED', {
          name: list[idx].name,
        });
        return;
      }
    }

    const name = `Snapshot ${new Date(now).toLocaleString(
      this.lang.current()
    )}`;
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      dateISO,
      name,
      ts: now,
      rows: rowsCopy,
    };
    const list = this.readSnapshots();
    list.push(snapshot);
    this.writeSnapshots(list);
    this.loadSnapshots();
    this.currentSnapshotId.set(snapshot.id);
    await this.alertK('HOME.ALERT.SNAPSHOT_SAVED', { name });
  }

  deliveredCountOf(s: Snapshot): number {
    return s.rows.reduce((cnt, r) => cnt + (r.delivered ? 1 : 0), 0);
  }

  deliveredTotalOf(s: Snapshot): number {
    return s.rows.reduce((sum, r) => {
      if (!r.delivered) return sum;
      const gross = this.parseAmount(r.amount);
      const fee = this.parseAmount(r.coast);
      return sum + (gross - fee);
    }, 0);
  }

  grandTotals = computed(() => {
    const items = this.totalsByCourier();
    let gross = 0,
      fees = 0;
    for (const it of items) {
      gross += it.gross;
      fees += it.fees;
    }
    return { gross, fees, net: gross - fees };
  });

  loadSnapshot(id: string) {
    const list = this.readSnapshots();
    const snap = list.find((s) => s.id === id);
    if (!snap) return;

    this.closeHistoryModal();

    queueMicrotask(() => {
      this.selectedDate.set(snap.dateISO);
      this.rows.set(structuredClone(snap.rows));
      this.currentSnapshotId.set(snap.id);
    });
  }

  async renameSnapshot(id: string) {
    const list = this.readSnapshots();
    const snap = list.find((s) => s.id === id);
    if (!snap) return;
    const newName = (
      await this.promptK('HOME.PROMPT.RENAME_SNAPSHOT', snap.name)
    )?.trim();
    if (!newName) return;
    snap.name = newName;
    this.writeSnapshots(list);
    this.loadSnapshots();
  }

  async deleteSnapshot(id: string) {
    if (!(await this.confirmK('HOME.CONFIRM.DELETE_SNAPSHOT'))) return;

    const list = this.readSnapshots().filter((s) => s.id !== id);
    if (this.currentSnapshotId() === id) this.currentSnapshotId.set(null);
    this.writeSnapshots(list);
    this.loadSnapshots();
  }

  // Quick popup summary (for the “See result” button)
  async seeResult() {
    const { count, total } = this.deliveredStats();
    const totalFormatted = total.toLocaleString(this.lang.current());
    await this.alertK('HOME.ALERT.SEE_RESULT', {
      count,
      total: totalFormatted,
    });
  }

  // Clear ALL storage (autosaves, snapshots, session) and reset current sheet
  async clearAllStorage() {
    if (!(await this.confirmK('HOME.CONFIRM.CLEAR_ALL'))) return;

    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (key.startsWith(this.STORAGE_PREFIX)) toDelete.push(key);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));

    localStorage.removeItem(this.SNAPSHOTS_KEY);
    sessionStorage.removeItem(this.SESSION_WORK_KEY);

    this.snapshots.set([]);
    this.currentSnapshotId.set(null);
    this.rows.set([this.makeEmptyRow(1)]);
    await this.alertK('HOME.ALERT.ALL_DATA_CLEARED');
  }

  // ---------- Edits ----------
  markDirtyAndSave() {
    this.rows.set([...this.rows()]);
    this.debouncedSave();
  }

  sanitizeAmountExpression(val: string): string {
    if (!val) return '';
    return val
      .toLowerCase()
      .replace(/[^0-9k+\-\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  previewAmount(val: string): string {
    const n = this.evalAmount(val);
    return n ? n.toLocaleString(this.lang.current()) + '' : '';
  }

  collapseAmountField(row: Row, field: 'amount' | 'coast') {
    const n = this.evalAmount(row[field]);
    row[field] = n ? this.formatAmount(String(n)) : '';
    this.markDirtyAndSave();
  }

  private makeEmptyRow(num: number): Row {
    return {
      id: crypto.randomUUID(),
      num,
      packed: false,
      type: '',
      location: '',
      payment: false,
      customer: '',
      amount: '',
      delivered: false,
      courier: '',
      coast: '',
    };
  }

  private storageKey(dateISO: string) {
    return `${this.STORAGE_PREFIX}${dateISO}`;
  }

  private loadFromStorage(dateISO: string) {
    const raw = localStorage.getItem(this.storageKey(dateISO));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as any[];
        const normalized = (Array.isArray(parsed) ? parsed : []).map((r, i) =>
          this.normalizeRow(r, i)
        );
        this.rows.set(normalized.length ? normalized : [this.makeEmptyRow(1)]);
        return;
      } catch {
        /* ignore */
      }
    }
    this.rows.set([this.makeEmptyRow(1)]);
  }

  private normalizeRow(r: any, idx: number): Row {
    return {
      id: r?.id || crypto.randomUUID(),
      num: typeof r?.num === 'number' ? r.num : idx + 1,
      packed: !!r?.packed,
      type: (r?.type ?? '').toString(),
      location: (r?.location ?? '').toString(),
      payment: typeof r?.payment === 'boolean' ? r.payment : false,
      customer: (r?.customer ?? '').toString(),
      amount: (r?.amount ?? '').toString(),
      delivered: !!r?.delivered,
      courier: (r?.courier ?? '').toString(),
      coast: (r?.coast ?? '').toString(),
    };
  }

  private saveToStorage() {
    const key = this.storageKey(this.selectedDate());
    localStorage.setItem(key, JSON.stringify(this.rows()));
  }

  private debouncedSave() {
    if (this.saveDebounce) window.clearTimeout(this.saveDebounce);
    this.saveDebounce = window.setTimeout(() => this.saveToStorage(), 250);
  }

  private saveWorkingSession() {
    const payload = {
      dateISO: this.selectedDate(),
      ts: Date.now(),
      rows: this.rows(),
    };
    sessionStorage.setItem(this.SESSION_WORK_KEY, JSON.stringify(payload));
  }

  private maybeRestoreWorkingFromSession() {
    try {
      const raw = sessionStorage.getItem(this.SESSION_WORK_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        dateISO: string;
        ts: number;
        rows: Row[];
      };
      if (!parsed?.dateISO || !Array.isArray(parsed?.rows)) return;
      if (parsed.dateISO === this.selectedDate()) {
        this.rows.set(parsed.rows.map((r, i) => this.normalizeRow(r, i)));
      }
    } catch {
      /* ignore */
    }
  }

  // ----- snapshots read/write -----
  private readSnapshots(): Snapshot[] {
    try {
      const raw = localStorage.getItem(this.SNAPSHOTS_KEY);
      const list = raw ? (JSON.parse(raw) as Snapshot[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  private writeSnapshots(list: Snapshot[]) {
    localStorage.setItem(this.SNAPSHOTS_KEY, JSON.stringify(list));
  }
  private loadSnapshots() {
    this.snapshots.set(this.readSnapshots().sort((a, b) => b.ts - a.ts));
  }

  trackById = (_: number, r: Row) => r.id;

  async removeAllLines() {
    if (await this.confirmK('HOME.CONFIRM.REMOVE_ALL_LINES')) {
      this.rows.set([this.makeEmptyRow(1)]);
    }
  }

  async newSheet() {
    if (await this.confirmK('HOME.CONFIRM.NEW_SHEET')) {
      this.selectedDate.set(this.todayISO);
      this.currentSnapshotId.set(null);
      this.rows.set([this.makeEmptyRow(1)]);
    }
  }

  // utilitaires d’ouverture/fermeture
  isSuggestOpen(rowId: string, field: SuggestField) {
    const s = this.openSuggest();
    return s.rowId === rowId && s.field === field;
  }
  showSuggestions(rowId: string, field: SuggestField) {
    if (this.hideSuggestTimer) {
      clearTimeout(this.hideSuggestTimer);
      this.hideSuggestTimer = undefined;
    }
    this.openSuggest.set({ rowId, field });
  }
  hideSuggestionsSoon() {
    if (this.hideSuggestTimer) clearTimeout(this.hideSuggestTimer);
    this.hideSuggestTimer = window.setTimeout(() => {
      this.openSuggest.set({ rowId: null, field: null });
      this.hideSuggestTimer = undefined;
    }, 120);
  }
  // filtrage (préfixe prioritaire puis contient), limite 8
  filterSuggestions(field: SuggestField, query: string): string[] {
    const pool =
      field === 'type'
        ? this.suggestions().types
        : field === 'location'
        ? this.suggestions().locations
        : this.suggestions().customers;

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

  // sélection d’une valeur
  pickSuggestion(row: Row, field: SuggestField, value: string) {
    if (field === 'type') row.type = value.toUpperCase();
    else if (field === 'location') row.location = value.toUpperCase();
    else row.customer = value.toUpperCase();

    this.markDirtyAndSave();
    this.openSuggest.set({ rowId: null, field: null });
  }
}
