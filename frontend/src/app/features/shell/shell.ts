import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CanDirective } from '../../core/auth/can.directive';
import { Permissions } from '../../core/auth/permissions';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { Company } from '../../core/settings/company';
import { roleLabels } from '../../core/users/users.api';
import { Approvals } from '../costing/approvals';

// Everything after sign-in: the toolbar with its sections and the connection's state, and the
// banner while the server cannot be reached.
@Component({
  selector: 'app-shell',
  imports: [CanDirective, MatButtonModule, MatIconModule, MatMenuModule, MatToolbarModule, MatTooltipModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly connectivity = inject(ConnectivityService);
  // What waits for a manager, counted beside Costing & Financials.
  protected readonly approvals = inject(Approvals);
  protected readonly Permissions = Permissions;
  protected readonly roleLabels = roleLabels;
  // The company's name and logo, beside the sections.
  protected readonly company = inject(Company);
  // The signed-in user's first letters, in the avatar on their menu.
  protected readonly initials = computed(() =>
    (this.auth.me()?.fullName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join(''),
  );

  // Narrower than this, the nav shows its icons only (shell.scss), and tooltips name them.
  protected readonly compactNav = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 999.98px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  ngOnInit(): void {
    void this.approvals.refresh();
  }

  protected signOut(): void {
    this.auth.signOut();
  }
}
