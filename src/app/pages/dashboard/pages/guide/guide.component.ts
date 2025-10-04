import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/services/language.service';
import { Subscription } from 'rxjs';
import { HeaderComponent } from '../../../../shared/layout/main/header/header.component';
import { FooterComponent } from '../../../../shared/layout/main/footer/footer.component';

type TocItem = { id: string; label: string };

const SIDEBAR_ITEMS = [
  { id: 'about', key: 'GUIDE.SIDEBAR.ABOUT' },
  { id: 'topbar', key: 'GUIDE.SIDEBAR.TOPBAR' },
  { id: 'sheet', key: 'GUIDE.SIDEBAR.SHEET' },
  { id: 'actions', key: 'GUIDE.SIDEBAR.ACTIONS' },
  { id: 'snapshots', key: 'GUIDE.SIDEBAR.SNAPSHOTS' },
  { id: 'files', key: 'GUIDE.SIDEBAR.FILES' },
  { id: 'summary', key: 'GUIDE.SIDEBAR.SUMMARY' },
  { id: 'faq', key: 'GUIDE.SIDEBAR.FAQ' },
] as const;

@Component({
  selector: 'app-guide',
  standalone: true,
  imports: [CommonModule, TranslateModule, FooterComponent, HeaderComponent],
  templateUrl: './guide.component.html',
})
export class GuideComponent implements AfterViewInit, OnDestroy {
  private t = inject(TranslateService);
  private lang = inject(LanguageService);

  toc: TocItem[] = [];
  activeId: string | null = null;

  @ViewChildren('guideSection') sections!: QueryList<ElementRef<HTMLElement>>;

  private iObserver?: IntersectionObserver;
  private sub?: Subscription;

  constructor() {
    // Reconstruit le TOC à chaque changement de langue et quand les traductions sont prêtes
    const keys = SIDEBAR_ITEMS.map((i) => i.key);
    this.sub = this.t.stream(keys).subscribe((dict) => {
      this.toc = SIDEBAR_ITEMS.map((i) => ({
        id: i.id,
        label: dict[i.key] ?? i.key, // fallback clé si manquante
      }));

      // Valeur active par défaut au premier item si non défini
      if (!this.activeId && this.toc.length) {
        this.activeId = this.toc[0].id;
      }
    });

    // (Optionnel) si ton LanguageService expose un signal/observable,
    // il peut déclencher le chargement de la langue. Sinon, rien à faire ici.
    this.lang.current();
  }

  ngAfterViewInit(): void {
    this.iObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) {
          this.activeId = visible.target.id;
        }
      },
      {
        root: null,
        rootMargin: '-80px 0px -60% 0px',
        threshold: [0.25, 0.5, 0.75, 1],
      }
    );

    // Observe chaque section après l'init de la vue
    setTimeout(() => {
      this.sections.forEach((ref) =>
        this.iObserver!.observe(ref.nativeElement)
      );
    });
  }

  scrollTo(id: string) {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.iObserver?.disconnect();
  }
}
