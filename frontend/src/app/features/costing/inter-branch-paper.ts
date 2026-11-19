import { UnitOfMeasure, countUnit } from '../../core/costing/costing.api';
import { Receipt, Requisition, Shipment, requisitionStatusLabels } from '../../core/costing/inter-branch.api';

// The central kitchen hub's papers: a requisition's slip and its WhatsApp message (quantities and
// units only, never a price), and a dispatch's internal sales invoice (with prices, for whoever sees
// them) or its delivery note (without). Each in a window of its own, so it prints as a paper.

// A quantity kept in grams, millilitres or pieces, as the material is counted: "4 kg", "250 ml".
export function shownQuantity(quantity: number, unit: UnitOfMeasure | string, purchaseUnitSize: number): string {
  const counted = countUnit(unit as UnitOfMeasure, purchaseUnitSize);
  return `${(quantity / counted.size).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${counted.label}`;
}

function day(iso: string | null): string {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// The requisition as a WhatsApp message to the kitchen: what is asked, how much, by when.
export function requisitionWhatsApp(requisition: Requisition, company: string): string {
  const due = day(requisition.requestedDeliveryDate);
  return [
    `*${company}* · طلب بضاعة *${requisition.number}*`,
    `Requisition *${requisition.number}*: ${requisition.requestingBranch} → ${requisition.supplyingBranch}`,
    '',
    ...requisition.lines.map(
      (l, i) => `${i + 1}. ${l.material} — ${shownQuantity(l.requestedQuantity, l.unit, l.purchaseUnitSize)}${l.notes ? ` (${l.notes})` : ''}`,
    ),
    '',
    due ? `Wanted by · مطلوب يوم: ${due}` : null,
    requisition.notes ? `Notes · ملاحظات: ${requisition.notes}` : null,
    '',
    'Please confirm · برجاء التأكيد 🙏',
  ]
    .filter((l) => l !== null)
    .join('\n')
    // No date and no notes: one blank line, not two.
    .replace(/\n{3,}/g, '\n\n');
}

const paperStyle = `
  body { font: 12px/1.4 system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 8px; color: #333; }
  .void { color: #b00020; font-weight: 700; }
  .head { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; margin: 12px 0 16px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #999; padding: 6px 8px; text-align: start; }
  th { background: #eee; } td.num, th.num { text-align: end; }
  tfoot td { font-weight: 600; }
  .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 48px; margin-top: 48px; }
  .signatures div { border-top: 1px solid #111; padding-top: 4px; }
  @page { margin: 14mm; }`;

function write(target: Window, title: string, body: string): void {
  target.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${paperStyle}</style></head><body>${body}</body></html>`);
  target.document.close();
  target.focus();
  target.print();
}

// The requisition slip (إذن طلب بضاعة): what the branch asks of the kitchen, for the kitchen to fill.
export function printRequisition(target: Window, requisition: Requisition, company: string): void {
  const status = requisitionStatusLabels[requisition.status];
  const rows = requisition.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.code ?? '')}</td><td>${escapeHtml(l.material)}</td>` +
        `<td class="num">${escapeHtml(shownQuantity(l.requestedQuantity, l.unit, l.purchaseUnitSize))}</td>` +
        `<td class="num">${escapeHtml(shownQuantity(l.dispatchedQuantity, l.unit, l.purchaseUnitSize))}</td><td>${escapeHtml(l.notes ?? '')}</td></tr>`,
    )
    .join('');
  write(
    target,
    `${requisition.number} · طلب بضاعة`,
    `<h1>${escapeHtml(company)} — Requisition · أمر طلب بضاعة من الفرع</h1>
    ${requisition.status === 'Cancelled' ? '<p class="void">CANCELLED · ملغي</p>' : ''}
    <div class="head">
      <div><strong>Number · الرقم:</strong> ${escapeHtml(requisition.number)}</div>
      <div><strong>Day · التاريخ:</strong> ${escapeHtml(day(requisition.requestDate))}</div>
      <div><strong>From · الفرع الطالب:</strong> ${escapeHtml(requisition.requestingBranch)}</div>
      <div><strong>To · المورد الداخلي:</strong> ${escapeHtml(requisition.supplyingBranch)}</div>
      <div><strong>Wanted by · مطلوب يوم:</strong> ${escapeHtml(day(requisition.requestedDeliveryDate) || '—')}</div>
      <div><strong>Status · الحالة:</strong> ${escapeHtml(`${status.en} · ${status.ar}`)}</div>
      <div><strong>Asked by · بواسطة:</strong> ${escapeHtml(requisition.createdBy)}</div>
      ${requisition.notes ? `<div><strong>Notes · ملاحظات:</strong> ${escapeHtml(requisition.notes)}</div>` : ''}
    </div>
    <table><thead><tr><th>Code · الكود</th><th>Material · الخامة</th><th class="num">Asked · المطلوب</th><th class="num">Sent · المصروف</th>
      <th>Note · ملاحظة</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="signatures"><div>Asked by · الطالب</div><div>Approved by the kitchen · اعتماد المطبخ المركزي</div></div>`,
  );
}

// The dispatch's paper: its internal sales invoice (إذن صرف وفاتورة بيع داخلية) with what each line
// costs and is billed at, or, for whoever does not see prices, its delivery note (إذن تسليم).
export function printShipment(target: Window, shipment: Shipment, company: string, money: (n: number) => string): void {
  const priced = shipment.totalTransferRevenue !== null;
  const rows = shipment.lines
    .map((l) => {
      const size = countUnit(l.unit, l.purchaseUnitSize).size;
      return (
        `<tr><td>${escapeHtml(l.code ?? '')}</td><td>${escapeHtml(l.material)}</td>` +
        `<td class="num">${escapeHtml(shownQuantity(l.quantity, l.unit, l.purchaseUnitSize))}</td>` +
        (priced
          ? `<td class="num">${escapeHtml(l.transferUnitPrice === null ? '' : money(l.transferUnitPrice * size))}</td>` +
            `<td class="num">${escapeHtml(l.lineRevenue === null ? '' : money(l.lineRevenue))}</td>`
          : '') +
        `<td class="num">${l.receivedQuantity === null ? '' : escapeHtml(shownQuantity(l.receivedQuantity, l.unit, l.purchaseUnitSize))}</td></tr>`
      );
    })
    .join('');
  const title = priced ? 'Internal sales invoice · فاتورة بيع داخلية' : 'Delivery note · إذن تسليم';
  write(
    target,
    `${shipment.number} · ${priced ? 'فاتورة بيع داخلية' : 'إذن تسليم'}`,
    `<h1>${escapeHtml(company)} — ${title}</h1>
    ${shipment.status === 'Voided' ? `<p class="void">VOIDED · ملغي${shipment.voidedBy ? ' — ' + escapeHtml(shipment.voidedBy) : ''}</p>` : ''}
    <div class="head">
      <div><strong>Number · الرقم:</strong> ${escapeHtml(shipment.number)}</div>
      <div><strong>Day · التاريخ:</strong> ${escapeHtml(day(shipment.dispatchDate))}</div>
      <div><strong>From · من:</strong> ${escapeHtml(`${shipment.supplyingBranch} — ${shipment.fromLocation}`)}</div>
      <div><strong>To · إلى:</strong> ${escapeHtml(shipment.receivingBranch)}</div>
      <div><strong>Requisition · الطلب:</strong> ${escapeHtml(shipment.requisitionNumber ?? 'Direct dispatch · صرف مباشر')}</div>
      <div><strong>Sent by · بواسطة:</strong> ${escapeHtml(shipment.createdBy)}</div>
      ${shipment.notes ? `<div><strong>Notes · ملاحظات:</strong> ${escapeHtml(shipment.notes)}</div>` : ''}
      ${priced ? '<div><strong>Inter-company · بين فروع الشركة</strong></div>' : ''}
    </div>
    <table><thead><tr><th>Code · الكود</th><th>Material · الخامة</th><th class="num">Sent · المرسل</th>
      ${priced ? '<th class="num">Price · سعر التحويل</th><th class="num">Total · الإجمالي</th>' : ''}
      <th class="num">Received · المستلم</th></tr></thead>
      <tbody>${rows}</tbody>
      ${priced ? `<tfoot><tr><td colspan="4">Total · الإجمالي</td><td class="num">${escapeHtml(money(shipment.totalTransferRevenue!))}</td><td></td></tr></tfoot>` : ''}
    </table>
    <div class="signatures"><div>Sent by the kitchen · المسلِّم</div><div>Received by the branch · المستلِم</div></div>`,
  );
}

// The branch's receipt and its internal purchase invoice (فاتورة مشتريات داخلية): what was sent,
// what came in and what was short, with the price billed for whoever sees prices.
export function printReceipt(target: Window, receipt: Receipt, company: string, money: (n: number) => string): void {
  const priced = receipt.totalBilled !== null;
  const rows = receipt.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.code ?? '')}</td><td>${escapeHtml(l.material)}</td>` +
        `<td class="num">${escapeHtml(shownQuantity(l.dispatchedQuantity, l.unit, l.purchaseUnitSize))}</td>` +
        `<td class="num">${escapeHtml(shownQuantity(l.receivedQuantity, l.unit, l.purchaseUnitSize))}</td>` +
        `<td class="num">${l.shortQuantity > 0 ? escapeHtml(shownQuantity(l.shortQuantity, l.unit, l.purchaseUnitSize)) : ''}</td>` +
        (priced
          ? `<td class="num">${escapeHtml(l.lineTotal === null ? '' : money(l.lineTotal))}</td>` +
            `<td class="num">${escapeHtml(l.transitLoss ? money(l.transitLoss) : '')}</td>`
          : '') +
        '</tr>',
    )
    .join('');
  write(
    target,
    `${receipt.number} · فاتورة مشتريات داخلية`,
    `<h1>${escapeHtml(company)} — ${priced ? 'Internal purchase invoice · فاتورة مشتريات داخلية' : 'Goods received note · إذن استلام'}</h1>
    ${receipt.status === 'Voided' ? `<p class="void">VOIDED · ملغي${receipt.voidedBy ? ' — ' + escapeHtml(receipt.voidedBy) : ''}</p>` : ''}
    <div class="head">
      <div><strong>Number · الرقم:</strong> ${escapeHtml(receipt.number)}</div>
      <div><strong>Day · التاريخ:</strong> ${escapeHtml(day(receipt.receiptDate))}</div>
      <div><strong>From · من:</strong> ${escapeHtml(receipt.supplyingBranch)}</div>
      <div><strong>Into · إلى:</strong> ${escapeHtml(`${receipt.receivingBranch} — ${receipt.toLocation}`)}</div>
      <div><strong>Shipment · الشحنة:</strong> ${escapeHtml(receipt.shipmentNumber)}</div>
      <div><strong>Requisition · الطلب:</strong> ${escapeHtml(receipt.requisitionNumber ?? 'Direct dispatch · صرف مباشر')}</div>
      <div><strong>Received by · بواسطة:</strong> ${escapeHtml(receipt.createdBy)}</div>
      ${receipt.notes ? `<div><strong>Notes · ملاحظات:</strong> ${escapeHtml(receipt.notes)}</div>` : ''}
    </div>
    <table><thead><tr><th>Code · الكود</th><th>Material · الخامة</th><th class="num">Sent · المرسل</th><th class="num">Received · المستلم</th>
      <th class="num">Short · العجز</th>${priced ? '<th class="num">Billed · المفوتر</th><th class="num">Transit loss · عجز النقل</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
      ${priced ? `<tfoot><tr><td colspan="5">Total · الإجمالي</td><td class="num">${escapeHtml(money(receipt.totalBilled!))}</td>`
        + `<td class="num">${escapeHtml(receipt.totalTransitLoss ? money(receipt.totalTransitLoss) : '')}</td></tr></tfoot>` : ''}
    </table>
    <div class="signatures"><div>Delivered by · المسلِّم</div><div>Received by · المستلِم</div></div>`,
  );
}
