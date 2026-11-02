import { Injectable, computed, signal } from '@angular/core';

// This browser's link to the server. Everything goes through it, so while it is down the app can
// only show what it already has.
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  // Whether the last request reached the server at all.
  private readonly httpReachable = signal(true);

  readonly online = computed(() => this.httpReachable());

  markReachable(reachable: boolean): void {
    this.httpReachable.set(reachable);
  }
}
