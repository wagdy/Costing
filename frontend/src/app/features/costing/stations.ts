import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CostingApi, KitchenStation } from '../../core/costing/costing.api';
import { FilterOption } from '../shared/filter-select';

// The kitchen and bar stations (أقسام التشغيل), loaded once for every page that sorts, filters or
// counts by them: each one's label, and the station something with none falls to (the shared one).
@Injectable({ providedIn: 'root' })
export class Stations {
  private readonly api = inject(CostingApi);
  private loading: Promise<void> | null = null;

  readonly list = signal<KitchenStation[]>([]);
  readonly active = computed(() => this.list().filter((s) => s.isActive));
  readonly shared = computed(() => this.list().find((s) => s.isShared) ?? null);

  load(again = false): Promise<void> {
    if (!this.loading || again) {
      this.loading = (async () => {
        try {
          this.list.set(await firstValueFrom(this.api.stations()));
        } catch {
          // Not offered: the pages work without stations.
        }
      })();
    }
    return this.loading;
  }

  // The station something is under: its own, else the shared station.
  of(id: string | null | undefined): string | null {
    return id && this.list().some((s) => s.id === id) ? id : (this.shared()?.id ?? null);
  }

  label(id: string | null | undefined): string {
    const station = this.list().find((s) => s.id === this.of(id));
    return station ? stationName(station) : 'Shared / General · خامات مشتركة';
  }

  // A filter pill's options over the items given: each station they are under, with how many.
  filter<T>(items: readonly T[], stationOf: (item: T) => string | null | undefined): FilterOption[] {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = this.of(stationOf(item)) ?? '';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [
      { value: '', label: 'All · الكل', count: items.length },
      ...this.list()
        .filter((s) => counts.has(s.id))
        .map((s) => ({ value: s.id, label: stationName(s), count: counts.get(s.id)! })),
      ...(counts.has('') ? [{ value: NoStation, label: 'Shared / General · خامات مشتركة', count: counts.get('')! }] : []),
    ];
  }

  // Whether an item is under the station a filter pill chose ('' all, NoStation none at all).
  matches(chosen: string, id: string | null | undefined): boolean {
    return !chosen || (chosen === NoStation ? this.of(id) === null : this.of(id) === chosen);
  }
}

// A filter's choice for what has no station when there is no shared station to put it under.
export const NoStation = '(no-station)';

export function stationName(station: Pick<KitchenStation, 'name' | 'nameAr'>): string {
  return station.nameAr ? `${station.name} · ${station.nameAr}` : station.name;
}
