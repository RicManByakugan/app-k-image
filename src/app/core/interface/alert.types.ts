export type AlertKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: AlertKind;
  message: string;
  /** in ms; 0 = sticky */
  timeout: number;
}

export type DialogMode = 'alert' | 'confirm' | 'prompt';

export interface DialogState {
  open: boolean;
  mode: DialogMode;
  title?: string;
  message: string;
  inputValue?: string;
  resolve?: (value: any) => void; // set by service
}
