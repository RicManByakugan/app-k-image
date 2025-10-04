import { Routes } from '@angular/router';

export const ERROR_ROUTES: Routes = [
  {
    path: '404',
    loadComponent: () =>
      import('./not-found/not-found.component').then(
        (c) => c.NotFoundComponent
      ),
  },
  { path: '', pathMatch: 'full', redirectTo: '404' },
];
