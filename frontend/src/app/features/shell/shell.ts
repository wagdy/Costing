import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
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
import { HrAccess } from '../../core/hr/hr-access';
import { HrHubService } from '../../core/realtime/hr-hub.service';
import { Company } from '../../core/settings/company';
import { Approvals } from '../approvals/approvals';

// Everything after sign-in: the toolbar with its sections and the connection's state, the banner
// while the server cannot be reached, and the live connection to it, which lives as long as this
// does.
@Component({
  selector: 'app-shell',
  imports: [CanDirective, MatButtonModule, MatIconModule, MatMenuModule, MatToolbarModule, MatTooltipModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  // HR & Payroll for whoever holds a tab of it, Custody & Assets for whoever holds its tab.
  protected readonly hr = inject(HrAccess);
  protected readonly connectivity = inject(ConnectivityService);
  // The Approvals link's count of what waits for a manager.
  protected readonly approvals = inject(Approvals);
  protected readonly Permissions = Permissions;
  // The company's name and logo, beside the sections.
  protected readonly company = inject(Company);
  private readonly hub = inject(HrHubService);
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
    void this.hub.start();
    void this.approvals.refresh();
  }

  ngOnDestroy(): void {
    void this.hub.stop();
  }

  protected async signOut(): Promise<void> {
    await this.hub.stop();
    this.auth.signOut();
  }
}
