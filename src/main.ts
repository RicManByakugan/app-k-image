import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).then(() => {
  const el = document.getElementById('splash-loader');
  if (el) {
    requestAnimationFrame(() => el.classList.add('hidden'));
    setTimeout(() => el.remove(), 400);
  }
});
