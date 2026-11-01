import { Injectable, computed, signal } from '@angular/core';

export type HubState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// This browser's link to the server. Everything goes through it, so while it is down the app can
// only show what it already has.
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  // The live connection to the server's hub, kept by HrHubService.
  readonly hub = signal<HubState>('disconnected');

  // Whether the last request reached the server at all.
  private readonly httpReachable = signal(true);

  readonly online = computed(() => this.httpReachable() && this.hub() !== 'reconnecting' && this.hub() !== 'disconnected');

  markReachable(reachable: boolean): void {
    this.httpReachable.set(reachable);
  }
}
