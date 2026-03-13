# Rust Unit-Test Fitness Snapshot

- scope: `routa-core + routa-server + routa-rpc + routa-cli`（按系统域分层）
- phase: `in_progress`
- hard_gate: `routa-server >= 50%`（持续 ratchet）

- baseline:
  - `routa-core`: `pending`
  - `routa-server`: `pending`
  - `routa-cli`: `pending`
  - `routa-rpc`: `pending`

- current: `pending`
- delta:
  - `api_use_case_coverage`: `+3`
  - `api_endpoints_added`: `7`
  - `negative_cases`: `3`
- blockers: `pending`

## System Testing Strategy

### 1) 单元层（最快捕获逻辑缺陷）
- `routa-core`: store、解析工具、workflow helper、状态转换、边界条件
- `routa-server`: helper / mapper / sanitizer 等 deterministic 逻辑
- `routa-rpc`: schema 转换与 RPC 错误映射
- `routa-cli`: command 入口和序列化路径

### 2) API 集成层（use-case 驱动）
- 以业务闭环为单位，而不是单接口切片。
- 采用 `start_server` + `reqwest` + `tokio::test`，真实进程内建数据库。
- 覆盖：
  - workspace + notes + codebase + tasks 关键流
  - 参数缺失、非法枚举、冲突状态等负向路径
  - 结果一致性（读列表/读详情）

### 3) 覆盖率层
- 指标：`cargo llvm-cov` line coverage。
- 记录方式：只在 `unit-test.md` 更新 “baseline/current/delta/next” 快照项。
- 门禁：server >= 50%，否则暂停合并。

### 4) 回归与 e2e 补充
- 高风险链路（UI 或前端依赖）通过 Playwright 截图/回放链路补充。
- 后端高风险链路通过 API 用例与健康检查最小集回归。

## Common Failures

- `status` 与 `columnId` 同步冲突
  - 典型症状：接口返回 400，但错误点未被覆盖
  - 应对：新增正反向断言并固定消息约束

- 外部依赖污染测试
  - 典型症状：偶发超时/网络抖动导致用例抖动
  - 应对：业务测试隔离外部调用，mock/短路优先

- 数据库状态污染
  - 典型症状：前后测试互相影响
  - 应对：每用例独立临时数据库，测试后清理

- 文件系统副作用未回收
  - 典型症状：临时目录残留，导致 CI 磁盘增长
  - 应对：Drop/teardown 清理 temp 目录

- 命名风格不一致
  - 典型症状：camelCase 与 snake_case 参数/字段错配
  - 应对：在 API 用例中同步验证请求体和响应 schema

## This Batch

- 新增 API 用例文件：`crates/routa-server/tests/rust_api_end_to_end.rs`
- 关注文件：`docs/fitness/rust-api-test.md`
- 说明：本批用于系统级通路覆盖，不添加命令执行日志
- next_batch:
  - `acp` / `agents` / `sessions` / `polling` use-case
  - 增加健康态势契约测试（`/api/health`）
