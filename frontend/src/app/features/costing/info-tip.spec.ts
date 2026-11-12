import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InfoTip } from './info-tip';
import { infoTips } from './info-tips';

@Component({
  imports: [InfoTip],
  template: `
    <h3>Financial impact <app-info-tip tip="ppvImpact" /></h3>
    <app-info-tip [tip]="{ title: { en: 'Own', ar: 'خاص' }, what: { en: 'What', ar: 'ما هو' }, how: { en: 'How', ar: 'كيف' } }" />
  `,
})
class Host {}

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('a figure’s (ⓘ)', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector<HTMLButtonElement>('app-info-tip button')!;
    const pop = () => document.querySelector('.info-pop');
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { el, button, pop, settle };
  }

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = '')));

  it('keeps the heading’s words its own, and names what it explains', async () => {
    const { el, button } = await render();
    expect(text(el.querySelector('h3')!)).toBe('Financial impact');
    expect(button.getAttribute('aria-label')).toBe('About Financial impact · الأثر المالي للانحراف');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('says what the figure is and how it is worked out, in Arabic and English, on hover and on focus', async () => {
    const { button, pop, settle } = await render();
    button.dispatchEvent(new MouseEvent('mouseenter'));
    await settle();
    const shown = pop()!;
    expect(shown.getAttribute('role')).toBe('tooltip');
    expect(button.getAttribute('aria-describedby')).toBe(shown.id);
    const [what, how] = [...shown.querySelectorAll('section')];
    expect(text(what.querySelector('h4')!)).toBe('الوصف · What it is');
    expect([...what.querySelectorAll('p')].map((p) => p.textContent)).toEqual([infoTips.ppvImpact.what.ar, infoTips.ppvImpact.what.en]);
    expect(text(how.querySelector('h4')!)).toBe("طريقة الحساب · How it's calculated");
    expect(text(how)).toContain('(Latest net price − baseline average) × quantity bought in the period');

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(pop()).toBeNull();

    button.dispatchEvent(new FocusEvent('focus'));
    await settle();
    expect(pop()).not.toBeNull();
    button.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(pop()).toBeNull();
  });

  it('stays open once tapped, until tapped again', async () => {
    const { button, pop, settle } = await render();
    button.click();
    await settle();
    expect(pop()).not.toBeNull();
    button.dispatchEvent(new MouseEvent('mouseleave'));
    await new Promise((r) => setTimeout(r, 200));
    await settle();
    expect(pop()).not.toBeNull();
    button.click();
    await settle();
    expect(pop()).toBeNull();
  });

  it('takes a tip made on the spot', async () => {
    const { el, settle, pop } = await render();
    const own = el.querySelectorAll<HTMLButtonElement>('app-info-tip button')[1];
    expect(own.getAttribute('aria-label')).toBe('About Own · خاص');
    own.click();
    await settle();
    expect(text(pop()!)).toContain('What');
  });

  it('has the description and the calculation of every tip, in both languages', () => {
    for (const [key, tip] of Object.entries(infoTips)) {
      for (const part of [tip.title, tip.what, tip.how]) {
        expect(part.en.trim(), key).not.toBe('');
        expect(part.ar.trim(), key).toMatch(/[؀-ۿ]/);
      }
    }
  });
});
