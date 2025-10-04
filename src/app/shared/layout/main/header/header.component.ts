import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  Inject,
  computed,
  inject,
} from '@angular/core';
import { DOCUMENT, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NgIf, NgClass } from '@angular/common';
import { LanguageService } from '../../../../core/services/language.service';
import {
  ThemeMode,
  ThemeService,
} from '../../../../core/services/theme.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, TranslateModule, NgIf, NgClass, UpperCasePipe],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css'],
})
export class HeaderComponent {
  constructor(
    public lang: LanguageService,
    private host: ElementRef<HTMLElement>,
    @Inject(DOCUMENT) private doc: Document
  ) {}

  isMenuOpen = false;
  isLangOpen = false;

  @ViewChild('menuPanel') menuPanel!: ElementRef<HTMLDivElement>;
  @ViewChild('menuButton') menuButton!: ElementRef<HTMLButtonElement>;
  @ViewChild('langButton') langButton!: ElementRef<HTMLButtonElement>;
  @ViewChild('langMenu') langMenu!: ElementRef<HTMLDivElement>;

  private theme = inject(ThemeService);

  mode = computed<ThemeMode>(() => this.theme.mode());
  isDark = computed(() => this.theme.isDark());

  toggleTheme() {
    this.theme.cycleMode();
  }

  setTheme(mode: ThemeMode) {
    this.theme.setMode(mode);
  }

  // --- OUVERTURE/FERMETURE MENU GAUCHE ---
  toggleMenu() {
    this.isMenuOpen ? this.closeMenu() : this.openMenu();
  }
  openMenu() {
    this.isMenuOpen = true;
    this.lockScrollAndHideMain(true);
    setTimeout(() => this.focusFirstIn(this.menuPanel?.nativeElement), 0);
  }
  closeMenu() {
    if (!this.isMenuOpen) return;
    this.isMenuOpen = false;
    this.lockScrollAndHideMain(false);
    this.menuButton?.nativeElement?.focus();
  }

  // --- OVERLAY + MASQUAGE DU MAIN + LOCK SCROLL
  private lockScrollAndHideMain(hide: boolean) {
    const body = this.doc.body;
    const main = this.doc.querySelector('main') as HTMLElement | null;

    body.classList.toggle('menu-open', hide); // overflow hidden + fix layout shift
    if (main) {
      // accessibilité: cacher le contenu de fond aux lecteurs d’écran
      if (hide) {
        main.setAttribute('aria-hidden', 'true');
        main.classList.add('app-main-hidden'); // pointer-events none + blur optionnel
      } else {
        main.removeAttribute('aria-hidden');
        main.classList.remove('app-main-hidden');
      }
    }
  }

  // --- DROPDOWN LANG ---
  toggleLang() {
    this.isLangOpen = !this.isLangOpen;
  }
  closeLang() {
    this.isLangOpen = false;
  }
  changeLang(code: 'en' | 'fr') {
    this.lang.use(code);
    this.closeLang();
  }
  currentLang(): 'en' | 'fr' {
    return (this.lang.current?.() ?? 'en') === 'fr' ? 'fr' : 'en';
  }

  // --- ESC ---
  @HostListener('document:keydown.escape') onEsc() {
    this.closeMenu();
    this.closeLang();
  }

  // --- CLICK OUTSIDE (menu + langue) ---
  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    const t = e.target as Node;
    const inMenu =
      this.menuPanel?.nativeElement?.contains(t) ||
      this.menuButton?.nativeElement?.contains(t);
    const inLang =
      this.langMenu?.nativeElement?.contains(t) ||
      this.langButton?.nativeElement?.contains(t);
    if (!inMenu) this.closeMenu();
    if (!inLang) this.closeLang();
  }

  private focusFirstIn(root?: HTMLElement) {
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a,button,[tabindex]:not([tabindex="-1"])'
    );
    focusables[0]?.focus();
  }

  // --- Flags (conservez vos assets si vous en avez) ---
  flags: Record<'en' | 'fr', string> = {
    en:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="20" viewBox="0 0 28 20"><rect width="28" height="20" fill="#00247d"/><path d="M0,0 28,20 M28,0 0,20" stroke="#fff" stroke-width="4"/><path d="M0,0 28,20 M28,0 0,20" stroke="#cf142b" stroke-width="2"/><rect x="11" width="6" height="20" fill="#fff"/><rect y="7" width="28" height="6" fill="#fff"/><rect x="12" width="4" height="20" fill="#cf142b"/><rect y="8" width="28" height="4" fill="#cf142b"/></svg>`
      ),
    fr:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="20" viewBox="0 0 3 2"><rect width="1" height="2" x="0" fill="#0055A4"/><rect width="1" height="2" x="1" fill="#FFFFFF"/><rect width="1" height="2" x="2" fill="#EF4135"/></svg>`
      ),
  };
}
