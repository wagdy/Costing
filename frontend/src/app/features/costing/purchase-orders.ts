import { MatchStatus, PurchaseOrder, PurchaseOrderStatus, PurchaseOrderTerms } from '../../core/costing/costing.api';

// Purchase orders (أوامر الشراء) as the screens work them: the 3-way match worked out as an invoice
// is typed (the server's ThreeWayMatch, the same rules), and the order as a message for the supplier.

// Billed this much above the order's price before it is an overcharge, as the server allows.
export const priceTolerancePercent = 0.5;
const unit = 0.0005;

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

// What an invoice brings of a material: in its purchase units, at what it cost net of every discount.
export interface Delivered {
  rawMaterialId: string;
  purchaseQty: number;
  netCost: number | null;
}

// One item of a delivery against its order, as the screen shows it.
export interface LiveMatch {
  rawMaterialId: string;
  material: string;
  purchaseUnit: string;
  ordered: number;
  remaining: number;
  received: number;
  expectedUnitCost: number;
  netUnitPrice: number | null;
  unitOvercharge: number | null;
  overcharge: number;
  qtyOver: number;
  shortBy: number;
  priceOver: boolean;
  status: MatchStatus;
}

export interface LiveMatchResult {
  lines: LiveMatch[];
  overcharge: number;
  hasShort: boolean;
  needsApproval: boolean;
}

// Net unit price = net cost ÷ quantity received; over the price ordered by more than 0.5% and a
// piastre, an overcharge. More than was left to come, over; less, short. Not on the order, all over.
export function matchAgainst(order: PurchaseOrder, delivered: Delivered[], names: (id: string) => { name: string; unit: string }): LiveMatchResult {
  const by = new Map<string, { qty: number; cost: number | null }>();
  for (const d of delivered) {
    const was = by.get(d.rawMaterialId);
    by.set(d.rawMaterialId, {
      qty: (was?.qty ?? 0) + d.purchaseQty,
      cost: d.netCost === null && (was?.cost ?? null) === null ? null : (was?.cost ?? 0) + (d.netCost ?? 0),
    });
  }
  const line = (id: string, material: string, purchaseUnit: string, ordered: number, remaining: number, expected: number, notOrdered: boolean): LiveMatch => {
    const got = by.get(id);
    const received = got?.qty ?? 0;
    const net = received > 0 && got?.cost != null ? round(got.cost / received, 4) : null;
    const priceOver = !notOrdered && expected > 0 && net !== null && net > expected * (1 + priceTolerancePercent / 100) && round(net - expected) >= 0.01;
    const over = Math.max(received - remaining, 0);
    const shortBy = notOrdered ? 0 : Math.max(remaining - received, 0);
    const status: MatchStatus = notOrdered ? 'NotOrdered' : over > unit ? 'QtyOver' : priceOver ? 'PriceOvercharge' : shortBy > unit ? 'Short' : 'Matched';
    return {
      rawMaterialId: id, material, purchaseUnit, ordered, remaining, received: round(received, 3), expectedUnitCost: expected, netUnitPrice: net,
      unitOvercharge: priceOver ? round(net! - expected, 4) : null, overcharge: priceOver ? round((net! - expected) * received) : 0,
      qtyOver: over > unit ? round(over, 3) : 0, shortBy: shortBy > unit ? round(shortBy, 3) : 0, priceOver, status,
    };
  };
  const lines = order.lines.map((l) => line(l.rawMaterialId, l.material, l.purchaseUnit, l.orderedPurchaseQty, l.remainingQty, l.expectedUnitCost, false));
  for (const [id] of by) {
    if (!order.lines.some((l) => l.rawMaterialId === id)) {
      const named = names(id);
      lines.push(line(id, named.name, named.unit, 0, 0, 0, true));
    }
  }
  return {
    lines,
    overcharge: round(lines.reduce((sum, l) => sum + l.overcharge, 0)),
    hasShort: lines.some((l) => l.shortBy > 0),
    needsApproval: lines.some((l) => l.priceOver || l.qtyOver > 0),
  };
}

const quantity = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 3 });
const day = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : null;

// The order as a message to paste into WhatsApp: what, how much, by when, in English and Arabic;
// never what it is expected to cost the kitchen.
export function whatsAppText(order: PurchaseOrder, company: string): string {
  const due = day(order.expectedDeliveryDate);
  const lines = order.lines
    .filter((l) => (order.status === 'PartiallyReceived' ? l.remainingQty : l.orderedPurchaseQty) > 0)
    .map((l, i) => {
      const qty = order.status === 'PartiallyReceived' ? l.remainingQty : l.orderedPurchaseQty;
      return `${i + 1}. ${l.material} — ${quantity(qty)} ${l.purchaseUnit}${l.lineNotes ? ` (${l.lineNotes})` : ''}`;
    });
  return [
    `*${company}* · أمر شراء *${order.poNumber}*`,
    `Purchase order *${order.poNumber}* for ${order.supplier}`,
    '',
    ...lines,
    '',
    due ? `Delivery · التوريد: ${due}` : null,
    `Payment · الدفع: ${order.paymentTerms === 'Credit' ? 'On credit · آجل' : 'Cash · نقدي'}`,
    order.notes ? `Notes · ملاحظات: ${order.notes}` : null,
    order.status === 'PartiallyReceived' ? 'The rest of the order still to come · المتبقي من الطلبية' : null,
    '',
    'Please confirm · برجاء التأكيد 🙏',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export const termsLabels: Record<PurchaseOrderTerms, { en: string; ar: string }> = {
  Cash: { en: 'Cash', ar: 'نقدي' },
  Credit: { en: 'On credit', ar: 'آجل' },
};

// What a status filter pill holds: Approved / Open is approved, nothing received yet.
export const statusPills: { value: '' | PurchaseOrderStatus; en: string; ar: string }[] = [
  { value: '', en: 'All', ar: 'الكل' },
  { value: 'Draft', en: 'Draft', ar: 'مسودة' },
  { value: 'Approved', en: 'Approved / Open', ar: 'معتمد / مفتوح' },
  { value: 'PartiallyReceived', en: 'Partially received', ar: 'استلام جزئي' },
  { value: 'Completed', en: 'Completed', ar: 'مكتمل' },
  { value: 'Cancelled', en: 'Cancelled', ar: 'ملغى' },
];

// Tomorrow, as the API takes a day: an order's expected delivery unless another is chosen.
export function dayAfter(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
