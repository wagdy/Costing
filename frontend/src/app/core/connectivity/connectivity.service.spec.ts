import { TestBed } from '@angular/core/testing';
import { ConnectivityService } from './connectivity.service';

describe('what the app knows about its link to the server', () => {
  it('is online while the server answers and the hub is up, or still coming up', () => {
    const connectivity = TestBed.inject(ConnectivityService);

    connectivity.hub.set('connecting');
    expect(connectivity.online()).toBe(true);
    connectivity.hub.set('connected');
    expect(connectivity.online()).toBe(true);

    connectivity.markReachable(false);
    expect(connectivity.online()).toBe(false);
    connectivity.markReachable(true);
    connectivity.hub.set('reconnecting');
    expect(connectivity.online()).toBe(false);
  });
});
