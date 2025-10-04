import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertService } from '../../../core/services/alert.service';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-alert-center',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    CommonModule,
    TranslateModule,
  ],
  template: `
    <!-- Toast stack (top-right) -->
    <div
      class="fixed top-4 right-4 z-[1000] flex flex-col gap-3 w-[92vw] max-w-sm"
    >
      <div
        *ngFor="let t of toasts()"
        class="pointer-events-auto shadow-lg rounded-2xl p-4 border backdrop-blur bg-white/85 border-slate-200 dark:bg-slate-900/85 dark:border-slate-700"
        [attr.data-kind]="t.kind"
      >
        <div class="flex items-start gap-3">
          <div
            class="h-2.5 w-2.5 mt-1.5 rounded-full"
            [ngClass]="{
'bg-sky-500': t.kind==='info',
'bg-emerald-500': t.kind==='success',
'bg-amber-500': t.kind==='warning',
'bg-rose-500': t.kind==='error',
}"
          ></div>
          <div
            class="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-line"
          >
            {{ t.message }}
          </div>
          <button
            (click)="dismiss(t.id)"
            class="ml-auto shrink-0 rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 dark:hover:bg-slate-700/60"
          >
            ✕
          </button>
        </div>
      </div>
    </div>

    <!-- Modal dialog -->
    <div
      *ngIf="dialog().open"
      class="fixed inset-0 z-[1100] flex items-center justify-center"
    >
      <div
        class="absolute inset-0 bg-slate-800/40 dark:bg-black/60"
        (click)="cancel()"
      ></div>
      <div
        class="relative mx-4 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700"
      >
        <div class="p-5 border-b border-slate-100 dark:border-slate-700">
          <h3
            class="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            {{ dialog().title || defaultTitle() }}
          </h3>
        </div>
        <div class="p-5 space-y-4">
          <p
            class="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line"
          >
            {{ dialog().message }}
          </p>
          <input
            *ngIf="dialog().mode === 'prompt'"
            [(ngModel)]="inputValue"
            type="text"
            class="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div class="p-5 pt-0 flex justify-end gap-2">
          <button
            *ngIf="dialog().mode !== 'alert'"
            (click)="cancel()"
            class="rounded-xl px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {{ 'ALERT.CANCEL' | translate }}
          </button>
          <button
            (click)="ok()"
            class="rounded-xl px-4 py-2 text-sm bg-sky-600 text-white hover:bg-sky-700"
          >
            {{
              (dialog().mode === 'confirm'
                ? 'ALERT.OK'
                : dialog().mode === 'prompt'
                ? 'ALERT.SAVE'
                : 'ALERT.OK'
              ) | translate
            }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [``],
})
export class AlertCenterComponent {
  toasts: typeof this.alerts.toasts;
  dialog: typeof this.alerts.dialog;
  inputValue: string;

  constructor(private alerts: AlertService, private t: TranslateService) {
    this.toasts = this.alerts.toasts;
    this.dialog = this.alerts.dialog;
    this.inputValue = this.dialog().inputValue || '';
  }

  dismiss(id: string) {
    this.alerts.dismiss(id);
  }
  cancel() {
    if (this.dialog().mode === 'prompt') {
      this.alerts.closeDialog(null);
    } else if (this.dialog().mode === 'confirm') {
      this.alerts.closeDialog(false);
    } else {
      this.alerts.closeDialog();
    }
  }
  ok() {
    if (this.dialog().mode === 'prompt') {
      this.alerts.closeDialog(this.inputValue ?? '');
    } else if (this.dialog().mode === 'confirm') {
      this.alerts.closeDialog(true);
    } else {
      this.alerts.closeDialog();
    }
  }
  defaultTitle(): string {
    const mode = this.dialog().mode;
    return mode === 'confirm'
      ? this.t.instant('ALERT.PLEASE_CONFIRM')
      : mode === 'prompt'
      ? this.t.instant('ALERT.INPUT_REQUIRED')
      : this.t.instant('ALERT.NOTICE');
  }
}
