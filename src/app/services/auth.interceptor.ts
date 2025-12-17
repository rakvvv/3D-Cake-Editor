import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();
  const apiBase = environment.apiBaseUrl;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const absoluteBase = apiBase.startsWith('http') ? apiBase : `${origin}${apiBase}`;
  const isApiRequest = req.url.startsWith(apiBase) || (!!absoluteBase && req.url.startsWith(absoluteBase));

  const authReq = token && isApiRequest ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        authService.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
