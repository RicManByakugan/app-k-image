import { Routes } from '@angular/router';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component').then((c) => c.HomeComponent),
  },
  {
    path: 'guide',
    loadComponent: () =>
      import('./pages/guide/guide.component').then((c) => c.GuideComponent),
  },
];
