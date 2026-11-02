// How every list in the app is searched and sorted: one way, so a name found on one page is found
// the same way on the next.

const arabicDigits = /[٠-٩۰-۹]/g;
// Tashkeel (the short vowels and their marks) and tatweel (the stretching line): not letters.
const marks = /[ً-ٰٟـ]/g;

// Text as a search compares it: lower case, without accents; Arabic with its alefs as one (أ إ آ
// ٱ → ا), taa marbuta as haa, alef maqsura as yaa, no tashkeel or tatweel; Arabic-Indic digits as
// Western ones; runs of space as one.
export function searchable(text: string | number | null | undefined): string {
  if (text === null || text === undefined) {
    return '';
  }
  return `${text}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(arabicDigits, (d) => `${(d.charCodeAt(0) & 0xf) % 10}`)
    .replace(marks, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Whether every word typed is in one of the fields, in any order: "chick 12" finds "Chicken breast"
// coded ING-12, and "دقيق" finds "Flour · دقيق". Nothing typed finds everything.
export function smartMatch(needle: string, ...fields: (string | number | null | undefined)[]): boolean {
  const words = searchable(needle).split(' ').filter(Boolean);
  if (words.length === 0) {
    return true;
  }
  const haystack = fields.map(searchable).join(' ');
  return words.every((word) => haystack.includes(word));
}

// How a list is sorted: by which of its options, and which way (1 ascending, -1 descending).
export interface SortState<K extends string = string> {
  key: K;
  direction: 1 | -1;
}

// One way a list can be sorted, named in both languages. Descending: the way it starts when chosen
// (the dearest first, the newest first), when ascending is not the natural first look.
export interface SortOption<K extends string = string> {
  key: K;
  en: string;
  ar: string;
  descending?: boolean;
}

// Two values in order: text by the reader's language (Arabic too), numbers by size. Nothing (null,
// undefined, NaN) sorts last either way: a list sorted by cost shows the items with no cost after
// those with one, whether dearest or cheapest first.
export function compareValues(a: string | number | boolean | null | undefined, b: string | number | boolean | null | undefined): number {
  const missing = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) || v === '';
  if (missing(a) || missing(b)) {
    return missing(a) === missing(b) ? 0 : Number.NaN;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  return `${a}`.localeCompare(`${b}`, undefined, { numeric: true, sensitivity: 'base' });
}

// A list sorted as asked: by what value() reads for the key, then by tiebreak() ascending, which is
// usually the name. Items with no value for the key come last, whichever way. The list is copied.
export function sortItems<T, K extends string>(
  items: readonly T[],
  sort: SortState<K>,
  value: (item: T, key: K) => string | number | boolean | null | undefined,
  tiebreak: (item: T) => string = () => '',
): T[] {
  return [...items].sort((a, b) => {
    const compared = compareValues(value(a, sort.key), value(b, sort.key));
    if (Number.isNaN(compared)) {
      // One of the two has no value: it goes last.
      const aMissing = compareValues(value(a, sort.key), 0);
      return Number.isNaN(aMissing) ? 1 : -1;
    }
    return sort.direction * compared || compareValues(tiebreak(a), tiebreak(b)) || 0;
  });
}
