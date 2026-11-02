import { compareValues, searchable, smartMatch, sortItems } from './smart-search';

describe('searching a list', () => {
  it('folds case, accents, Arabic letter forms, tashkeel and digits', () => {
    expect(searchable('  Crème   Brûlée ')).toBe('creme brulee');
    expect(searchable('أُرز إسكندراني')).toBe('ارز اسكندراني');
    expect(searchable('صلصة')).toBe('صلصه');
    expect(searchable('مقلى')).toBe('مقلي');
    expect(searchable('شاورمـــا')).toBe('شاورما');
    expect(searchable('٦١٠١')).toBe('6101');
    expect(searchable(null)).toBe('');
  });

  it('finds every word typed in any field, in any order', () => {
    expect(smartMatch('chick 12', 'Chicken breast', 'ING-12')).toBe(true);
    expect(smartMatch('12 chick', 'Chicken breast', 'ING-12')).toBe(true);
    expect(smartMatch('chick 13', 'Chicken breast', 'ING-12')).toBe(false);
    expect(smartMatch('ارز', 'Rice', 'أرز')).toBe(true);
    expect(smartMatch('', 'anything')).toBe(true);
  });
});

describe('sorting a list', () => {
  const items = [
    { name: 'Béchamel', cost: 40 },
    { name: 'Alfredo', cost: null },
    { name: 'Dough', cost: 18 },
    { name: 'Cheese', cost: 40 },
  ];

  it('sorts by the value asked, either way, those with none last both ways, ties by name', () => {
    const names = (direction: 1 | -1) => sortItems(items, { key: 'cost', direction }, (i) => i.cost, (i) => i.name).map((i) => i.name);

    expect(names(1)).toEqual(['Dough', 'Béchamel', 'Cheese', 'Alfredo']);
    expect(names(-1)).toEqual(['Béchamel', 'Cheese', 'Dough', 'Alfredo']);
    expect(items[0].name).toBe('Béchamel');
  });

  it('compares text by the reader’s language, numbers by size, and in code order', () => {
    expect(compareValues('item 2', 'item 10')).toBeLessThan(0);
    expect(compareValues(9, 10)).toBeLessThan(0);
    expect(compareValues('ب', 'أ')).toBeGreaterThan(0);
    expect(Number.isNaN(compareValues(null, 1))).toBe(true);
    expect(compareValues(null, undefined)).toBe(0);
  });
});
