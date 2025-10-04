import { Row } from './row.interface';

export interface Snapshot {
  id: string;
  dateISO: string;
  name: string;
  ts: number; // saved timestamp (ms)
  rows: Row[];
}
