export interface Row {
  id: string;
  num: number | null;
  packed: boolean;
  type: string; // text
  location: string;
  payment: boolean; // checkbox: paid or not
  customer: string;
  amount: string; // free text; parsed for totals
  delivered: boolean;
  courier: string; // select
}
