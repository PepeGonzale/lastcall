export interface Broadcastable {
  send(data: string): void;
  readyState: number;
}

/**
 * Fan-out is deliberately dumb: one process, one hub. Scaling this out is a
 * broker subscription per instance, which is exactly why the log is already
 * partitioned per lot.
 */
export class Hub {
  private readonly clients = new Set<Broadcastable>();

  add(client: Broadcastable): void {
    this.clients.add(client);
  }

  remove(client: Broadcastable): void {
    this.clients.delete(client);
  }

  broadcast = (message: Record<string, unknown>): void => {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        try {
          client.send(data);
        } catch {
          this.clients.delete(client);
        }
      }
    }
  };

  get size(): number {
    return this.clients.size;
  }
}
