import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNav, SubNavTab } from '../shared/sub-nav';

// Recipes: the dishes' recipe cards, the prep items made in the kitchen from their own recipes,
// and the recipe categories. The production orders that make the prep items are a section of
// their own (Production).
@Component({
  selector: 'app-recipes-shell',
  imports: [RouterOutlet, SubNav],
  template: `
    <app-sub-nav label="Recipes" [tabs]="tabs" />
    <router-outlet />
  `,
  styleUrl: './costing.scss',
})
export class RecipesShell {
  // The dishes are everything under Recipes that is not the other tabs: their cards too.
  protected readonly tabs: SubNavTab[] = [
    { path: '.', icon: 'restaurant_menu', en: 'Dishes', ar: 'الأطباق', fallback: true },
    { path: 'prep', icon: 'blender', en: 'Prep items', ar: 'الأصناف نصف المصنعة' },
    { path: 'categories', icon: 'category', en: 'Categories', ar: 'أقسام الوصفات' },
  ];
}
