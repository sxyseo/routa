# 服务崩溃根因分析：Session 内存泄漏 → 原生模块 SEH 崩溃

> **日期**: 2026-05-14
> **崩溃时间**: 20:29:28
> **退出码**: 3765269347 (0xE06D7363, Windows VC++ SEH 异常)
> **恢复时间**: 20:46:41（手动重启）
> **当日崩溃次数**: 7 次（6 小时内）

## 1. 崩溃时间线

```
19:06:55  HttpSessionStore budget exceeded: 5457/5000（首次触发）
20:01:56  budget: 9321/5000（186% 超标，峰值）
20:22:35  fatal: not enough memory for initialization（git 子进程失败）
20:24:36  ClaudeCodeSdkAdapter: process exited with code 3221226505（SDK 崩溃）
20:29:28  === dev server exited (code=3765269347) ===
```

## 2. 根因

**Session 只创建、不销毁。**

`forceCleanup()` 有 5 层保护条件，ROUTA session 永远不会从内存删除：

1. `isStale` → 必须超过 1 小时无访问
2. `hasActiveSse` → 跳过有 SSE 连接的
3. `isStreaming` → 跳过正在流式传输的
4. `parentStillActive` → 父 session 存在时子 session 不删
5. **ROUTA 特殊保护**（`http-session-store.ts:1014-1033`）→ 即使无活跃子 session、已过期 3 小时，也只调用 `trimSessionData()`，永远不调用 `deleteSession()`

每个 session 在 `HttpSessionStore` 中维护 12 个 Map（sessions, messageHistory, agentEventBridges 等），崩溃时内存中有 77 个 session × 12 Map = 924 个 Map 条目无限制增长。

V8 堆碎片化 → GC 在 better-sqlite3 操作期间触发 → C++ 指针失效 → Windows SEH 终止进程。

## 3. 治理方案：2 处代码修改（只清内存，保留数据库）

### 核心原则

崩溃的根因是**内存中的 12 个 Map 无限增长**，不是数据库问题。因此只释放内存，不动数据库，确保 UI 仍可查看所有 session 执行记录。

### 修改 1：允许已完成 ROUTA session 从内存释放

**文件**: `src/core/acp/http-session-store.ts` — `forceCleanup()` (line 1014-1033)

**当前行为**：ROUTA session 3x 过期阈值（3 小时），过期后只 `trimSessionData()`，永远不 `deleteSession()`。

**修改为**：无活跃子 session + 过期 → 从内存删除（仅内存，不动数据库）。

```typescript
// ---- 修改前 (line 1014-1033) ----
if (session?.role === "ROUTA") {
  const hasActiveChildren = Array.from(this.sessions.values())
    .some(s => s.parentSessionId === _sessionId
      && !this.isSessionTerminal(s.sessionId));
  if (hasActiveChildren) {
    this.lastAccessTime.set(_sessionId, now);
    continue;
  }
  const routeStaleThreshold = staleThreshold * 3;          // ← 3 小时
  if (now - lastAccess <= routeStaleThreshold) {
    continue;
  }
  this.trimSessionData(_sessionId);                          // ← 只裁剪，永不删除
  this.lastAccessTime.set(_sessionId, now);
  continue;
}

// ---- 修改后 ----
if (session?.role === "ROUTA") {
  const hasActiveChildren = Array.from(this.sessions.values())
    .some(s => s.parentSessionId === _sessionId
      && !this.isSessionTerminal(s.sessionId));
  if (hasActiveChildren) {
    this.lastAccessTime.set(_sessionId, now);
    continue;
  }
  // 无活跃子 session + 已过期 → 从内存释放
  // 数据库记录保留，UI 仍可查看历史
  this.deleteSession(_sessionId);
  this.lastAccessTime.delete(_sessionId);
  removedCount++;
  continue;
}
```

### 修改 2：水合时只加载最近 6 小时的 session

**文件**: `src/core/acp/session-db-persister.ts` — `hydrateSessionsFromDb()` (line 171)
**文件**: `src/core/db/sqlite-stores.ts` — `SqliteAcpSessionStore.list()` (line 802)

**当前行为**：`list()` 返回全部 session，无时间过滤。

**修改为**：只加载最近 6 小时内创建的 session 到内存。

```typescript
// ---- SqliteAcpSessionStore.list() 增加时间过滤参数 ----
async list(options?: { createdAfter?: Date }): Promise<AcpSession[]> {
    let query = this.db
        .select()
        .from(sqliteSchema.acpSessions);
    if (options?.createdAfter) {
        query = query.where(
            gte(sqliteSchema.acpSessions.createdAt, options.createdAfter)
        );
    }
    const rows = await query.orderBy(desc(sqliteSchema.acpSessions.createdAt));
    return rows.map(this.toModel);
}

// ---- hydrateSessionsFromDb() 传入时间过滤 ----
export async function hydrateSessionsFromDb() {
    // ...
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 小时
    return await new SqliteAcpSessionStore(db).list({ createdAfter: cutoff });
}
```

## 4. 修改影响评估

### 4.1 修改 1 影响分析：ROUTA session 从内存删除

**`deleteSession()` 做了什么**（`http-session-store.ts:299-324`）：
- flush progressBuffer → dispose progressBuffer
- traceRecorder.cleanupSession()
- 删除 12 个 Map 条目（messageHistory, sessionActivities, sseControllers, agentEventBridges 等）
- eventBus.removeAgent()
- sessions.delete(sessionId)

**逐一检查所有 `getSession()` 调用方**：

| 调用方 | 文件 | 影响 | 风险 |
|--------|------|------|------|
| `sessions/[sessionId]/route.ts:30` | API 端点 | `getSession()` 返回 undefined → **已有 DB 降级**（line 31: `loadSessionFromDb()`） | **无** |
| `session-history.ts:30` | 历史加载 | `getSession()` 返回 undefined → `sessionRecord` 为 null → `loadSessionFromLocalStorage()` 降级 | **无** |
| `workflow-orchestrator.ts:1628` | 看板 watchdog | 查询 `acpStatus` → session 不在内存 → `sessionRecord` 为 undefined → 跳过 error 检查 | **无**（已完成的任务不需要 watchdog） |
| `acp-process-manager.ts:770` | 进程管理 | `getSession()` → undefined → **已有 DB 降级**（line 780-792: serverless cold start 逻辑） | **无** |
| `restart-recovery.ts:33` | 重启恢复 | `getSession()` → undefined → return false（session 不可恢复）| **无**（已完成的 session 确实不需要恢复） |
| `task-trigger-session.ts:32` | stale 检测 | `getSession()` → undefined → 不满足 embedded 判断 → 正常返回 | **无** |
| `session-prompt.ts:269,622,636` | prompt 构建 | 仅活跃 session 调用 → 已完成的 session 不会触发 | **无** |
| `sessions/[sessionId]/context/route.ts:29` | 上下文 API | `getSession()` → undefined → 404 | **低**（UI 查看已完成 session 的上下文会 404） |
| `sessions/[sessionId]/disconnect/route.ts:21` | 断开连接 | `getSession()` → undefined → 跳过 | **无** |
| `sessions/live-tails/route.ts:98` | SSE 尾部追踪 | `getSession()` → undefined → 不推送 | **无** |
| `mcp-tool-executor.ts:22` | MCP 工具 | 查询 provider → 活跃 session 才调用 | **无** |
| `orchestrator.ts:300` | 编排器 | `getSession()` → undefined → 用 fallbackCwd | **无** |
| `workflow-orchestrator-singleton.ts:532` | 工作流单例 | 活跃 session 才调用 | **无** |

**结论：所有调用方对 `getSession()` 返回 undefined 都有安全降级或根本不会被触发。**

#### 新问题检查

| 潜在问题 | 评估 | 结论 |
|----------|------|------|
| **活跃任务被误删** | 活跃 session 有 SSE → `hasActiveSse=true` → 整个 `if (isStale)` 块跳过 | **不会触发** |
| **ROUTA 有活跃子 session** | `hasActiveChildren=true` → continue 跳过 | **不会触发** |
| **任务完成但未合并** | 子 session terminal → 无活跃子 → ROUTA 可删除。但 DB 记录保留，`listSessions()` API 和 UI 不受影响 | **安全** |
| **UI 查看已完成 session 详情** | `sessions/[sessionId]/route.ts:31` 已有 `loadSessionFromDb()` 降级 → 正常显示 | **安全** |
| **UI 查看已完成 session 历史消息** | `session-history.ts` 使用 `loadHistoryFromDb()` → 不依赖内存 | **安全** |
| **eventBus 残留** | `deleteSession()` 调用 `eventBus.removeAgent()` → 清理完整 | **安全** |
| **progressBuffer 数据丢失** | `deleteSession()` 先 `flush()` 再 `dispose()` → 不丢数据 | **安全** |
| **traceRecorder 残留** | `deleteSession()` 调用 `traceRecorder.cleanupSession()` → 清理完整 | **安全** |

### 4.2 修改 2 影响分析：水合只加载 6 小时内 session

#### 接口兼容性

`AcpSessionStore.list()` 接口签名（`acp-session-store.ts:51`）：
```typescript
list(): Promise<AcpSession[]>;
```

修改后增加可选参数 `options?: { createdAfter?: Date }` → **向后兼容**，不破坏现有调用方。

`PgAcpSessionStore.list()`（`pg-acp-session-store.ts:69`）也需要同步增加参数支持。

#### 新问题检查

| 潜在问题 | 评估 | 结论 |
|----------|------|------|
| **活跃 session 超过 6 小时** | 正在执行的 session 在 6 小时内创建 → 不受影响 | **不会触发** |
| **重启后旧 session 丢失** | 超过 6 小时的 session 不加载到内存 → `getSession()` 返回 undefined → 已有 DB 降级 | **安全** |
| **RestartRecovery 恢复旧任务** | `restart-recovery.ts:33` 检查 `getSession()` → undefined → return false → 旧任务 lane session 不恢复 → 正确行为 | **安全** |
| **UI 查看旧 session** | API 端点通过 `loadSessionFromDb()` 降级 → 正常显示 | **安全** |
| **旧 session 的 stale binding 清理** | `hydrateFromDb()` 中 stale binding 检查只处理加载的 session → 超过 6 小时的不会被清理 | **低风险**（stale binding 在下次启动超 6 小时后不会被清理，但这是 edge case，且不影响功能） |

### 4.3 两处修改的组合风险

| 场景 | 行为 | 风险 |
|------|------|------|
| 正常执行中的任务 | SSE 保持连接 → `hasActiveSse=true` → forceCleanup 跳过 → 不受影响 | **无** |
| 任务刚完成（<1h） | 子 session 刚 terminal，ROUTA session 未过期 → forceCleanup 跳过 → 不受影响 | **无** |
| 任务完成 1-3h | 修改前：ROUTA session 保留 3h 后 trimData。修改后：1h 过期后删除内存 | **行为变化**：内存更早释放，但 DB 完整保留 |
| 服务重启 | 只加载 6h 内 session → 内存占用大幅减少 | **正面效果** |
| 同一进程运行 >6h | 修改 1 持续清理已完成 session → 内存不再累积 | **正面效果** |

## 5. 不需要修改的部分

| 项 | 决定 | 理由 |
|----|------|------|
| `deleteSession()` 中增加 DB 清理 | **不修改** | DB 记录用于 UI 历史查看 |
| `MAX_TOTAL_HISTORY_MESSAGES=5000` | **不修改** | session 数量减少后不再超标 |
| `CLEANUP_INTERVAL_MS=5min` | **不修改** | session 能正常清理后频率足够 |
| `pushNotification()` 逻辑 | **不修改** | 功能正确，问题在清理而非写入 |
| `trimSessionData()` | **不修改** | 修改 1 完全替代 trimData 为 deleteSession |

## 6. 预期效果

| 指标 | 修改前 | 修改后 |
|------|--------|--------|
| 内存 session 数量 | 77（持续增长） | ~20（活跃 + 最近 6 小时） |
| DB session_messages | 200K+（只增不减） | 200K+（保留） |
| 消息预算超标频率 | 每 5 分钟 | 基本不再超标 |
| 预期崩溃间隔 | 2-4 小时 | 不再因此崩溃 |
| UI 历史记录 | — | **完整保留** |
| 看板任务流影响 | — | **零影响** |

## 7. 根因链

```
Session 创建（无限制）
  → 12 个内存 Map 持续增长
  → 5 层保护机制阻止清理
  → ROUTA session 永远不删除
  → 重启后全部重新加载（77 sessions）
  → V8 堆碎片化 + GC 压力
  → better-sqlite3 C++ 异常
  → Windows SEH 终止进程 (0xE06D7363)
```

## 8. 关联文档

- [依赖门控评审](./dependency-gate-review-2026-05-14.md) — 同日发现的架构问题
- [CRAFTER 空跑问题](./crafter-empty-run-tf28-2026-05-14.md) — 完成判定缺少验证
- [DoneLaneRecovery 跳过冲突](./done-recovery-skip-conflict-tf00-2026-05-14.md) — COMPLETED 任务的 PR 问题
