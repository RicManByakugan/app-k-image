import { Component, computed } from '@angular/core';
import { NgIf } from '@angular/common';
import { LoaderService } from '../core/services/loader.service';

@Component({
  selector: 'app-loader-overlay',
  standalone: true,
  imports: [NgIf],
  template: `
    <div *ngIf="visible()" class="overlay" role="status" aria-live="polite">
      <div class="panel">
        <div class="spinner"></div>
      </div>
    </div>
  `,
  styles: [
    `
      .overlay {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgba(2, 6, 23, 0.35);
        backdrop-filter: blur(2px);
        z-index: 9999;
      }
      .panel {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        padding: 0.85rem 1rem;
        border-radius: 0.75rem;
        background: #0b1220;
        color: #e5e7eb;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      }
      .spinner {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.2);
        border-top-color: #fff;
        animation: spin 0.9s linear infinite;
      }
      .txt {
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class LoaderOverlayComponent {
  visible = computed(() => this.loader.isLoading());
  constructor(private loader: LoaderService) {}
}
