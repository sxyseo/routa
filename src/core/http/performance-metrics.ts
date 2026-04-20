/** 单次 API 请求的计时记录 */
export type ApiRouteTimingRecord = {
  timestamp: string;
  route: string;
  method: string;
  pathname: string;
  search: string;
  status: number;
  durationMs: number;
  thresholdMs: number;
};

/** SSE 连接记录 */
export type SSEConnectionRecord = {
  connId: string;
  route: string;
  workspaceId: string;
  connectedAt: string;
  disconnectedAt?: string;
  durationMs?: number;
};

/** 按路由聚合的统计 */
export type RouteSummary = {
  route: string;
  method: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  errorCount: number;
  lastSlowAt?: string;
};

/** Store 方法调用计时记录 */
export type StoreTimingRecord = {
  timestamp: string;
  storeName: string;
  method: string;
  durationMs: number;
};

/** DB 查询计时记录 */
export type DbTimingRecord = {
  timestamp: string;
  driver: string;
  operation: string;
  durationMs: number;
};

/** InMemory 环形缓冲区指标收集器 */
export class InMemoryMetricsCollector {
  private records: ApiRouteTimingRecord[] = [];
  private readonly maxRecords: number;
  private activeSSEConnections = new Map<string, SSEConnectionRecord>();
  private storeTimings: StoreTimingRecord[] = [];
  private dbTimings: DbTimingRecord[] = [];
  private readonly maxTimingRecords = 5000;

  constructor(maxRecords = 10_000) {
    this.maxRecords = maxRecords;
  }

  recordRequest(rec: ApiRouteTimingRecord): void {
    this.records.push(rec);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  recordSSEConnect(rec: SSEConnectionRecord): void {
    this.activeSSEConnections.set(rec.connId, rec);
  }

  recordSSEDisconnect(connId: string): void {
    const rec = this.activeSSEConnections.get(connId);
    if (rec) {
      rec.disconnectedAt = new Date().toISOString();
      rec.durationMs = Date.now() - new Date(rec.connectedAt).getTime();
      this.activeSSEConnections.delete(connId);
    }
  }

  recordStoreTiming(rec: StoreTimingRecord): void {
    this.storeTimings.push(rec);
    if (this.storeTimings.length > this.maxTimingRecords) {
      this.storeTimings = this.storeTimings.slice(-this.maxTimingRecords);
    }
  }

  recordDbTiming(rec: DbTimingRecord): void {
    this.dbTimings.push(rec);
    if (this.dbTimings.length > this.maxTimingRecords) {
      this.dbTimings = this.dbTimings.slice(-this.maxTimingRecords);
    }
  }

  getActiveSSEConnections(): SSEConnectionRecord[] {
    return Array.from(this.activeSSEConnections.values());
  }

  getSlowestRoutes(limit = 10): RouteSummary[] {
    const grouped = new Map<string, ApiRouteTimingRecord[]>();
    for (const rec of this.records) {
      const key = `${rec.method} ${rec.route}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(rec);
    }

    const summaries: RouteSummary[] = [];
    for (const [key, recs] of grouped) {
      const durations = recs.map((r) => r.durationMs).sort((a, b) => a - b);
      const count = durations.length;
      const sum = durations.reduce((a, b) => a + b, 0);
      const errorCount = recs.filter((r) => r.status >= 400).length;
      const lastSlow = recs.filter((r) => r.durationMs >= r.thresholdMs);
      const [method, ...routeParts] = key.split(" ");
      const route = routeParts.join(" ");

      summaries.push({
        route,
        method,
        count,
        avgMs: Math.round((sum / count) * 10) / 10,
        p50Ms: durations[Math.floor(count * 0.5)] ?? 0,
        p95Ms: durations[Math.floor(count * 0.95)] ?? 0,
        p99Ms: durations[Math.floor(count * 0.99)] ?? 0,
        maxMs: durations[count - 1] ?? 0,
        errorCount,
        lastSlowAt: lastSlow.length > 0 ? lastSlow[lastSlow.length - 1].timestamp : undefined,
      });
    }

    return summaries.sort((a, b) => b.avgMs - a.avgMs).slice(0, limit);
  }

  getStoreTimingSummaries(limit = 10): { storeName: string; method: string; count: number; avgMs: number; maxMs: number }[] {
    const grouped = new Map<string, StoreTimingRecord[]>();
    for (const rec of this.storeTimings) {
      const key = `${rec.storeName}.${rec.method}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(rec);
    }

    return Array.from(grouped.entries())
      .map(([key, recs]) => {
        const [storeName, method] = key.split(".");
        const durations = recs.map((r) => r.durationMs);
        return {
          storeName,
          method,
          count: durations.length,
          avgMs: Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10,
          maxMs: Math.max(...durations),
        };
      })
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, limit);
  }

  getDbTimingSummaries(limit = 10): { driver: string; operation: string; count: number; avgMs: number; maxMs: number }[] {
    const grouped = new Map<string, DbTimingRecord[]>();
    for (const rec of this.dbTimings) {
      const key = `${rec.driver}.${rec.operation}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(rec);
    }

    return Array.from(grouped.entries())
      .map(([key, recs]) => {
        const [driver, operation] = key.split(".");
        const durations = recs.map((r) => r.durationMs);
        return {
          driver,
          operation,
          count: durations.length,
          avgMs: Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10,
          maxMs: Math.max(...durations),
        };
      })
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, limit);
  }

  getRecentSlowRequests(limit = 20): ApiRouteTimingRecord[] {
    return this.records
      .filter((r) => r.durationMs >= r.thresholdMs)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, limit);
  }

  clear(): void {
    this.records = [];
    this.storeTimings = [];
    this.dbTimings = [];
  }

  get totalRequests(): number {
    return this.records.length;
  }

  get totalSSEConnections(): number {
    return this.activeSSEConnections.size;
  }
}

/** 全局单例 */
export const metricsCollector = new InMemoryMetricsCollector();
