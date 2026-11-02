import { Component, computed, inject, input, model, output } from '@angular/core';
import { MaterialCost, recipeCostOf } from '../../core/costing/costing.api';
import { Company } from '../../core/settings/company';
import { ItemPicker, PickItem } from '../shared/item-picker';

// What a material costs now, per the unit it is bought in, as a pick row says it: its average, or
// for a prep item never made its recipe's ("L.E 18.00 / kg · by recipe").
export function materialCostText(material: MaterialCost, money: (n: number) => string): string | null {
  const perUnit = recipeCostOf(material);
  if (perUnit === null) {
    return null;
  }
  return `${money(perUnit * material.purchaseUnitSize)} / ${material.purchaseUnit}${material.costedByRecipe ? ' · by recipe' : ''}`;
}

// A raw material or prep item as a picker offers it: what it is, the unit it is bought in, its
// category, and what it costs now.
export function materialPickItem(material: MaterialCost, money: (n: number) => string): PickItem {
  return {
    id: material.id,
    name: material.name,
    code: material.code,
    kind: material.kind === 'Prep' ? 'prep' : 'material',
    unit: material.purchaseUnit,
    detail: material.category,
    cost: materialCostText(material, money),
  };
}

// A raw material or prep item chosen by typing (المكوّن): the first letters or its code find it, and
// the dropdown shows each with its code, what it is, the unit it is bought in and what it costs now.
// [(value)] the chosen one's id. canCreate: offers to add a material of the name typed (create).
@Component({
  selector: 'app-material-picker',
  imports: [ItemPicker],
  template: `
    <app-item-picker [items]="items()" [(value)]="value" [label]="label()" [placeholder]="placeholder()" [canCreate]="canCreate()"
      createLabel="Add new material · إضافة خامة" [disabled]="disabled()" (create)="create.emit($event)" />
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class MaterialPicker {
  private readonly company = inject(Company);

  readonly materials = input.required<readonly MaterialCost[]>();
  readonly value = model<string | null>(null);
  readonly label = input('Material');
  readonly placeholder = input('Type a name or code · اكتب الاسم أو الكود');
  readonly canCreate = input(false);
  readonly disabled = input(false);
  readonly create = output<string>();

  protected readonly items = computed(() => this.materials().map((m) => materialPickItem(m, (n) => this.company.money(n))));
}
