import { HttpErrorResponse } from '@angular/common/http';

export const serverUnreachable = 'The server cannot be reached. Check this device is connected.';

// An address the server has no endpoint for: a screen newer than the server running behind it.
export const serverOutOfDate = 'The server does not have this yet: restart it so it runs the latest version.';

// What to tell whoever is using the app. The API writes every refusal as ProblemDetails, its
// detail (or errors[0]) meant to be shown as it is ("Enter an amount more than nothing.").
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return serverUnreachable;
    }
    const errors = error.error?.errors;
    if (Array.isArray(errors) && typeof errors[0] === 'string') {
      return errors[0];
    }
    // A model-validation 400: errors keyed by field.
    if (errors && typeof errors === 'object') {
      const first = Object.values(errors as Record<string, unknown>).flat()[0];
      if (typeof first === 'string') {
        return first;
      }
    }
    if (typeof error.error?.detail === 'string') {
      return error.error.detail;
    }
    // Not found, and nothing said why: no endpoint answers there (a record not found says which).
    if (error.status === 404) {
      return serverOutOfDate;
    }
  }
  return fallback;
}
