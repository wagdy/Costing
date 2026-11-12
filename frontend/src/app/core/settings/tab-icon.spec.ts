import { TestBed } from '@angular/core/testing';
import { aCompany } from '../../../testing/fixtures';
import { Company } from './company';
import { TabIcon } from './tab-icon';

// The browser tab's icon follows the company's logo: the system's own icons until there is one, the
// logo the moment it is uploaded, the system's again once it is taken off. No reload.
describe('the browser tab’s icon', () => {
  const icons = () =>
    [...document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => [
      l.rel,
      l.getAttribute('href'),
      l.type || null,
    ]);

  beforeEach(() => {
    // As index.html leaves them.
    document.head.innerHTML = '<link rel="icon" href="favicon.ico?v=2" sizes="32x32"><link rel="shortcut icon" href="old.ico">';
  });

  it('is the system’s own until a logo is uploaded, then the logo, then the system’s again', async () => {
    TestBed.inject(TabIcon);
    const company = TestBed.inject(Company);
    TestBed.tick();
    expect(icons()).toEqual([
      ['icon', 'favicon.ico?v=2', null],
      ['icon', 'favicon.svg?v=2', 'image/svg+xml'],
      ['apple-touch-icon', 'apple-touch-icon.png?v=2', null],
    ]);
    expect(document.head.querySelector('link[rel="icon"][sizes]')?.getAttribute('sizes')).toBe('32x32');

    company.settings.set(aCompany({ hasCustomLogo: true, logoVersion: 9, logoUrl: '/api/company-settings/logo?v=9' }));
    TestBed.tick();
    expect(icons()).toEqual([
      ['icon', '/api/company-settings/logo?v=9', null],
      ['apple-touch-icon', '/api/company-settings/logo?v=9', null],
    ]);

    // A new logo is a new address.
    company.settings.set(aCompany({ hasCustomLogo: true, logoVersion: 10, logoUrl: '/api/company-settings/logo?v=10' }));
    TestBed.tick();
    expect(icons().map((i) => i[1])).toEqual(['/api/company-settings/logo?v=10', '/api/company-settings/logo?v=10']);

    company.settings.set(aCompany());
    TestBed.tick();
    expect(icons().map((i) => i[1])).toEqual(['favicon.ico?v=2', 'favicon.svg?v=2', 'apple-touch-icon.png?v=2']);
  });
});
