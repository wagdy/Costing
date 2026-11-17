import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CostingApi, PurchaseOrder } from '../../core/costing/costing.api';
import { NotifyService } from '../../core/ui/notify.service';
import { Approvals } from './approvals';
import { BusinessDay } from './financials';
import { PurchaseOrderDialog, PurchaseOrderDialogData, PurchaseOrderDialogResult } from './purchase-order-dialog';

// What is done to a purchase order from its screens: written (a new one, or a draft rewritten) and
// approved at once for a manager or asked of one for anyone else; called off; closed with what came.
@Injectable({ providedIn: 'root' })
export class PurchaseOrderActions {
  private readonly api = inject(CostingApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(NotifyService);
  private readonly approvals = inject(Approvals);
  private readonly businessDay = inject(BusinessDay);

  // The order's id once saved; null when cancelled or refused.
  async write(order: PurchaseOrder | null): Promise<string | null> {
    const [today, suppliers, materials] = await Promise.all([
      this.businessDay.today(),
      firstValueFrom(this.api.suppliers(true)),
      firstValueFrom(this.api.materials()),
    ]);
    const answer = await firstValueFrom(
      this.dialog
        .open<PurchaseOrderDialog, PurchaseOrderDialogData, PurchaseOrderDialogResult>(PurchaseOrderDialog, {
          data: { order, canApprove: this.approvals.canApprove(), today, suppliers, materials },
          width: '1080px',
          maxWidth: '96vw',
        })
        .afterClosed(),
    );
    if (!answer) {
      return null;
    }
    const id = order?.id ?? crypto.randomUUID();
    try {
      const saved = await firstValueFrom(this.api.savePurchaseOrder(id, answer.input));
      if (answer.approve) {
        await this.approveSaved(saved, answer.reason);
      } else {
        this.notify.info(`${saved.poNumber} saved as a draft. · حُفظ كمسودة.`);
      }
      return id;
    } catch (error) {
      this.notify.error(error, 'The purchase order could not be saved.');
      return null;
    }
  }

  async approve(order: PurchaseOrder): Promise<boolean> {
    try {
      await this.approveSaved(order, null);
      return true;
    } catch (error) {
      this.notify.error(error, 'The purchase order could not be approved.');
      return false;
    }
  }

  async cancel(order: PurchaseOrder): Promise<boolean> {
    if (!confirm(`Cancel ${order.poNumber}? Nothing more is received against it. · إلغاء أمر الشراء؟`)) {
      return false;
    }
    try {
      await firstValueFrom(this.api.cancelPurchaseOrder(order.id));
      this.notify.info(`${order.poNumber} cancelled. · ألغي أمر الشراء.`);
      await this.approvals.refresh();
      return true;
    } catch (error) {
      this.notify.error(error, 'The purchase order could not be cancelled.');
      return false;
    }
  }

  async close(order: PurchaseOrder): Promise<boolean> {
    if (!confirm(`Close ${order.poNumber} with what was received? What did not come is not expected any more. · إغلاق أمر الشراء بالكمية المستلمة؟`)) {
      return false;
    }
    try {
      await firstValueFrom(this.api.closePurchaseOrder(order.id));
      this.notify.info(`${order.poNumber} closed with what was received. · أُغلق أمر الشراء.`);
      return true;
    } catch (error) {
      this.notify.error(error, 'The purchase order could not be closed.');
      return false;
    }
  }

  private async approveSaved(order: PurchaseOrder, reason: string | null): Promise<void> {
    const result = await firstValueFrom(this.api.approvePurchaseOrder(order.id, crypto.randomUUID(), reason));
    if (result.outcome === 'Requested' && result.request) {
      await this.approvals.requested({ outcome: result.outcome, request: result.request });
    } else {
      this.notify.info(`${result.poNumber} approved: send it to the supplier. · تم اعتماد أمر الشراء.`);
    }
  }
}
