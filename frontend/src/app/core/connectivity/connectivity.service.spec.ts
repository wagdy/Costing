import { TestBed } from '@angular/core/testing';
import { ConnectivityService } from './connectivity.service';

describe('what the app knows about its link to the server', () => {
  it('is online while the server answers', () => {
    const connectivity = TestBed.inject(ConnectivityService);
    expect(connectivity.online()).toBe(true);

    connectivity.markReachable(false);
    expect(connectivity.online()).toBe(false);
    connectivity.markReachable(true);
    expect(connectivity.online()).toBe(true);
  });
});
