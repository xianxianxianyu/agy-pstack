/**
 * @fileoverview Source-faithful control-flow graphs for all 22 pstack Playbooks.
 *
 * Every branch, decision diamond, feedback loop, parallel Swarm subgraph,
 * mounted skill/principle/subagent, and cross-Playbook handoff maps 1:1 to
 * the actual markdown instructions in `skills/poteto-mode/playbooks/*.md`.
 */

export const PLAYBOOK_GRAPHS = {
  'bug-fix': {
    topologyLabel: '二分循环 · 条件分支',
    rows: [
      [{ id: 'repro', type: 'step', label: '1. 真实表面复现缺陷', sub: 'verify-* / CLI / 浏览器亲自复现', mounts: ['/browser'] }],
      [{ id: 'bisect', type: 'step', label: '2. 提出假设、查历史并插桩取证', mounts: ['/why', '/goal'] }],
      [{ id: 'found', type: 'decision', label: '已锁定唯一根因机制？' }],
      [{ id: 'cross', type: 'decision', label: '3. 修复是否跨函数/模块边界？' }],
      [
        { id: 'arch', type: 'step', label: '接口与边界定型', mounts: ['/architect'] },
        { id: 'local', type: 'step', label: '直接进入局部修复', sub: '不跨边界跳过架构设计' },
      ],
      [{ id: 'fix', type: 'step', label: '4. 委派最小修复并原表面复测', mounts: ['poteto-agent'] }],
      [{ id: 'cheap_test', type: 'decision', label: '5. 具备轻量本地测试路径？' }],
      [
        { id: 'tdd', type: 'step', label: '先红后绿有序提交', mounts: ['/tdd', 'sequence-verifiable-units'] },
        { id: 'skip_tdd', type: 'step', label: '跳过单测 · 保留实机证据', sub: '测试昂贵或集成度过高时' },
      ],
      [{ id: 'pr', type: 'subroutine', label: '整理提交与创建 PR · Opening a PR', targetPlaybook: 'opening-a-pr' }],
    ],
    subgraphs: [
      { id: 'sg_bisect', label: '二分假设淘汰环 · Binary Search', fromRow: 1, toRow: 2 },
    ],
    edges: [
      { from: 'repro', to: 'bisect' },
      { from: 'bisect', to: 'found' },
      { from: 'found', to: 'bisect', label: '否 · 淘汰一半假设', style: 'loop' },
      { from: 'found', to: 'cross', label: '是 · 机制实证' },
      { from: 'cross', to: 'arch', label: '跨边界' },
      { from: 'cross', to: 'local', label: '局部内' },
      { from: 'arch', to: 'fix' },
      { from: 'local', to: 'fix' },
      { from: 'fix', to: 'cheap_test' },
      { from: 'cheap_test', to: 'tdd', label: '是' },
      { from: 'cheap_test', to: 'skip_tdd', label: '否' },
      { from: 'tdd', to: 'pr' },
      { from: 'skip_tdd', to: 'pr' },
    ],
  },

  'feature': {
    topologyLabel: '并行分叉 · 方案竞选',
    rows: [
      [{ id: 'trace', type: 'step', label: '1. 梳理受影响子系统与架构定型', mounts: ['/architect'] }],
      [{ id: 'split', type: 'decision', label: '2. 吞吐检查：是否存在独立无共享切片？' }],
      [
        { id: 'fanout', type: 'step', label: '隔离工作区并行扇出', mounts: ['/swarm', 'separate-before-serializing-shared-state'] },
        { id: 'serial', type: 'step', label: '单主串行推进', sub: '共享写入或耦合单功能' },
      ],
      [{ id: 'shapes', type: 'decision', label: '3. 是否存在多种合理实现形态？' }],
      [
        { id: 'delegate', type: 'step', label: '委派编码实现', mounts: ['poteto-agent', 'model-the-domain'] },
        { id: 'arena', type: 'step', label: '多方案并行竞选并盲评融合', mounts: ['/arena'] },
      ],
      [{ id: 'verify', type: 'step', label: '4. 真实表面验证与分步整理提交', mounts: ['/browser', 'sequence-verifiable-units'] }],
      [{ id: 'contested', type: 'decision', label: '5. 设计是否存在争议或高风险？' }],
      [
        { id: 'interrogate', type: 'step', label: '对抗式代码审查', mounts: ['/interrogate'] },
        { id: 'direct_pr', type: 'step', label: '直接进入交付准备', sub: '设计无争议时跳过' },
      ],
      [{ id: 'pr', type: 'subroutine', label: '整理提交与创建 PR · Opening a PR', targetPlaybook: 'opening-a-pr' }],
    ],
    edges: [
      { from: 'trace', to: 'split' },
      { from: 'split', to: 'fanout', label: '独立文件 / 层' },
      { from: 'split', to: 'serial', label: '共享状态' },
      { from: 'fanout', to: 'shapes' },
      { from: 'serial', to: 'shapes' },
      { from: 'shapes', to: 'delegate', label: '形态明确' },
      { from: 'shapes', to: 'arena', label: '多方案可比选' },
      { from: 'delegate', to: 'verify' },
      { from: 'arena', to: 'verify' },
      { from: 'verify', to: 'contested' },
      { from: 'contested', to: 'interrogate', label: '有争议' },
      { from: 'contested', to: 'direct_pr', label: '无争议' },
      { from: 'interrogate', to: 'pr' },
      { from: 'direct_pr', to: 'pr' },
    ],
  },

  'refactoring': {
    topologyLabel: '行为锁死 · 价值门禁',
    rows: [
      [{ id: 'pin', type: 'step', label: '1. 编写特征测试/快照锁定现有行为', sub: '仅类型检查与 Lint 不构成行为契约' }],
      [{ id: 'target', type: 'step', label: '2. 命名缺失领域结构与目标形态', mounts: ['model-the-domain', '/architect'] }],
      [{ id: 'subtract', type: 'step', label: '3. 先删死代码与单层包装', mounts: ['subtract-before-you-add', 'laziness-protocol'] }],
      [{ id: 'move', type: 'step', label: '4. 小步迁移并同波删除旧接口', mounts: ['poteto-agent', 'migrate-callers-then-delete-legacy-apis'] }],
      [{ id: 'equiv', type: 'step', label: '5. 真实产物等价性验证', mounts: ['prove-it-works', '/browser'] }],
      [{ id: 'load', type: 'decision', label: '6. 阅读负担确实实质降低？' }],
      [
        { id: 'revert', type: 'step', label: '回滚该次重构', sub: '未降低阅读负担不保留' },
        { id: 'pr', type: 'subroutine', label: '按「减法→重组」提 PR · Opening a PR', targetPlaybook: 'opening-a-pr' },
      ],
    ],
    edges: [
      { from: 'pin', to: 'target' },
      { from: 'target', to: 'subtract' },
      { from: 'subtract', to: 'move' },
      { from: 'move', to: 'equiv' },
      { from: 'equiv', to: 'load' },
      { from: 'load', to: 'revert', label: '否 · 未改善' },
      { from: 'load', to: 'pr', label: '是 · 等价且更清晰' },
    ],
  },

  'investigation': {
    topologyLabel: '只读分流 · 出口路由',
    rows: [
      [{ id: 'qtype', type: 'decision', label: '1. 问题是否涉及历史设计动机？' }],
      [
        { id: 'why', type: 'step', label: '追踪源码 + 考证提交历史', mounts: ['research', '/why'] },
        { id: 'code', type: 'step', label: '只读追踪目标子系统源码', mounts: ['research'] },
      ],
      [{ id: 'report', type: 'step', label: '2. 产出架构说明或方案权衡对比表', mounts: ['/unslop'] }],
      [{ id: 'next', type: 'decision', label: '3. 调研是否紧接代码改动？' }],
      [
        { id: 'done', type: 'step', label: '交付只读结论收尾', sub: '不改代码、不建 PR' },
        { id: 'to_bug', type: 'subroutine', label: '缺陷修复 · Bug fix', targetPlaybook: 'bug-fix' },
        { id: 'to_feat', type: 'subroutine', label: '新功能开发 · Feature', targetPlaybook: 'feature' },
      ],
    ],
    edges: [
      { from: 'qtype', to: 'why', label: '问原因/演进' },
      { from: 'qtype', to: 'code', label: '问机制/归属' },
      { from: 'why', to: 'report' },
      { from: 'code', to: 'report' },
      { from: 'report', to: 'next' },
      { from: 'next', to: 'done', label: '纯调研' },
      { from: 'next', to: 'to_bug', label: '转修缺陷' },
      { from: 'next', to: 'to_feat', label: '转做特性' },
    ],
  },

  'perf-issue': {
    topologyLabel: '七诫逐层跳出循环',
    rows: [
      [{ id: 'base', type: 'step', label: '1. 采集真实负载基线 Trace 并验真', mounts: ['/benchmark-checklist'] }],
      [{ id: 'mantra', type: 'step', label: '2. 按「性能七诫」由廉至贵提出假设', sub: '不做 → 不重做 → 少做 → 延后 → 闲时 → 并发 → 降本' }],
      [{ id: 'impl', type: 'step', label: '3. 接口定型、委派修改并重采对比', mounts: ['/architect', 'poteto-agent', 'sequence-verifiable-units'] }],
      [{ id: 'met', type: 'decision', label: '4. 实测对比已达成目标？' }],
      [{ id: 'pr', type: 'subroutine', label: '附前后量化数据提 PR · Opening a PR', targetPlaybook: 'opening-a-pr' }],
    ],
    subgraphs: [
      { id: 'sg_mantra', label: '逐层尝试 · 达标即提前跳出', fromRow: 1, toRow: 3 },
    ],
    edges: [
      { from: 'base', to: 'mantra' },
      { from: 'mantra', to: 'impl' },
      { from: 'impl', to: 'met' },
      { from: 'met', to: 'mantra', label: '未达标 · 试下一准则', style: 'loop' },
      { from: 'met', to: 'pr', label: '已达标 · 提前停止' },
    ],
  },

  'hillclimb': {
    topologyLabel: '单变量实验闭环 · 保留/回滚',
    rows: [
      [{ id: 'metric', type: 'step', label: '1. 锚定真实负载、唯一指标与停止断言', sub: '目标阈值 + 最低迭代轮次下限' }],
      [{ id: 'harness', type: 'step', label: '2. 构建并冻结基准测具与决策台账', mounts: ['/benchmark-checklist', 'build-the-lever', '/show-me-your-work'] }],
      [{ id: 'attempt', type: 'step', label: '3. 提出机制假设并委派单变量改动', mounts: ['poteto-agent', '/swarm'] }],
      [{ id: 'check', type: 'decision', label: '4. 复测显著超噪且回归门禁全绿？' }],
      [
        { id: 'keep', type: 'step', label: 'Keep · 单次原子提交并记账', mounts: ['sequence-verifiable-units'] },
        { id: 'revert', type: 'step', label: 'Revert · 全量回滚并记账', mounts: ['laziness-protocol'] },
      ],
      [{ id: 'stop', type: 'decision', label: '5. 满足停止断言或已穷尽高价值思路？' }],
      [{ id: 'pr', type: 'subroutine', label: '按采纳顺序提 PR · Opening a PR', targetPlaybook: 'opening-a-pr' }],
    ],
    subgraphs: [
      { id: 'sg_hc', label: '科学爬山实验环 · 遇平台期切换维度', fromRow: 2, toRow: 5 },
    ],
    edges: [
      { from: 'metric', to: 'harness' },
      { from: 'harness', to: 'attempt' },
      { from: 'attempt', to: 'check' },
      { from: 'check', to: 'keep', label: '是 · 有效' },
      { from: 'check', to: 'revert', label: '否 · 无效/破坏' },
      { from: 'keep', to: 'stop' },
      { from: 'revert', to: 'stop' },
      { from: 'stop', to: 'attempt', label: '否 · 下一假设 / 破平台期', style: 'loop' },
      { from: 'stop', to: 'pr', label: '是 · 出环交付' },
    ],
  },

  'runtime-forensics': {
    topologyLabel: '动态取证 · 双出口交接',
    rows: [
      [{ id: 'capture', type: 'step', label: '1. 对活体进程抓取运行信号', sub: 'CPU Profile / 堆快照 / CDP Trace', mounts: ['/browser'] }],
      [{ id: 'reduce', type: 'step', label: '2. 子代理降噪收敛热点或 GC 保持链', mounts: ['guard-the-context-window'] }],
      [{ id: 'probe', type: 'step', label: '3. 热插桩或 CDP eval 证实致病机制' }],
      [{ id: 'source', type: 'step', label: '4. 映射至源码精确文件、符号与行号', sub: '输出只读诊断报告，不擅自改码' }],
      [
        { id: 'to_bug', type: 'subroutine', label: '交接 · 缺陷修复 (Bug fix)', targetPlaybook: 'bug-fix' },
        { id: 'to_perf', type: 'subroutine', label: '交接 · 性能优化 (Perf issue)', targetPlaybook: 'perf-issue' },
      ],
    ],
    edges: [
      { from: 'capture', to: 'reduce' },
      { from: 'reduce', to: 'probe' },
      { from: 'probe', to: 'source' },
      { from: 'source', to: 'to_bug', label: '逻辑缺陷', style: 'dashed' },
      { from: 'source', to: 'to_perf', label: '性能瓶颈', style: 'dashed' },
    ],
  },

  'trace-forensics': {
    topologyLabel: '离线解析 · 双出口交接',
    rows: [
      [{ id: 'load', type: 'step', label: '1. 识别快照格式并在子代理中隔离加载', mounts: ['guard-the-context-window'] }],
      [{ id: 'sqlite', type: 'step', label: '2. 将采样帧/堆节点导入 SQLite 聚合查询' }],
      [{ id: 'attr', type: 'step', label: '3. 定位热点调用栈并映射源码符号' }],
      [{ id: 'paired', type: 'decision', label: '4. 是否具备优化前后配对快照？' }],
      [
        { id: 'diff', type: 'step', label: '配对差分 · 确认为实证根因' },
        { id: 'hypo', type: 'step', label: '单快照 · 标明最强支撑假设' },
      ],
      [
        { id: 'to_bug', type: 'subroutine', label: '交接 · 缺陷修复 (Bug fix)', targetPlaybook: 'bug-fix' },
        { id: 'to_perf', type: 'subroutine', label: '交接 · 性能优化 (Perf issue)', targetPlaybook: 'perf-issue' },
      ],
    ],
    edges: [
      { from: 'load', to: 'sqlite' },
      { from: 'sqlite', to: 'attr' },
      { from: 'attr', to: 'paired' },
      { from: 'paired', to: 'diff', label: '有前后双份' },
      { from: 'paired', to: 'hypo', label: '仅单份' },
      { from: 'diff', to: 'to_bug', style: 'dashed' },
      { from: 'diff', to: 'to_perf', style: 'dashed' },
      { from: 'hypo', to: 'to_bug', style: 'dashed' },
      { from: 'hypo', to: 'to_perf', style: 'dashed' },
    ],
  },

  'prototype': {
    topologyLabel: '分叉门禁 · 多变体比选',
    rows: [
      [{ id: 'fork', type: 'decision', label: '1. 是否存在待决的交互或技术分叉？' }],
      [
        { id: 'scratch', type: 'step', label: '2. 在隔离草稿目录构建 2–3 套变体', sub: '共用一个切换开关便于并排对比', mounts: ['exhaust-the-design-space'] },
        { id: 'skip', type: 'subroutine', label: '无分叉 · 直转 Feature', targetPlaybook: 'feature' },
      ],
      [{ id: 'observe', type: 'step', label: '3. 实机截图或计时观测各变体表现', mounts: ['/browser'] }],
      [{ id: 'handoff', type: 'subroutine', label: '4. 拍板后移交正式实现 · Feature', targetPlaybook: 'feature' }],
    ],
    edges: [
      { from: 'fork', to: 'scratch', label: '有设计分叉' },
      { from: 'fork', to: 'skip', label: '方向已定' },
      { from: 'scratch', to: 'observe' },
      { from: 'observe', to: 'handoff', label: '丢弃原型 · 进入正式开发' },
    ],
  },

  'visual-parity': {
    topologyLabel: '阻塞前置 · 并行像素收敛环',
    rows: [
      [{ id: 'baseline', type: 'step', label: '1. 建立并冻结全状态视觉基线截图', sub: '阻塞前置：严禁修改基线或测具凑绿' }],
      [{ id: 'shared', type: 'step', label: '2. 底层共享原语先行迁移' }],
      [{ id: 'migrate', type: 'step', label: '3. 按组件隔离工作区并行迁移', mounts: ['/swarm', 'separate-before-serializing-shared-state'] }],
      [{ id: 'diff', type: 'decision', label: '4. 实机图像像素 diff 是否为 0？' }],
      [{ id: 'pr', type: 'subroutine', label: '按安全批次提 PR · Opening a PR', targetPlaybook: 'opening-a-pr' }],
    ],
    subgraphs: [
      { id: 'sg_vp', label: '每组件独立收敛环 · /browser + /goal', fromRow: 2, toRow: 3 },
    ],
    edges: [
      { from: 'baseline', to: 'shared' },
      { from: 'shared', to: 'migrate' },
      { from: 'migrate', to: 'diff' },
      { from: 'diff', to: 'migrate', label: 'diff ≠ 0 · 修正像素偏差', style: 'loop' },
      { from: 'diff', to: 'pr', label: 'diff = 0 · 全部通过' },
    ],
  },

  'multi-phase-plan': {
    topologyLabel: '规模门禁 · 规划交付',
    rows: [
      [{ id: 'size', type: 'decision', label: '1. 是否属于超过 2 个文件的复杂改动？' }],
      [
        { id: 'proto', type: 'subroutine', label: '2. 未知分叉先跑原型 · Prototype', targetPlaybook: 'prototype' },
        { id: 'skip', type: 'step', label: '跳过规划直接停手说明', sub: '1–2 个文件的清晰改动无需计划' },
      ],
      [{ id: 'plan', type: 'step', label: '3. 编写含依赖拓扑的 PR 拆栈清单', mounts: ['sequence-verifiable-units'] }],
      [{ id: 'gates', type: 'step', label: '4. 为每项绑定「单测 + 实机 + 性能」门禁', sub: '交付计划路径并等待人工确认开工' }],
    ],
    edges: [
      { from: 'size', to: 'proto', label: '复杂改造' },
      { from: 'size', to: 'skip', label: '小改动' },
      { from: 'proto', to: 'plan', label: '设计敲定' },
      { from: 'plan', to: 'gates' },
    ],
  },

  'opening-a-pr': {
    topologyLabel: '标准交付流水线',
    rows: [
      [{ id: 'wt', type: 'step', label: '1. 隔离工作区并重整为有序小提交', sub: '剥离无关修改，按逻辑拆清 commits' }],
      [{ id: 'clean', type: 'step', label: '2. 清理冗余注释并精炼差异文案', mounts: ['/no-comments', '/unslop'] }],
      [{ id: 'desc', type: 'step', label: '3. 编写 40 行内六节简报并创建正式 PR', sub: 'Why / What / Scope / Tradeoffs / Blast Radius / Verification' }],
    ],
    edges: [
      { from: 'wt', to: 'clean' },
      { from: 'clean', to: 'desc' },
    ],
  },

  'babysit': {
    topologyLabel: '三模式入口 · 冲突短路门禁',
    rows: [
      [{ id: 'mode', type: 'decision', label: '1. 首行声明值守模式' }],
      [
        { id: 'check', type: 'step', label: 'check · 单次巡检汇报' },
        { id: 'threads', type: 'step', label: 'threads-only · 只清评论' },
        { id: 'drive', type: 'step', label: 'drive · 循环推至可合并' },
      ],
      [{ id: 'conflict', type: 'decision', label: '2. 是否存在分支冲突或基线过期？' }],
      [
        { id: 'stop_rebase', type: 'step', label: '立即汇报需变基分支并停手', sub: '严禁擅自 rebase 或强推' },
        { id: 'triage', type: 'step', label: '3. 甄别评论推送修复并修复自身 CI', sub: '真缺陷先推再回 · 噪音给反证 · 敏感域升级' },
      ],
      [{ id: 'ready', type: 'step', label: '4. 停在可合并状态等待人工批准', sub: 'Babysit 永不越权执行合并' }],
    ],
    edges: [
      { from: 'mode', to: 'check' },
      { from: 'mode', to: 'threads' },
      { from: 'mode', to: 'drive' },
      { from: 'threads', to: 'conflict' },
      { from: 'drive', to: 'conflict' },
      { from: 'conflict', to: 'stop_rebase', label: '有冲突 · 短路' },
      { from: 'conflict', to: 'triage', label: '无冲突' },
      { from: 'triage', to: 'conflict', label: 'drive · 下一轮 watch-pr', style: 'loop' },
      { from: 'triage', to: 'ready', label: '线程清空且 CI 全绿' },
    ],
  },

  'shipping': {
    topologyLabel: '异源验收扇出 · 自底向上合入环',
    rows: [
      [{ id: 'verifiers', type: 'step', label: '1. 为每个 PR 派出未参与编码的独立验收员', mounts: ['/swarm', '/browser'] }],
      [{ id: 'ceiling', type: 'step', label: '2. 计算自栈底连续 PASS 的最高水位线', sub: '未通过 PR 之上暂停等待' }],
      [{ id: 'patchid', type: 'decision', label: '3. 核对 git patch-id：补丁是否漂移？' }],
      [
        { id: 'reverify', type: 'step', label: '实质变动 · 触发重新验收' },
        { id: 'merge', type: 'step', label: '4. 合并栈底 PR 并确认主干 MERGED', sub: '将上层 PR 改基至主干并监听 watch-pr' },
      ],
      [{ id: 'done', type: 'decision', label: '5. 已合并至连续通过水位线？' }],
      [{ id: 'report', type: 'step', label: '6. 停止并汇报各 PR 验收与合入结果' }],
    ],
    subgraphs: [
      { id: 'sg_ship', label: '自底向上逐个合入循环', fromRow: 2, toRow: 4 },
    ],
    edges: [
      { from: 'verifiers', to: 'ceiling' },
      { from: 'ceiling', to: 'patchid' },
      { from: 'patchid', to: 'reverify', label: '有实质变动' },
      { from: 'patchid', to: 'merge', label: '补丁等价' },
      { from: 'reverify', to: 'merge', label: '复验 PASS' },
      { from: 'merge', to: 'done' },
      { from: 'done', to: 'patchid', label: '否 · 处理下一个 PR', style: 'loop' },
      { from: 'done', to: 'report', label: '是 · 抵达水位线' },
    ],
  },

  'autonomous-run': {
    topologyLabel: '双唤醒分流 · 目标断言循环',
    rows: [
      [{ id: 'pred', type: 'step', label: '1. 定义机器可判定的退出断言', mounts: ['/goal'] }],
      [{ id: 'wake', type: 'decision', label: '2. 是否有明确外部等待事件（CI / 合并）？' }],
      [
        { id: 'ev_wake', type: 'step', label: '后台事件监听 + schedule 兜底' },
        { id: 'hb_wake', type: 'step', label: '固定间隔 schedule 心跳唤醒' },
      ],
      [{ id: 'iter', type: 'step', label: '3. 最小改动 → 验证断言 → 推进留/无效撤', mounts: ['sequence-verifiable-units', '/show-me-your-work'] }],
      [{ id: 'met', type: 'decision', label: '4. 退出断言已满足？' }],
      [{ id: 'cleanup', type: 'step', label: '5. 取消全部 schedule 定时器并交付报告' }],
    ],
    subgraphs: [
      { id: 'sg_auto', label: '自主收敛迭代环 · 顺手修障不卡壳', fromRow: 3, toRow: 4 },
    ],
    edges: [
      { from: 'pred', to: 'wake' },
      { from: 'wake', to: 'ev_wake', label: '有事件' },
      { from: 'wake', to: 'hb_wake', label: '无事件' },
      { from: 'ev_wake', to: 'iter' },
      { from: 'hb_wake', to: 'iter' },
      { from: 'iter', to: 'met' },
      { from: 'met', to: 'iter', label: '否 · 继续推进 / 遇平台换路', style: 'loop' },
      { from: 'met', to: 'cleanup', label: '是 · 达标停机' },
    ],
  },

  'autopilot-full': {
    topologyLabel: 'Swarm 扇出 · 异源验收 · 全自动合入',
    rows: [
      [{ id: 'gate', type: 'step', label: '1. 确认操作员授权边界与队列范围', mounts: ['/swarm'] }],
      [
        { id: 'o1', type: 'step', label: 'Owner 1 (隔离工作区)', sub: '开发 → Opening a PR → Babysit', mounts: ['/show-me-your-work'] },
        { id: 'on', type: 'step', label: 'Owner N (隔离工作区)', sub: '开发 → Opening a PR → Babysit', mounts: ['/no-comments', '/unslop'] },
      ],
      [{ id: 'verify', type: 'step', label: '3. 异源独立验收员实机复核', sub: '未编写代码的代理重跑门禁与真实表面', mounts: ['/browser'] }],
      [{ id: 'verdict', type: 'decision', label: '4. 独立验收 PASS 且变基后检查全绿？' }],
      [{ id: 'merge', type: 'step', label: '5. 合入主干并由协调层心跳巡检', sub: '仅合并已验收且匹配当前主干的补丁' }],
      [{ id: 'report', type: 'step', label: '6. 输出全队列交付简报并清理定时器', mounts: ['/ketchup'] }],
    ],
    subgraphs: [
      { id: 'sg_apf', label: 'Swarm 并行扇出 (独立基于主干，不堆叠)', fromRow: 1, toRow: 1 },
    ],
    edges: [
      { from: 'gate', to: 'o1' },
      { from: 'gate', to: 'on' },
      { from: 'o1', to: 'verify' },
      { from: 'on', to: 'verify' },
      { from: 'verify', to: 'verdict' },
      { from: 'verdict', to: 'o1', label: 'FAIL · 打回修复', style: 'loop' },
      { from: 'verdict', to: 'merge', label: 'PASS · 签字放行' },
      { from: 'merge', to: 'report' },
    ],
  },

  'autopilot-stack': {
    topologyLabel: '继承 Autopilot-full · 止步待合并',
    rows: [
      [{ id: 'base', type: 'subroutine', label: '复用 Autopilot-full 并行开发与验收框架', targetPlaybook: 'autopilot-full' }],
      [{ id: 'dep', type: 'decision', label: 'PR 之间是否存在上下游代码依赖？' }],
      [
        { id: 'stack', type: 'step', label: '堆叠基于父 PR 分支', sub: '父分支更新时级联 restack 并核验 patch-id' },
        { id: 'trunk', type: 'step', label: '直接独立基于主干并行', sub: '彼此无依赖时各自独立' },
      ],
      [{ id: 'freeze', type: 'step', label: '独立验收 PASS 且 CI 全绿后立即冻结', sub: '严禁自动合并，交由人工最终审阅合并' }],
      [{ id: 'report', type: 'step', label: '交付各 PR 验收结论清单', mounts: ['/ketchup'] }],
    ],
    edges: [
      { from: 'base', to: 'dep' },
      { from: 'dep', to: 'stack', label: '有依赖' },
      { from: 'dep', to: 'trunk', label: '相互独立' },
      { from: 'stack', to: 'freeze' },
      { from: 'trunk', to: 'freeze' },
      { from: 'freeze', to: 'report' },
    ],
  },

  'session-pickup': {
    topologyLabel: '无损重建 · 动态路由交接',
    rows: [
      [{ id: 'trail', type: 'step', label: '1. 解析前序 transcript、decisions.tsv 与分支', mounts: ['guard-the-context-window'] }],
      [{ id: 'diff', type: 'step', label: '2. 计算「已完成 vs 待办」差集，锁定恢复点', sub: '权威信任既有轨迹，严禁推倒重跑已完工项' }],
      [{ id: 'route', type: 'decision', label: '3. 路由剩余工作至对应目标 Playbook' }],
      [
        { id: 'r_bug', type: 'subroutine', label: 'Bug fix', targetPlaybook: 'bug-fix' },
        { id: 'r_feat', type: 'subroutine', label: 'Feature', targetPlaybook: 'feature' },
        { id: 'r_ship', type: 'subroutine', label: 'Shipping', targetPlaybook: 'shipping' },
      ],
      [{ id: 'prove', type: 'step', label: '4. 在真实产物上核验继承的最终目标', mounts: ['prove-it-works'] }],
    ],
    edges: [
      { from: 'trail', to: 'diff' },
      { from: 'diff', to: 'route' },
      { from: 'route', to: 'r_bug' },
      { from: 'route', to: 'r_feat' },
      { from: 'route', to: 'r_ship' },
      { from: 'r_bug', to: 'prove' },
      { from: 'r_feat', to: 'prove' },
      { from: 'r_ship', to: 'prove' },
    ],
  },

  'pause-safely': {
    topologyLabel: '原子停机 · 冷启动存档',
    rows: [
      [{ id: 'stop', type: 'step', label: '1. 收尾当前原子步并取消嵌套子代理', sub: '不做不可逆外部写入，不擅自建 PR 或推送' }],
      [{ id: 'wip', type: 'step', label: '2. 将未提交变更固化为清晰 wip: 提交' }],
      [{ id: 'note', type: 'step', label: '3. 写入磁盘恢复备忘录并汇报首步动作', mounts: ['/show-me-your-work'] }],
    ],
    edges: [
      { from: 'stop', to: 'wip' },
      { from: 'wip', to: 'note' },
    ],
  },

  'authoring-a-skill': {
    topologyLabel: '编写 · 校验 · 条件测试',
    rows: [
      [{ id: 'write', type: 'step', label: '1. 按原生规范撰写精炼 SKILL.md', mounts: ['encode-lessons-in-structure'] }],
      [{ id: 'validate', type: 'step', label: '2. 校验 YAML frontmatter 与跨文件链接' }],
      [{ id: 'struct', type: 'decision', label: '3. 技能规则是否包含结构化可测约束？' }],
      [
        { id: 'add_test', type: 'step', label: '补充自动化测试用例' },
        { id: 'skip_test', type: 'step', label: '主观类规范跳过单测' },
      ],
      [{ id: 'pr', type: 'subroutine', label: '整理提交与创建 PR · Opening a PR', targetPlaybook: 'opening-a-pr' }],
    ],
    edges: [
      { from: 'write', to: 'validate' },
      { from: 'validate', to: 'struct' },
      { from: 'struct', to: 'add_test', label: '是 · 结构化' },
      { from: 'struct', to: 'skip_test', label: '否 · 主观偏好' },
      { from: 'add_test', to: 'pr' },
      { from: 'skip_test', to: 'pr' },
    ],
  },

  'eval': {
    topologyLabel: '双盲隔离扇出 · 盲评与轨迹审计',
    rows: [
      [{ id: 'frame', type: 'step', label: '1. 编写仅裁判可见的评分量表与自然提示词', sub: '严格防泄密：隔离目录禁止出现 eval/judge 等暗示词' }],
      [
        { id: 'c1', type: 'step', label: '盲测候选 1 (独立分支)', mounts: ['/swarm'] },
        { id: 'cn', type: 'step', label: '盲测候选 N (独立分支)', mounts: ['run_workflow'] },
      ],
      [
        { id: 'judge', type: 'step', label: '3A. 匿名标签交叉盲评', mounts: ['/arena'] },
        { id: 'audit', type: 'step', label: '3B. 核查 transcript 真实读取链', sub: '拒绝候选自报，按真实打开的文件评分' },
      ],
      [{ id: 'synth', type: 'step', label: '4. 人工通读全部产物并综合裁决晋级与否' }],
    ],
    subgraphs: [
      { id: 'sg_eval', label: '双盲并行扇出 · 候选互不知情', fromRow: 1, toRow: 1 },
    ],
    edges: [
      { from: 'frame', to: 'c1' },
      { from: 'frame', to: 'cn' },
      { from: 'c1', to: 'judge' },
      { from: 'cn', to: 'judge' },
      { from: 'c1', to: 'audit' },
      { from: 'cn', to: 'audit' },
      { from: 'judge', to: 'synth' },
      { from: 'audit', to: 'synth' },
    ],
  },

  'worktree-cleanup': {
    topologyLabel: '安全审计 · 风险分流门禁',
    rows: [
      [{ id: 'audit', type: 'step', label: '1. 运行 worktree-audit.sh 扫描全部分支副本', mounts: ['build-the-lever', 'encode-lessons-in-structure'] }],
      [{ id: 'check_chat', type: 'step', label: '2. 并行检索活跃会话 transcript 核实占用', mounts: ['guard-the-context-window', 'prove-it-works'] }],
      [{ id: 'safe', type: 'decision', label: '3. 是否已合入、无未提交改动且无活跃占用？' }],
      [
        { id: 'pause', type: 'step', label: '暂停并展示 diff 请示人工', sub: 'wip 未提交或活跃会话占用严禁自动删' },
        { id: 'prune', type: 'step', label: '4. 安全移除并 git worktree prune', sub: '按需清理陈旧模拟器与缓存并对比 df -h' },
      ],
    ],
    edges: [
      { from: 'audit', to: 'check_chat' },
      { from: 'check_chat', to: 'safe' },
      { from: 'safe', to: 'pause', label: '存在 wip / 在用' },
      { from: 'safe', to: 'prune', label: '干净且已合入' },
    ],
  },

  'quick-research': {
    topologyLabel: '两轮极简流水线 · 并行速搜 + 一手核实 → 对比表交付',
    rows: [
      [{ id: 'search', type: 'step', label: '1. 并行调用 Parallel + Exa 摸底', sub: '复用 research.py（开源选型顺手并 repos / hn）', mounts: ['research.py'] }],
      [{ id: 'verify', type: 'step', label: '2. Top 3–5 候选一手核实', sub: '并行 repo 查真实活跃度/README 或 fetch 实测原文', mounts: ['prove-it-works'] }],
      [{ id: 'synthesize', type: 'step', label: '3. 汇总对比表、避坑点与推荐', sub: '直接聊天输出优劣表格与选型结论，不污染工作区', mounts: ['/unslop'] }],
      [{ id: 'escalate', type: 'decision', label: '4. 是否存在高风险分歧或需论文级溯源？' }],
      [
        { id: 'done', type: 'step', label: '直接结束并交付聊天结论', sub: '覆盖 80% 日常选型与速查' },
        { id: 'deep', type: 'subroutine', label: '建议升级 · Topic Research', targetPlaybook: 'topic-research' },
      ],
    ],
    edges: [
      { from: 'search', to: 'verify' },
      { from: 'verify', to: 'synthesize' },
      { from: 'synthesize', to: 'escalate' },
      { from: 'escalate', to: 'done', label: '结论充分' },
      { from: 'escalate', to: 'deep', label: '需双钻深挖' },
    ],
  },

  'topic-research': {
    topologyLabel: '双钻双技能状态机 · 第一钻探索定纲 + 第二钻取证成稿',
    rows: [
      [{ id: 'init', type: 'step', label: 'S0. 立项定界 (brief.md)', sub: '写明 Q1–Qn、硬约束、排除项与预算（模糊时可 /grill-me）', mounts: ['/grill-me', '/topic-research-plan'] }],
      [{ id: 'explore', type: 'step', label: 'S1–S2. 自适应锚定 + 正交轻探索', sub: '对象题先轻锚定，宽题直奔 2–3 隔离视角轻搜（含 Exa 分流）', mounts: ['/run-workflow', 'explore_plan_workflow.py'] }],
      [{ id: 'judge_merge', type: 'step', label: 'S3. 查证式三桶 Judge 合并', sub: '主线/对照/同名排除 + 原文核血缘 + 标 [核心必读]（默认关 Critic）', mounts: ['outline.md', 'report.py check-outline'] }],
      [{ id: 'outline_gate', type: 'decision', label: 'check-outline 0 错？' }],
      [{ id: 'gather', type: 'step', label: 'D1–D2. 并行精读与单文档抽取', sub: '按 [核心必读] 批处理精读（24h 缓存），flash 逐篇落盘禁多文档压缩', mounts: ['/topic-research', 'gather_evidence_workflow.py', '/browser'] }],
      [{ id: 'gap_gate', type: 'decision', label: '覆盖全部 Q 且有反证？' }],
      [{ id: 'synthesize', type: 'step', label: 'D4. 宏观分析、回填 [E#] 与分节写作', sub: '强模型定 analysis + 归属权，按节定点取证高可读成稿', mounts: ['synthesize_verify_workflow.py', 'writer.md'] }],
      [{ id: 'audit', type: 'step', label: 'D5. 机械校验与独立直读原文审校', sub: '0 错门禁 + 独立 Reviewer 直读 raw/ 核查事实、反证与可读性', mounts: ['report.py check', 'reviewer.md', 'audit.md'] }],
      [{ id: 'audit_gate', type: 'decision', label: '0 错且审校全关闭？' }],
      [{ id: 'render', type: 'step', label: 'D6. 渲染报告与精简交付', sub: '防回归校验通过后生成 report.md，仅交路径、结论与空白', mounts: ['report.py render', '/goal'] }],
    ],
    subgraphs: [
      { id: 'sg_diamond1', label: '第一钻 (/topic-research-plan) · 发散理解 → 收束定纲', fromRow: 0, toRow: 3 },
      { id: 'sg_gather', label: '第二钻·发散 2 (/topic-research) · 并行单文档取证 + Gap/反证轮', fromRow: 4, toRow: 5 },
      { id: 'sg_verify', label: '第二钻·收束 2 (/topic-research) · 分节成稿与防回归双轨门禁', fromRow: 6, toRow: 8 },
    ],
    edges: [
      { from: 'init', to: 'explore' },
      { from: 'explore', to: 'judge_merge' },
      { from: 'judge_merge', to: 'outline_gate' },
      { from: 'outline_gate', to: 'judge_merge', label: '否 · 局部修补(<2次)', style: 'loop' },
      { from: 'outline_gate', to: 'gather', label: '是 · 第一钻结束 (可 /compact)' },
      { from: 'gather', to: 'gap_gate' },
      { from: 'gap_gate', to: 'gather', label: '否 · Gap + 反证补查', style: 'loop' },
      { from: 'gap_gate', to: 'synthesize', label: '是 · 发散 2 结束 (可 /compact)' },
      { from: 'synthesize', to: 'audit' },
      { from: 'audit', to: 'audit_gate' },
      { from: 'audit_gate', to: 'synthesize', label: '否 · 防回归局部补丁', style: 'loop' },
      { from: 'audit_gate', to: 'render', label: '是 · 渲染交付' },
    ],
  },
};
