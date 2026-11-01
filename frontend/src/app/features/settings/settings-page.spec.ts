import { TestBed } from '@angular/core/testing';
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
    uploadLogo.mockReset().mockReturnValue(of(aCompany({ hasLogo: true, logoVersion: 7 })));
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
      weekends: ['Friday'],
    });
    expect(TestBed.inject(Company).money(5)).toBe('5.00 SAR');
    expect(notify.info).toHaveBeenCalledWith('Settings saved.');
  });

  it('warns plainly of a time zone change, and saves it only once the manager says they will restart the devices', async () => {
    const { el, page, refresh, saveButton } = await render();

    page['timeZoneId'].set('Asia/Riyadh');
    await refresh();
    const warning = el.querySelector('.zone-warning')!;
    expect(warning.getAttribute('role')).toBe('alert');
    expect(text(warning)).toContain('Changing the time zone from Africa/Cairo to Asia/Riyadh');
    expect(text(warning)).toContain('new punches fall into workdays by the new zone');
    expect(text(warning)).toContain('You must restart every attendance device afterwards');
    expect(saveButton().disabled).toBe(true);

    page['zoneUnderstood'] = true;
    await refresh();
    expect(saveButton().disabled).toBe(false);
    saveButton().click();
    await refresh();

    expect(save.mock.lastCall![0]).toMatchObject({ timeZoneId: 'Asia/Riyadh' });
    expect(notify.info).toHaveBeenCalledWith('Settings saved. Restart every attendance device now, for it to take the new time zone.');
    // Saved: the zone is the company's now, and nothing is left to warn of.
    expect(el.querySelector('.zone-warning')).toBeNull();
  });

  it('uploads a logo, shows it, and takes it off', async () => {
    const { el, page, refresh } = await render();
    expect(text(el.querySelector('.no-logo')!)).toContain('No logo yet');

    const picker = { files: [new File(['png'], 'logo.png', { type: 'image/png' })], value: 'C:\\fakepath\\logo.png' } as unknown as HTMLInputElement;
    await page['uploadLogo'](picker);
    await refresh();
    expect(uploadLogo).toHaveBeenCalledWith(expect.any(File));
    expect(picker.value).toBe('');
    expect(el.querySelector('.logo img')?.getAttribute('src')).toBe('/api/settings/logo?v=7');

    await page['removeLogo']();
    await refresh();
    expect(removeLogo).toHaveBeenCalled();
    expect(el.querySelector('.logo img')).toBeNull();
  });
});
