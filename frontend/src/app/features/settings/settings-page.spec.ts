import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { aCompany } from '../../../testing/fixtures';
import { Company, SettingsApi } from '../../core/settings/company';
import { NotifyService } from '../../core/ui/notify.service';
import { SettingsPage } from './settings-page';

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('the company settings', () => {
  const save = vi.fn();
  const uploadLogo = vi.fn();
  const removeLogo = vi.fn();
  const notify = { info: vi.fn(), error: vi.fn() };

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SettingsApi, useValue: { save, uploadLogo, removeLogo } },
        { provide: NotifyService, useValue: notify },
      ],
    });
    TestBed.inject(Company).settings.set(aCompany());
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as Record<string, any>;
    const refresh = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const saveButton = () => [...el.querySelectorAll<HTMLButtonElement>('.actions button')].find((b) => text(b).includes('Save'))!;
    return { el, page, refresh, saveButton };
  }

  beforeEach(() => {
    save.mockReset().mockImplementation((input) => of(aCompany(input)));
    uploadLogo.mockReset().mockReturnValue(of(aCompany({ hasCustomLogo: true, logoVersion: 7, logoUrl: '/api/company-settings/logo?v=7' })));
    removeLogo.mockReset().mockReturnValue(of(aCompany()));
    notify.info.mockReset();
    notify.error.mockReset();
  });

  it('shows how money will read as it is typed, and saves it for the whole app', async () => {
    const { el, page, refresh, saveButton } = await render();
    expect(text(el.querySelector('.preview')!)).toBe('L.E 1,400.00');

    page['currencySymbol'].set('SAR');
    page['currencyPosition'].set('After');
    await refresh();
    expect(text(el.querySelector('.preview')!)).toBe('1,400.00 SAR');
    // The time zone is as it was: nothing to warn of.
    expect(el.querySelector('.zone-warning')).toBeNull();

    saveButton().click();
    await refresh();
    expect(save).toHaveBeenCalledWith({
      name: 'Acme', currencySymbol: 'SAR', currencyPosition: 'After', country: 'Egypt', timeZoneId: 'Africa/Cairo', workdayStartsAtHour: 4,
    });
    expect(TestBed.inject(Company).money(5)).toBe('5.00 SAR');
    expect(notify.info).toHaveBeenCalledWith('Settings saved.');
  });

  it('warns plainly of a time zone change, and saves it only once the manager says they understand', async () => {
    const { el, page, refresh, saveButton } = await render();

    page['timeZoneId'].set('Asia/Riyadh');
    await refresh();
    const warning = el.querySelector('.zone-warning')!;
    expect(warning.getAttribute('role')).toBe('alert');
    expect(text(warning)).toContain('Changing the time zone from Africa/Cairo to Asia/Riyadh');
    expect(text(warning)).toContain('new sales, takings and entries fall on business days by the new zone');
    expect(text(warning)).toContain('What is recorded already stays on its day.');
    expect(saveButton().disabled).toBe(true);

    page['zoneUnderstood'] = true;
    await refresh();
    expect(saveButton().disabled).toBe(false);
    saveButton().click();
    await refresh();

    expect(save.mock.lastCall![0]).toMatchObject({ timeZoneId: 'Asia/Riyadh' });
    expect(notify.info).toHaveBeenCalledWith('Settings saved. New entries fall on business days by the new time zone.');
    // Saved: the zone is the company's now, and nothing is left to warn of.
    expect(el.querySelector('.zone-warning')).toBeNull();
  });

  it('previews the tab and the top bar, uploads a logo into both, and resets to the system’s icon', async () => {
    const { el, page, refresh } = await render();
    const section = el.querySelector('[aria-labelledby="logo-title"]')!;
    expect(text(section.querySelector('h2')!)).toBe('Company logo & browser tab icon شعار الشركة وأيقونة التبويب');
    // The system's own icon until there is a logo; nothing to reset.
    expect(section.querySelector('.tab img')?.getAttribute('src')).toBe('favicon.svg?v=2');
    expect(section.querySelector('.bar .bar-mark')).not.toBeNull();
    expect(text(section.querySelector('.tab-title')!)).toBe('Acme');
    const buttons = () => [...section.querySelectorAll<HTMLButtonElement>('.logo-actions button')];
    expect(buttons().map((b) => [text(b), b.disabled])).toEqual([
      ['upload Upload logo · رفع شعار', false],
      ['restart_alt Reset to default · استعادة الافتراضي', true],
    ]);
    expect(section.querySelector('input[type=file]')!.getAttribute('accept')).toContain('image/svg+xml');

    const picker = { files: [new File(['png'], 'logo.png', { type: 'image/png' })], value: 'C:\\fakepath\\logo.png' } as unknown as HTMLInputElement;
    await page['uploadLogo'](picker);
    await refresh();
    expect(uploadLogo).toHaveBeenCalledWith(expect.any(File));
    expect(picker.value).toBe('');
    expect([section.querySelector('.tab img')?.getAttribute('src'), section.querySelector('.bar img')?.getAttribute('src')]).toEqual([
      '/api/company-settings/logo?v=7',
      '/api/company-settings/logo?v=7',
    ]);
    expect(buttons()[1].disabled).toBe(false);

    buttons()[1].click();
    await refresh();
    expect(removeLogo).toHaveBeenCalled();
    expect(section.querySelector('.tab img')?.getAttribute('src')).toBe('favicon.svg?v=2');
    expect(section.querySelector('.bar img')).toBeNull();
  });

  it('refuses a logo over two megabytes before sending it', async () => {
    const { page } = await render();
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await page['uploadLogo']({ files: [big], value: 'x' } as unknown as HTMLInputElement);
    expect(uploadLogo).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith(null, expect.stringContaining('two megabytes'));
  });
});
