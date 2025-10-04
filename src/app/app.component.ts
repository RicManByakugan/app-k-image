import { Component, inject } from '@angular/core';
import {
  Router,
  NavigationEnd,
  ActivatedRoute,
  RouterOutlet,
  NavigationStart,
  RouteConfigLoadStart,
  RouteConfigLoadEnd,
  NavigationCancel,
  NavigationError,
} from '@angular/router';
import { filter } from 'rxjs/operators';
import { SeoService } from './core/services/seo.service';
import { LoaderService } from './core/services/loader.service';
import { LoaderOverlayComponent } from './shared/loader-overlay.component';
import { ThemeService } from './core/services/theme.service';
import { AlertCenterComponent } from './shared/components/alert/alert-center.component';
import { FunPopupComponent } from './shared/components/fun-popup/fun-popup.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    LoaderOverlayComponent,
    AlertCenterComponent,
    FunPopupComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private loader = inject(LoaderService);
  private seo = inject(SeoService);
  private pendingLazyLoads = 0;

  constructor(private theme: ThemeService) {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        let r = this.route;
        while (r.firstChild) r = r.firstChild;
        const cfg = r.snapshot.data?.['seo'];
        if (cfg) this.seo.apply(cfg);
      });
  }

  ngOnInit() {
    this.router.events.subscribe((evt) => {
      if (evt instanceof NavigationStart) this.loader.show();
      if (evt instanceof RouteConfigLoadStart) {
        this.pendingLazyLoads++;
        this.loader.show();
      }
      if (evt instanceof RouteConfigLoadEnd) {
        this.pendingLazyLoads = Math.max(0, this.pendingLazyLoads - 1);
      }
      if (
        evt instanceof NavigationEnd ||
        evt instanceof NavigationCancel ||
        evt instanceof NavigationError
      ) {
        // on laisse un micro délai pour éviter le clignotement sur des routes ultra rapides
        setTimeout(() => {
          if (this.pendingLazyLoads === 0) this.loader.hide();
        }, 120);
      }
    });
  }
}
