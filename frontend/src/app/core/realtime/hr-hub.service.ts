import { Injectable, inject } from '@angular/core';
import { HttpError, HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { AuthService } from '../auth/auth.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { AttendanceSignal } from '../hr/attendance-signal';
import { EmployeeStatus } from '../hr/hr.api';

// The app's live connection to the server's hub, /hubs/hr. EmployeeStatusChanged, to whoever
// sees HR, brings each employee's card on who is in now as punches or a correction change it.
//
// Pushes sent while this browser was disconnected are not replayed, so every (re)connect has who
// is in read again.
@Injectable({ providedIn: 'root' })
export class HrHubService {
  private readonly auth = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly attendance = inject(AttendanceSignal);

  private connection: HubConnection | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  // Whether the app wants a connection: between start() and stop(). A connection closing
  // outside that window is not restarted.
  private wanted = false;

  async start(): Promise<void> {
    this.wanted = true;
    if (this.connection) {
      return;
    }

    const connection = new HubConnectionBuilder()
      // A browser cannot set headers on a WebSocket, so the token goes in the query string,
      // which the API accepts on /hubs only.
      .withUrl('/hubs/hr', { accessTokenFactory: () => this.auth.token() ?? '' })
      // The default gives up after four tries. This keeps trying for as long as it takes.
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (context) => Math.min(30_000, 1_000 * 2 ** Math.min(context.previousRetryCount, 5)),
      })
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on('EmployeeStatusChanged', (statuses: EmployeeStatus[]) => this.attendance.statusChanged(statuses));

    connection.onreconnecting(() => this.connectivity.hub.set('reconnecting'));
    connection.onreconnected(() => {
      this.connectivity.hub.set('connected');
      this.attendance.changed();
    });
    // Only after automatic reconnection gave up (it never does) or the API closed the
    // connection, as it does when the token expires.
    connection.onclose(() => {
      this.connectivity.hub.set('disconnected');
      this.connection = null;
      this.scheduleRestart();
    });

    this.connection = connection;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const connection = this.connection;
    this.connection = null;
    await connection?.stop();
    this.connectivity.hub.set('disconnected');
  }

  // The first connection can fail too (the server restarting); automatic reconnection only
  // covers one that was up, so this retries it.
  private async connect(): Promise<void> {
    const connection = this.connection;
    if (!connection || connection.state !== HubConnectionState.Disconnected) {
      return;
    }
    this.connectivity.hub.set('connecting');
    try {
      await connection.start();
      this.attempt = 0;
      this.connectivity.hub.set('connected');
      this.attendance.changed();
    } catch (error) {
      this.connectivity.hub.set('disconnected');
      // The API no longer accepts the token: retrying with it would never succeed.
      if (error instanceof HttpError && error.statusCode === 401) {
        this.auth.signOut('expired');
        return;
      }
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    if (!this.wanted || !this.auth.isSignedIn() || this.restartTimer) {
      return;
    }
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempt++, 5));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.connection) {
        void this.connect();
      } else {
        void this.start();
      }
    }, delay);
  }
}
