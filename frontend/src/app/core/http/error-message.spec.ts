import { HttpErrorResponse } from '@angular/common/http';
import { errorMessage, serverOutOfDate, serverUnreachable } from './error-message';

describe('what an error says', () => {
  it('says the API’s own words, and why when it has none', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 422, error: { detail: 'Give the shift its name.' } }))).toBe('Give the shift its name.');
    expect(errorMessage(new HttpErrorResponse({ status: 400, error: { errors: { name: ['The name is required.'] } } }))).toBe('The name is required.');
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toBe(serverUnreachable);
    // A record not found says which; an address with no endpoint, a server older than the screen.
    expect(errorMessage(new HttpErrorResponse({ status: 404, error: { detail: 'Shift 1 was not found.' } }))).toBe('Shift 1 was not found.');
    expect(errorMessage(new HttpErrorResponse({ status: 404, error: { title: 'Not Found', status: 404 } }), 'It could not be saved.')).toBe(serverOutOfDate);
    expect(errorMessage(new HttpErrorResponse({ status: 500 }), 'It could not be saved.')).toBe('It could not be saved.');
  });
});
