import { Injectable } from '@angular/core';

export interface Row {
  id: string;
  num: number | null;
  packed: boolean;
  type: string;
  location: string;
  payment: boolean;
  customer: string;
  amount: string;
  delivered: boolean;
  courier: string;
  coast: string;
}

export interface Snapshot {
  id: string;
  dateISO: string;
  name: string;
  ts: number;
  rows: Row[];
}

type AnyJSON = Record<string, unknown>;

export type ExportSheetPayload = {
  kind: 'stride-parcels.sheet';
  version: 1;
  exportedAt: number; // ms
  dateISO: string;
  currentSnapshotId: string | null;
  rows: Row[];
};

export type ExportAllPayload = {
  kind: 'stride-parcels.all';
  version: 1;
  exportedAt: number; // ms
  snapshots: Snapshot[];
  autosaves: Record<string, Row[]>; // key: dateISO
};

export type ImportResult =
  | { type: 'sheet'; payload: ExportSheetPayload }
  | { type: 'all'; payload: ExportAllPayload };

@Injectable({ providedIn: 'root' })
export class FileStoreService {
  // These mirror your component constants
  readonly STORAGE_PREFIX = 'stride-parcels-';
  readonly SNAPSHOTS_KEY = 'stride-parcels-snapshots';

  /** ---- EXPORTS ---- */

  exportCurrentSheet(
    dateISO: string,
    rows: Row[],
    currentSnapshotId: string | null
  ) {
    const payload: ExportSheetPayload = {
      kind: 'stride-parcels.sheet',
      version: 1,
      exportedAt: Date.now(),
      dateISO,
      currentSnapshotId,
      rows,
    };
    this.downloadJSON(`stride-parcels-sheet-${dateISO}.json`, payload);
  }

  exportEverything() {
    const snapshots = this.readSnapshots();
    const autosaves = this.collectAutosaves();

    const payload: ExportAllPayload = {
      kind: 'stride-parcels.all',
      version: 1,
      exportedAt: Date.now(),
      snapshots,
      autosaves,
    };
    this.downloadJSON(
      `stride-parcels-all-${new Date().toISOString().slice(0, 10)}.json`,
      payload
    );
  }

  /** ---- IMPORTS ---- */

  async parseImportFile(file: File): Promise<ImportResult> {
    const text = await file.text();
    const json = JSON.parse(text) as AnyJSON;

    if (
      json &&
      json['kind'] === 'stride-parcels.sheet' &&
      json['version'] === 1
    ) {
      // minimal shape checks
      if (!Array.isArray(json['rows']) || typeof json['dateISO'] !== 'string') {
        throw new Error('Invalid sheet file.');
      }
      return { type: 'sheet', payload: json as ExportSheetPayload };
    }

    if (
      json &&
      json['kind'] === 'stride-parcels.all' &&
      json['version'] === 1
    ) {
      if (
        typeof json['autosaves'] !== 'object' ||
        !Array.isArray(json['snapshots'])
      ) {
        throw new Error('Invalid all-data file.');
      }
      return { type: 'all', payload: json as ExportAllPayload };
    }

    throw new Error('Unrecognized or unsupported file format.');
  }

  /** Apply a full import (snapshots + autosaves). Overwrites localStorage keys for this app. */
  applyAllImport(payload: ExportAllPayload) {
    // 1) clear existing autosaves for this prefix
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (key.startsWith(this.STORAGE_PREFIX)) toDelete.push(key);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));

    // 2) write autosaves
    for (const [dateISO, rows] of Object.entries(payload.autosaves)) {
      localStorage.setItem(this.STORAGE_PREFIX + dateISO, JSON.stringify(rows));
    }

    // 3) replace snapshots
    localStorage.setItem(this.SNAPSHOTS_KEY, JSON.stringify(payload.snapshots));
  }

  /** Utility to collect all autosaves by dateISO from localStorage. */
  private collectAutosaves(): Record<string, Row[]> {
    const map: Record<string, Row[]> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (key.startsWith(this.STORAGE_PREFIX)) {
        const dateISO = key.replace(this.STORAGE_PREFIX, '');
        try {
          const rows = JSON.parse(localStorage.getItem(key) || '[]') as Row[];
          if (Array.isArray(rows)) map[dateISO] = rows;
        } catch {
          /* ignore malformed entries */
        }
      }
    }
    return map;
  }

  /** Read snapshots (same format you already use). */
  private readSnapshots(): Snapshot[] {
    try {
      const raw = localStorage.getItem(this.SNAPSHOTS_KEY);
      const list = raw ? (JSON.parse(raw) as Snapshot[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** Trigger a JSON file download. */
  private downloadJSON(filename: string, data: object) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
