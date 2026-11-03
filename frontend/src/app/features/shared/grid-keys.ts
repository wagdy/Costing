import { Directive, ElementRef, Injector, afterNextRender, inject, output } from '@angular/core';

// The fields Enter moves between: what is typed into, not a checkbox nor a hidden one.
function fieldsOf(row: Element): HTMLInputElement[] {
  return [...row.querySelectorAll<HTMLInputElement>('input, textarea')].filter(
    (f) => !f.disabled && !f.readOnly && !['checkbox', 'radio', 'file', 'hidden', 'button', 'submit'].includes(f.type) && !f.closest('[hidden]'),
  );
}

function focus(field: HTMLInputElement | undefined): void {
  if (!field) {
    return;
  }
  field.focus();
  // Typed over, not added to.
  if (field.type !== 'number') {
    field.select?.();
  } else {
    try {
      field.select();
    } catch {
      // A number field cannot always be selected; focused is enough.
    }
  }
}

// Entry by keyboard alone in a grid of lines (an invoice's, a recipe's, a day's sales): Enter in a
// field moves to the next field of its row (the item, then its quantity, then its price); Enter in
// the last field of a row goes to the next row, or, on the last row, asks for a new one
// (appGridKeysAppend) and goes to its first field. An item chosen from an autocomplete with Enter
// moves on once it is chosen.
@Directive({
  selector: '[appGridKeys]',
  host: { '(keydown.enter)': 'enter($event)' },
})
export class GridKeys {
  // The page adds a line: the grid then goes to its first field.
  readonly append = output<void>({ alias: 'appGridKeysAppend' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected enter(event: Event): void {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || (event as KeyboardEvent).shiftKey || (event as KeyboardEvent).isComposing) {
      return;
    }
    // The lines only: a field in the footer (an invoice's discount) keeps its Enter.
    const row = field.closest('tbody tr');
    if (!row || !this.host.nativeElement.contains(row)) {
      return;
    }
    // An autocomplete took this Enter to choose its option: move on once the choice is in.
    const chose = event.defaultPrevented;
    event.preventDefault();
    if (chose) {
      setTimeout(() => this.next(row, field));
    } else {
      this.next(row, field);
    }
  }

  private next(row: Element, from: HTMLInputElement): void {
    const fields = fieldsOf(row);
    const at = fields.indexOf(from);
    if (at >= 0 && at < fields.length - 1) {
      focus(fields[at + 1]);
      return;
    }
    const rows = [...this.host.nativeElement.querySelectorAll('tbody tr')].filter((r) => fieldsOf(r).length > 0);
    const after = rows[rows.indexOf(row as HTMLTableRowElement) + 1];
    if (after) {
      focus(fieldsOf(after)[0]);
      return;
    }
    const before = rows.length;
    this.append.emit();
    afterNextRender(
      () => {
        const now = [...this.host.nativeElement.querySelectorAll('tbody tr')].filter((r) => fieldsOf(r).length > 0);
        if (now.length > before) {
          focus(fieldsOf(now[now.length - 1])[0]);
        }
      },
      { injector: this.injector },
    );
  }
}
