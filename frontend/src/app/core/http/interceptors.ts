import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ConnectivityService } from '../connectivity/connectivity.service';

// The user's token on every API call. A 401 on anything but the sign-in itself means the API no
// longer accepts it (it ran out, or the account changed), so the app goes back to the sign-in
// screen.
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const isApi = request.url.startsWith('/api/');
  const authorized = token && isApi ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        auth.isSignedIn() &&
        !request.url.startsWith('/api/auth/sign-in')
      ) {
        auth.signOut('expired');
      }
      return throwError(() => error);
    }),
  );
};

// Notes whether the server answered at all, which the banner goes by.
export const reachabilityInterceptor: HttpInterceptorFn = (request, next) => {
  const connectivity = inject(ConnectivityService);

  return next(request).pipe(
    tap(() => connectivity.markReachable(true)),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        connectivity.markReachable(error.status !== 0);
      }
      return throwError(() => error);
    }),
  );
};
