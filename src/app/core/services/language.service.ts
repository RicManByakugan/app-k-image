import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const STORAGE_KEY = 'stride-lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  current = signal<string>('en');

  constructor(private t: TranslateService) {
    const saved = localStorage.getItem(STORAGE_KEY);
    // Detect browser language if nothing saved
    const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
    const start = saved === 'fr' ? 'fr' : 'en';

    this.t.addLangs(['en', 'fr']);
    this.t.setDefaultLang('en');
    this.use(start);
  }

  use(lang: 'en' | 'fr') {
    this.current.set(lang);
    this.t.use(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }
}
