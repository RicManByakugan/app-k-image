import { Routes } from '@angular/router';

export const routes: Routes = [
  // {
  //   path: 'auth',
  //   loadChildren: () =>
  //     import('./pages/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  //   data: {
  //     seo: {
  //       title: 'Connexion – AppLearn',
  //       description: 'Connectez-vous à AppLearn pour accéder à vos cours.',
  //       og: { siteName: 'AppLearn', type: 'website', locale: 'fr_FR' },
  //     },
  //   },
  // },
  // {
  //   path: '',
  //   loadChildren: () =>
  //     import('./pages/dashboard/dashboard.routes').then(
  //       (m) => m.DASHBOARD_ROUTES
  //     ),
  //   data: {
  //     seo: {
  //       title: 'Tableau de bord – AppLearn',
  //       description:
  //         'Suivez vos cours et votre progression sur le dashboard AppLearn.',
  //       og: { siteName: 'AppLearn', type: 'website', locale: 'fr_FR' },
  //     },
  //   },
  // },
  {
    path: '',
    loadComponent: () =>
      import('./pages/dashboard/pages/home/home.component').then(
        (c) => c.HomeComponent
      ),
  },
  {
    path: 'guide',
    loadComponent: () =>
      import('./pages/dashboard/pages/guide/guide.component').then(
        (c) => c.GuideComponent
      ),
  },
  { path: '**', redirectTo: '' },
];
