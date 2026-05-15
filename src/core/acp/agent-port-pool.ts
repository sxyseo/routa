import { findAvailablePort } from "./docker/utils";

class AgentPortPool {
  private static instance: AgentPortPool | null = null;
  private usedPorts = new Set<number>();
  private sessionPorts = new Map<string, number>();

  private constructor() {}

  static getInstance(): AgentPortPool {
    if (!AgentPortPool.instance) {
      AgentPortPool.instance = new AgentPortPool();
    }
    return AgentPortPool.instance;
  }

  async allocate(sessionId: string): Promise<number> {
    const existing = this.sessionPorts.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }

    const port = await findAvailablePort(this.usedPorts);
    this.usedPorts.add(port);
    this.sessionPorts.set(sessionId, port);
    return port;
  }

  release(sessionId: string): void {
    const port = this.sessionPorts.get(sessionId);
    if (port !== undefined) {
      this.usedPorts.delete(port);
      this.sessionPorts.delete(sessionId);
    }
  }

  getPort(sessionId: string): number | undefined {
    return this.sessionPorts.get(sessionId);
  }

  releaseAll(): void {
    this.usedPorts.clear();
    this.sessionPorts.clear();
  }
}

export function getAgentPortPool(): AgentPortPool {
  return AgentPortPool.getInstance();
}
