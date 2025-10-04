import { Injectable, signal } from '@angular/core';
import { AlertKind, DialogState, Toast } from '../interface/alert.types';

@Injectable({ providedIn: 'root' })
export class AlertService {
  private _toasts = signal<Toast[]>([]);
  private _dialog = signal<DialogState>({
    open: false,
    mode: 'alert',
    message: '',
  });

  toasts = this._toasts.asReadonly();
  dialog = this._dialog.asReadonly();

  // ---- Toasts ----
  show(message: string, kind: AlertKind = 'info', timeout = 3500) {
    const id = crypto.randomUUID();
    const toast: Toast = { id, message, kind, timeout };
    this._toasts.update((list) => [...list, toast]);
    if (timeout > 0) {
      window.setTimeout(() => this.dismiss(id), timeout);
    }
  }

  dismiss(id: string) {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }

  info(msg: string, timeout?: number) {
    this.show(msg, 'info', timeout ?? 3500);
  }
  success(msg: string, timeout?: number) {
    this.show(msg, 'success', timeout ?? 3500);
  }
  warning(msg: string, timeout?: number) {
    this.show(msg, 'warning', timeout ?? 0);
  }
  error(msg: string, timeout?: number) {
    this.show(msg, 'error', timeout ?? 0);
  }

  // ---- Modal dialogs (Promise-based) ----
  private openDialog(partial: Partial<DialogState>): Promise<any> {
    return new Promise((resolve) => {
      this._dialog.set({
        open: true,
        mode: partial.mode || 'alert',
        title: partial.title,
        message: partial.message || '',
        inputValue: partial.inputValue,
        resolve,
      });
    });
  }

  closeDialog(result?: any) {
    const d = this._dialog();
    d.resolve?.(result);
    this._dialog.set({ open: false, mode: 'alert', message: '' });
  }

  alert(message: string, title?: string): Promise<void> {
    return this.openDialog({ mode: 'alert', message, title }).then(() => {});
  }

  confirm(message: string, title?: string): Promise<boolean> {
    return this.openDialog({ mode: 'confirm', message, title });
  }

  prompt(message: string, def = '', title?: string): Promise<string | null> {
    return this.openDialog({ mode: 'prompt', message, inputValue: def, title });
  }
}
