import net from "net";
import { getAgentPortPool } from "../acp/agent-port-pool";

const TASK_KEY_PREFIX = "task:";
const MAX_HEALTH_CHECK_FAILURES = 3;
const MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface TaskDevServerRecord {
  taskId: string;
  port: number;
  url: string;
  startedBySessionId: string;
  startedByColumnId: string;
  startedAt: Date;
  healthCheckFailures: number;
}

class TaskDevServerRegistry {
  private static instance: TaskDevServerRegistry | null = null;
  private records = new Map<string, TaskDevServerRecord>();

  private constructor() {}

  static getInstance(): TaskDevServerRegistry {
    if (!TaskDevServerRegistry.instance) {
      TaskDevServerRegistry.instance = new TaskDevServerRegistry();
    }
    return TaskDevServerRegistry.instance;
  }

  async ensureForTask(
    taskId: string,
    columnId: string,
    sessionId: string,
  ): Promise<{ port: number; url: string }> {
    const existing = this.records.get(taskId);
    if (existing) {
      return { port: existing.port, url: existing.url };
    }

    const poolKey = `${TASK_KEY_PREFIX}${taskId}`;
    const port = await getAgentPortPool().allocate(poolKey);
    const url = `http://localhost:${port}`;

    this.records.set(taskId, {
      taskId,
      port,
      url,
      startedBySessionId: sessionId,
      startedByColumnId: columnId,
      startedAt: new Date(),
      healthCheckFailures: 0,
    });

    return { port, url };
  }

  getForTask(taskId: string): TaskDevServerRecord | undefined {
    return this.records.get(taskId);
  }

  getUrlForTask(taskId: string): string | undefined {
    return this.records.get(taskId)?.url;
  }

  getPortForTask(taskId: string): number | undefined {
    return this.records.get(taskId)?.port;
  }

  async isHealthy(taskId: string): Promise<boolean> {
    const record = this.records.get(taskId);
    if (!record) return false;

    const alive = await checkTcpPort(record.port);
    if (!alive) {
      record.healthCheckFailures += 1;
    } else {
      record.healthCheckFailures = 0;
    }

    return alive;
  }

  shouldRelease(taskId: string): boolean {
    const record = this.records.get(taskId);
    if (!record) return false;

    if (record.healthCheckFailures >= MAX_HEALTH_CHECK_FAILURES) {
      return true;
    }

    const age = Date.now() - record.startedAt.getTime();
    if (age >= MAX_AGE_MS) {
      return true;
    }

    return false;
  }

  releaseForTask(taskId: string): void {
    const record = this.records.get(taskId);
    if (!record) return;

    const poolKey = `${TASK_KEY_PREFIX}${taskId}`;
    getAgentPortPool().release(poolKey);
    this.records.delete(taskId);
  }

  getActiveTaskIds(): string[] {
    return Array.from(this.records.keys());
  }

  releaseAll(): void {
    for (const taskId of this.records.keys()) {
      const poolKey = `${TASK_KEY_PREFIX}${taskId}`;
      getAgentPortPool().release(poolKey);
    }
    this.records.clear();
  }
}

function checkTcpPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 3000;

    socket.setTimeout(timeout);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, "127.0.0.1");
  });
}

export function getTaskDevServerRegistry(): TaskDevServerRegistry {
  return TaskDevServerRegistry.getInstance();
}
