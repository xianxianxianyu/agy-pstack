import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCatalog, DEFAULT_PLUGIN_ROOT, readCatalogSourceFile } from '../backend/catalog-builder.mjs';
import { AGENT_META, PLAYBOOK_META, PRINCIPLE_META, SKILL_META } from '../backend/metadata-zh.mjs';
import { checkWorkspaceHealth } from '../backend/workspace-health.mjs';
import { composePrompt } from '../shared/prompt-composer.mjs';
import { layoutFlowchart, renderFlowchartSvg, toMermaidCode } from '../shared/flowchart-svg.mjs';
import {
  extractUserGoalFromMarkdown,
  markdownToWysiwygHtml,
  syncComposedIntoUserMarkdown,
} from '../shared/markdown-wysiwyg.mjs';
import { createStandaloneStudioServer } from '../standalone.mjs';

test('buildCatalog discovers all 24 playbooks, 35 workflow skills, 24 principles, and 2 agents with 100% metadata alignment', () => {
  const emptyUserDir = mkdtempSync(join(tmpdir(), 'pstack-studio-clean-'));
  const emptyGeminiDir = join(emptyUserDir, 'gemini-cfg');
  let catalog;
  try {
    catalog = buildCatalog(DEFAULT_PLUGIN_ROOT, {
      userDir: emptyUserDir,
      geminiConfigDir: emptyGeminiDir,
    });
  } finally {
    rmSync(emptyUserDir, { recursive: true, force: true });
  }

  assert.equal(catalog.counts.playbooks, 24);
  assert.equal(catalog.counts.skills, 35);
  assert.equal(catalog.skills.filter((s) => !s.inAnyPlaybook).length, 21);
  assert.equal(catalog.skills.filter((s) => s.inAnyPlaybook).length, 14);
  assert.equal(catalog.skillLines.length, 4);
  const validLineIds = new Set(catalog.skillLines.map((l) => l.id));
  const standaloneLineCounts = {};
  for (const sk of catalog.skills) {
    assert.ok(validLineIds.has(sk.line), `Skill ${sk.id} missing valid line: ${sk.line}`);
    if (!sk.inAnyPlaybook) {
      standaloneLineCounts[sk.line] = (standaloneLineCounts[sk.line] || 0) + 1;
    }
  }
  assert.deepEqual(standaloneLineCounts, {
    verify: 6,
    understand: 6,
    retro: 5,
    engineering: 4,
  });
  assert.equal(catalog.counts.principles, 24);
  assert.equal(catalog.nativeModifiers.length, 14);
  for (const reqNative of ['boost', 'teamwork', 'run-workflow', 'schedule', 'generative_ui', 'automation', 'learn', 'compact', 'btw']) {
    assert.ok(catalog.nativeModifiers.some((n) => n.id === reqNative), `Missing native modifier ${reqNative}`);
  }
  assert.equal(catalog.counts.agents, 2);
  assert.equal(catalog.counts.recipes, 12);

  const pbIds = new Set(catalog.playbooks.map((p) => p.id));
  const skIds = new Set(catalog.skills.map((s) => s.id));
  const prIds = new Set(catalog.principles.map((p) => p.id));
  const agIds = new Set(catalog.agents.map((a) => a.id));
  const scIds = new Set(catalog.scenarios.map((s) => s.id));

  // Every disk file has explicit curated metadata in metadata-zh.mjs
  for (const id of pbIds) {
    assert.ok(PLAYBOOK_META[id], `Missing PLAYBOOK_META for ${id}`);
  }
  for (const id of skIds) {
    assert.ok(SKILL_META[id], `Missing SKILL_META for ${id}`);
  }
  for (const id of prIds) {
    assert.ok(PRINCIPLE_META[id], `Missing PRINCIPLE_META for ${id}`);
  }
  for (const id of agIds) {
    assert.ok(AGENT_META[id], `Missing AGENT_META for ${id}`);
  }

  // Every playbook has steps, valid scenario, and valid cross-references
  for (const pb of catalog.playbooks) {
    assert.ok(scIds.has(pb.scenario), `Invalid scenario ${pb.scenario} on playbook ${pb.id}`);
    assert.ok(pb.steps.length >= 2, `Expected >=2 steps on playbook ${pb.id}`);
    for (const sk of pb.builtinSkills) {
      assert.ok(skIds.has(sk), `Unknown builtinSkill ${sk} on playbook ${pb.id}`);
    }
    for (const pr of pb.builtinPrinciples) {
      assert.ok(prIds.has(pr), `Unknown builtinPrinciple ${pr} on playbook ${pb.id}`);
    }
  }

  // Every recipe references existing playbooks, skills, principles, and constraints
  const constraintIds = new Set(catalog.constraints.map((c) => c.id));
  const nativeIds = new Set(catalog.nativeModifiers.map((n) => n.id));
  for (const recipe of catalog.recipes) {
    assert.ok(scIds.has(recipe.scenario), `Invalid scenario on recipe ${recipe.id}`);
    if (recipe.primary.type === 'playbook') {
      assert.ok(pbIds.has(recipe.primary.id), `Recipe ${recipe.id} references unknown playbook ${recipe.primary.id}`);
    } else {
      assert.ok(skIds.has(recipe.primary.id), `Recipe ${recipe.id} references unknown skill ${recipe.primary.id}`);
    }
    for (const sk of recipe.addonSkills) {
      assert.ok(skIds.has(sk), `Recipe ${recipe.id} references unknown addonSkill ${sk}`);
    }
    for (const pr of recipe.principles) {
      assert.ok(prIds.has(pr), `Recipe ${recipe.id} references unknown principle ${pr}`);
    }
    for (const c of recipe.constraints) {
      assert.ok(constraintIds.has(c), `Recipe ${recipe.id} references unknown constraint ${c}`);
    }
    for (const n of recipe.nativeModifiers) {
      assert.ok(nativeIds.has(n), `Recipe ${recipe.id} references unknown nativeModifier ${n}`);
    }
  }

  // Intent matcher entries point to valid targets
  const recipeIds = new Set(catalog.recipes.map((r) => r.id));
  for (const intent of catalog.intentMatcher) {
    assert.ok(recipeIds.has(intent.recipeId), `Intent ${intent.id} references unknown recipe ${intent.recipeId}`);
    if (intent.recommendType === 'playbook') {
      assert.ok(pbIds.has(intent.recommendId));
    } else {
      assert.ok(skIds.has(intent.recommendId));
    }
  }
});

test('readCatalogSourceFile serves valid markdown and rejects path traversal', () => {
  const res = readCatalogSourceFile('skills/poteto-mode/playbooks/bug-fix.md', DEFAULT_PLUGIN_ROOT);
  assert.match(res.content, /### Bug fix/);

  assert.throws(() => readCatalogSourceFile('../../etc/passwd', DEFAULT_PLUGIN_ROOT));
  assert.throws(() => readCatalogSourceFile('plugin.json', DEFAULT_PLUGIN_ROOT));
});

test('checkWorkspaceHealth detects models rule, verify-* skills, and git platform', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pstack-studio-test-'));
  try {
    const geminiCfg = join(tempRoot, 'gemini-config');
    mkdirSync(join(geminiCfg, 'rules'), { recursive: true });
    writeFileSync(
      join(geminiCfg, 'rules', 'pstack-models.md'),
      '# budget: balanced\nbug-fix: inherit\nswarm workers: gemini-4-neon-high\n# gitlab rule\n'
    );

    const wsDir = join(tempRoot, 'my-gitlab-app');
    mkdirSync(join(wsDir, '.agents', 'skills', 'verify-web'), { recursive: true });
    writeFileSync(join(wsDir, '.agents', 'skills', 'verify-web', 'SKILL.md'), '---\nname: verify-web\n---\n');
    mkdirSync(join(wsDir, '.git'), { recursive: true });
    writeFileSync(join(wsDir, '.git', 'config'), '[remote "origin"]\n  url = git@gitlab.company.com:team/app.git\n');

    const health = checkWorkspaceHealth({
      workspaceUris: [`file://${wsDir}`],
      geminiConfigDir: geminiCfg,
    });

    assert.equal(health.summary.hasModelsRule, true);
    assert.equal(health.summary.modelsBudget, 'balanced');
    assert.equal(health.modelsRule.hasGitlabRule, true);
    assert.equal(health.summary.hasVerifySkill, true);
    assert.deepEqual(health.summary.verifySkills, ['verify-web']);
    assert.equal(health.summary.gitHost, 'gitlab');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('composePrompt generates structured zh/en prompts and flags host-only modifiers', () => {
  const catalog = buildCatalog(DEFAULT_PLUGIN_ROOT);

  const zhOut = composePrompt(
    {
      primary: { type: 'playbook', id: 'bug-fix' },
      addonSkills: ['tdd', 'interrogate'],
      principles: ['principle-prove-it-works'],
      constraints: ['repro-first', 'new-task'],
      nativeModifiers: ['browser', 'goal'],
      goal: '列表分页切换时偶发空白闪烁',
      doneCheck: '复现脚本连续运行 20 次无闪烁',
      lang: 'zh',
    },
    catalog
  );

  assert.match(zhOut.prompt, /^\/goal \/poteto-mode 【新任务】请严格按 \*\*Bug fix（缺陷修复）\*\* Playbook/);
  assert.match(zhOut.prompt, /任务目标：列表分页切换时偶发空白闪烁/);
  assert.match(zhOut.prompt, /验收标准（Done Check）：复现脚本连续运行 20 次无闪烁/);
  assert.match(zhOut.prompt, /\/tdd、\/interrogate、\/browser/);
  assert.match(zhOut.prompt, /principle-prove-it-works/);
  assert.equal(zhOut.hasPlaceholder, false);
  assert.deepEqual(zhOut.hostOnlySlashes, ['/goal']);

  // Skill primary deduplicates matching addon skill
  const enSkillOut = composePrompt(
    {
      primary: { type: 'skill', id: 'interrogate' },
      addonSkills: ['interrogate', 'blast-radius'],
      goal: 'Review current diff against main',
      lang: 'en',
    },
    catalog
  );
  assert.match(enSkillOut.prompt, /^\/interrogate Review current diff against main/);
  assert.match(enSkillOut.prompt, /\/blast-radius/);
  assert.doesNotMatch(enSkillOut.prompt, /Explicitly incorporate skills\/tools: \/interrogate/);
});

test('standalone server serves catalog, health, source, and dispatch preview endpoints', async () => {
  const cleanRoot = mkdtempSync(join(tmpdir(), 'pstack-studio-srv-'));
  const srv = createStandaloneStudioServer({
    port: 0,
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    userDir: join(cleanRoot, 'user'),
    geminiConfigDir: join(cleanRoot, 'gemini'),
  });
  const info = await srv.start();
  try {
    const catRes = await fetch(`${info.url}/api/catalog`);
    assert.equal(catRes.status, 200);
    const catJson = await catRes.json();
    assert.equal(catJson.counts.playbooks, 24);

    for (const assetPath of ['/', '/styles.css', '/app.js', '/shared/prompt-composer.mjs', '/shared/flowchart-svg.mjs', '/shared/markdown-wysiwyg.mjs', '/preload.js']) {
      const assetRes = await fetch(`${info.url}${assetPath}`);
      assert.equal(assetRes.status, 200, `Expected HTTP 200 for ${assetPath}`);
      const text = await assetRes.text();
      assert.ok(text.length > 50, `Expected non-empty body for ${assetPath}`);
      if (assetPath === '/app.js') {
        // Prove classic non-module JS parses cleanly with zero leftover import/export syntax
        assert.doesNotMatch(text, /^\s*(?:import|export)\s+/m);
        new Function(text);
      }
    }

    const srcRes = await fetch(`${info.url}/api/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: 'skills/interrogate/SKILL.md' }),
    });
    assert.equal(srcRes.status, 200);
    const srcJson = await srcRes.json();
    assert.match(srcJson.content, /interrogate/);

    const sendRes = await fetch(`${info.url}/_sidecar/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1', message: '/how explain studio' }),
    });
    assert.equal(sendRes.status, 200);
    assert.equal(srv.dispatchedMessages.length, 1);
    assert.equal(srv.dispatchedMessages[0].message, '/how explain studio');
  } finally {
    await srv.stop();
    rmSync(cleanRoot, { recursive: true, force: true });
  }
});

test('anti-slop structural gate: zero decorative emojis, concise shortDesc, valid vsHint targets', () => {
  const cleanRoot = mkdtempSync(join(tmpdir(), 'pstack-studio-slop-'));
  let catalog;
  try {
    catalog = buildCatalog(DEFAULT_PLUGIN_ROOT, {
      userDir: join(cleanRoot, 'user'),
      geminiConfigDir: join(cleanRoot, 'gemini'),
    });
  } finally {
    rmSync(cleanRoot, { recursive: true, force: true });
  }
  const pbIds = new Set(catalog.playbooks.map((p) => p.id));
  const skIds = new Set(catalog.skills.map((s) => s.id));
  const nativeIds = new Set(catalog.nativeModifiers.map((n) => n.id));

  for (const pb of catalog.playbooks) {
    assert.ok(pb.shortDesc.length <= 32, `Playbook ${pb.id} shortDesc too verbose: ${pb.shortDesc}`);
    if (pb.vsHint) {
      if (pb.vsHint.targetType === 'playbook') assert.ok(pbIds.has(pb.vsHint.targetId));
      if (pb.vsHint.targetType === 'skill') assert.ok(skIds.has(pb.vsHint.targetId));
    }
  }
  for (const sk of catalog.skills) {
    assert.ok(sk.shortDesc.length <= 32, `Skill ${sk.id} shortDesc too verbose: ${sk.shortDesc}`);
    if (sk.vsHint) {
      if (sk.vsHint.targetType === 'playbook') assert.ok(pbIds.has(sk.vsHint.targetId));
      if (sk.vsHint.targetType === 'skill') assert.ok(skIds.has(sk.vsHint.targetId));
      if (sk.vsHint.targetType === 'native') assert.ok(nativeIds.has(sk.vsHint.targetId));
    }
  }

  const appSource = readFileSync(join(DEFAULT_PLUGIN_ROOT, 'sidecars/studio/frontend/app.js'), 'utf-8');
  const metaSource = readFileSync(join(DEFAULT_PLUGIN_ROOT, 'sidecars/studio/backend/metadata-zh.mjs'), 'utf-8');
  const emojiRegex = /[\u{1F300}-\u{1FAFF}]/u;
  assert.equal(emojiRegex.test(appSource), false, 'app.js must not contain decorative emojis');
  assert.equal(emojiRegex.test(metaSource), false, 'metadata-zh.mjs must not contain decorative emojis');
});

test('all 24 playbooks have valid source-faithful control-flow graphs, SVG rendering, and Mermaid export', () => {
  const catalog = buildCatalog(DEFAULT_PLUGIN_ROOT);
  const pbIds = new Set(catalog.playbooks.map((p) => p.id));

  for (const pb of catalog.playbooks) {
    assert.ok(pb.graph, `Missing graph for playbook ${pb.id}`);
    const nodeIds = new Set();
    for (const row of pb.graph.rows) {
      assert.ok(row.length >= 1 && row.length <= 3, `Invalid row width on ${pb.id}`);
      for (const n of row) {
        assert.ok(!nodeIds.has(n.id), `Duplicate node id ${n.id} on ${pb.id}`);
        nodeIds.add(n.id);
        if (n.targetPlaybook) {
          assert.ok(pbIds.has(n.targetPlaybook), `Unknown targetPlaybook ${n.targetPlaybook} on ${pb.id}`);
        }
      }
    }
    for (const e of pb.graph.edges) {
      assert.ok(nodeIds.has(e.from), `Unknown edge.from ${e.from} on ${pb.id}`);
      assert.ok(nodeIds.has(e.to), `Unknown edge.to ${e.to} on ${pb.id}`);
    }
    const layout = layoutFlowchart(pb.graph);
    for (const n of layout.nodes) {
      if (n.type === 'decision') {
        assert.ok(n.w >= 200 && n.h >= 70, `Diamond ${n.id} on ${pb.id} too cramped (${n.w}x${n.h})`);
      }
      for (const cr of n.chipRows || []) {
        assert.ok(
          cr.totalW <= n.w - 16,
          `Chip row overflows node ${n.id} on ${pb.id}: chips=${cr.totalW} > node.w=${n.w}`
        );
      }
    }

    const svg = renderFlowchartSvg(pb.graph);
    assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
    assert.match(svg, /<\/svg>$/);

    const mmd = toMermaidCode(pb.graph);
    assert.match(mmd, /^flowchart TD\n/);
  }
});

test('markdown WYSIWYG renders formatted HTML and preserves user edits when syncing new options', () => {
  const catalog = buildCatalog(DEFAULT_PLUGIN_ROOT);
  const initial = composePrompt(
    {
      primary: { type: 'playbook', id: 'feature' },
      addonSkills: ['architect'],
      principles: ['principle-prove-it-works'],
      constraints: ['real-proof'],
      lang: 'zh',
    },
    catalog
  ).prompt;

  const html = markdownToWysiwygHtml(initial);
  assert.match(html, /<strong>Feature（新功能开发）<\/strong>/);
  assert.match(html, /<code class="md-code">skills\/poteto-mode\/playbooks\/feature\.md<\/code>/);
  assert.match(html, /<ul class="md-list"><li>/);
  assert.match(html, /<span class="md-slash">\/poteto-mode<\/span>/);

  // User edits goal directly in WYSIWYG, then toggles +/interrogate and +principle-laziness-protocol below
  const userEdited = initial.replace(
    '<在此填写具体目标、问题现象或涉及模块>',
    '给用户管理页增加按角色筛选与 CSV 导出'
  );
  const nextFresh = composePrompt(
    {
      primary: { type: 'playbook', id: 'feature' },
      addonSkills: ['architect', 'interrogate'],
      principles: ['principle-prove-it-works', 'principle-laziness-protocol'],
      constraints: ['real-proof', 'review-before-code'],
      nativeModifiers: ['goal'],
      lang: 'zh',
    },
    catalog
  ).prompt;

  const synced = syncComposedIntoUserMarkdown({
    currentMarkdown: userEdited,
    freshComposedMarkdown: nextFresh,
    primaryType: 'playbook',
    constraints: catalog.constraints,
  });

  assert.match(synced, /^\/goal \/poteto-mode/);
  assert.match(synced, /任务目标：给用户管理页增加按角色筛选与 CSV 导出/);
  assert.match(synced, /\/architect、\/interrogate/);
  assert.match(synced, /principle-laziness-protocol/);
  assert.match(synced, /先给出数据结构、接口设计与权衡方案供审阅/);

  // Switching playbooks (e.g. babysit -> eval) preserves extracted blue goal text while updating template
  const babysitEdited = composePrompt(
    { primary: { type: 'playbook', id: 'babysit' }, goal: '跟进 PR #420 的 CI 偶发超时', lang: 'zh' },
    catalog
  ).prompt;
  const preservedGoal = extractUserGoalFromMarkdown(babysitEdited);
  assert.equal(preservedGoal, '跟进 PR #420 的 CI 偶发超时');
  const evalPrompt = composePrompt(
    { primary: { type: 'playbook', id: 'eval' }, goal: preservedGoal, lang: 'zh' },
    catalog
  ).prompt;
  assert.match(evalPrompt, /Eval/);
  assert.match(evalPrompt, /任务目标：跟进 PR #420 的 CI 偶发超时/);
  assert.match(markdownToWysiwygHtml(evalPrompt), /<span class="md-goal-slot">跟进 PR #420 的 CI 偶发超时<\/span>/);
  assert.equal(extractUserGoalFromMarkdown(initial), '');
});

test('clicking a playbook flowchart node focuses the prompt on that step or decision branch without losing user text', () => {
  const catalog = buildCatalog(DEFAULT_PLUGIN_ROOT);
  const bugFix = catalog.playbooks.find((p) => p.id === 'bug-fix');

  // 1. Decision node (`cross`: 3. 修复是否跨函数/模块边界？)
  const decisionOut = composePrompt(
    {
      primary: { type: 'playbook', id: 'bug-fix' },
      activeNodeId: 'cross',
      goal: '登录态刷新偶发 401',
      lang: 'zh',
    },
    catalog
  );
  assert.match(decisionOut.prompt, /当前阶段定位：已推进至 \*\*Bug fix\*\* Playbook 的判断节点「3\. 修复是否跨函数\/模块边界？」/);
  assert.match(decisionOut.prompt, /跨边界 → 接口与边界定型 \(\/architect\)/);
  assert.match(decisionOut.prompt, /局部内 → 直接进入局部修复/);

  // 2. Step node (`fix`: 4. 委派最小修复并原表面复测)
  const stepOut = composePrompt(
    {
      primary: { type: 'playbook', id: 'bug-fix' },
      activeNodeId: 'fix',
      goal: '登录态刷新偶发 401',
      lang: 'zh',
    },
    catalog
  );
  assert.match(stepOut.prompt, /当前阶段定位：已推进至 \*\*Bug fix\*\* Playbook 的节点「4\. 委派最小修复并原表面复测」/);

  // 3. Switching activeNodeId via WYSIWYG sync replaces only the focus line and keeps custom goal text
  const switched = syncComposedIntoUserMarkdown({
    currentMarkdown: decisionOut.prompt,
    freshComposedMarkdown: stepOut.prompt,
    primaryType: 'playbook',
    constraints: catalog.constraints,
  });
  assert.match(switched, /节点「4\. 委派最小修复并原表面复测」/);
  assert.doesNotMatch(switched, /判断节点「3\./);
  assert.match(switched, /任务目标：登录态刷新偶发 401/);

  // 4. SVG highlights focused node cleanly
  const svg = renderFlowchartSvg(bugFix.graph, { activeNodeId: 'cross' });
  assert.match(svg, /fc-node-decision fc-node-active[^>]+data-node-id="cross"/);
});

test('user-space settings, external skill folder mounting, custom playbook/principle overlay, and usage tracking APIs', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pstack-studio-user-'));
  const userDir = join(tempRoot, 'user-studio');
  const geminiConfigDir = join(tempRoot, 'gemini-config');
  const workspaceDir = join(tempRoot, 'demo-workspace');
  const externalMultiDir = join(tempRoot, 'team-skills');
  const externalSingleDir = join(tempRoot, 'solo-skill');

  // Create external skills (one with explicit author, one without -> Other)
  mkdirSync(join(externalMultiDir, 'db-migrate'), { recursive: true });
  writeFileSync(
    join(externalMultiDir, 'db-migrate', 'SKILL.md'),
    '---\nname: db-migrate\nauthor: bob\ntitleZh: 数据库迁移生成\ndescription: Generate safe SQL migrations\n---\n\n# db-migrate\n'
  );
  mkdirSync(externalSingleDir, { recursive: true });
  writeFileSync(
    join(externalSingleDir, 'SKILL.md'),
    '---\nname: solo-skill\ntitleZh: 单目录独立技能\ndescription: Single folder skill\n---\n\n# solo-skill\n'
  );
  // Create Antigravity default-loaded global & workspace skills
  mkdirSync(join(geminiConfigDir, 'skills', 'global-helper'), { recursive: true });
  writeFileSync(
    join(geminiConfigDir, 'skills', 'global-helper', 'SKILL.md'),
    '---\nname: global-helper\ntitleZh: 全局默认技能\ndescription: Auto-discovered global skill\n---\n\n# global-helper\n'
  );
  mkdirSync(join(workspaceDir, '.agents', 'skills', 'verify-demo'), { recursive: true });
  writeFileSync(
    join(workspaceDir, '.agents', 'skills', 'verify-demo', 'SKILL.md'),
    '---\nname: verify-demo\nauthor: alice\ntitleZh: 项目实测验证\ndescription: Auto-discovered workspace verify skill\n---\n\n# verify-demo\n'
  );
  mkdirSync(join(userDir, 'playbooks'), { recursive: true });
  writeFileSync(
    join(userDir, 'playbooks', 'release-gate.md'),
    [
      '---',
      'titleZh: 发布前检查',
      'titleEn: Release Gate',
      'author: alice',
      'authorName: Alice Chen',
      'pack: Team Backend',
      'scenario: verify',
      'whenToUse: 合并高风险变更前执行门禁检查',
      'deliverable: 影响面清单与实测结论',
      '---',
      '',
      '# Release Gate',
      '',
      '1. 变更影响分析：执行 /blast-radius 检查上下游。',
      '2. 数据库变更：运行 /db-migrate 生成安全迁移脚本。',
      '3. 对抗审查：执行 /interrogate 挑战关键风险。',
      '',
      '**Reply:** 汇总门禁结果。',
    ].join('\n')
  );

  const srv = createStandaloneStudioServer({
    port: 0,
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    workspacePath: workspaceDir,
    userDir,
    geminiConfigDir,
  });
  const info = await srv.start();
  try {
    // 1. Update UI preferences (theme, fontFamily, fontSize)
    const uiRes = await fetch(`${info.url}/api/settings/ui`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeMode: 'dark', fontFamily: 'mono', fontSize: 16 }),
    });
    assert.equal(uiRes.status, 200);
    const uiJson = await uiRes.json();
    assert.equal(uiJson.settings.ui.themeMode, 'dark');
    assert.equal(uiJson.settings.ui.fontFamily, 'mono');
    assert.equal(uiJson.settings.ui.fontSize, 16);

    // 2. Mount both external skill folders
    for (const dir of [externalMultiDir, externalSingleDir]) {
      const addRes = await fetch(`${info.url}/api/settings/skill-dirs/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      });
      assert.equal(addRes.status, 200);
      const addJson = await addRes.json();
      assert.equal(addJson.discoveredCount, 1);
    }

    // 3. Create custom principle via API
    const prinRes = await fetch(`${info.url}/api/settings/create-principle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titleZh: '接口向后兼容优先',
        slug: 'api-compat',
        group: 'architecture',
        summary: '对外接口仅做增量扩展，破坏性变更需过渡期',
      }),
    });
    assert.equal(prinRes.status, 200);
    const prinJson = await prinRes.json();
    assert.equal(prinJson.created.id, 'principle-api-compat');

    // 4. Verify merged catalog includes custom playbook, external skills, auto-discovered default skills, and author tags
    const catRes = await fetch(`${info.url}/api/catalog`);
    const cat = await catRes.json();
    assert.equal(cat.counts.playbooks, 25);
    assert.equal(cat.counts.skills, 39);
    assert.equal(cat.counts.principles, 25);

    const builtinSk = cat.skills.find((s) => s.id === 'interrogate');
    assert.equal(builtinSk.author, 'poteto');
    assert.equal(builtinSk.inAnyPlaybook, true);
    const authoredExt = cat.skills.find((s) => s.id === 'db-migrate');
    assert.equal(authoredExt.author, 'bob');
    assert.equal(authoredExt.authorLabel, '@bob');
    // Referenced by custom playbook `release-gate.md`, so excluded from standalone addon skills
    assert.equal(authoredExt.inAnyPlaybook, true);
    assert.ok(authoredExt.usedInPlaybooks.includes('release-gate'));
    const blastSk = cat.skills.find((s) => s.id === 'blast-radius');
    assert.equal(blastSk.inAnyPlaybook, true);
    assert.ok(blastSk.usedInPlaybooks.includes('release-gate'));
    const unauthoredExt = cat.skills.find((s) => s.id === 'solo-skill');
    assert.equal(unauthoredExt.author, 'other');
    assert.equal(unauthoredExt.authorLabel, 'Other');
    assert.equal(unauthoredExt.inAnyPlaybook, false);
    const autoGlobalSk = cat.skills.find((s) => s.id === 'global-helper');
    assert.ok(autoGlobalSk && autoGlobalSk.origin === 'global' && autoGlobalSk.author === 'other');
    const autoWsSk = cat.skills.find((s) => s.id === 'verify-demo');
    assert.ok(autoWsSk && autoWsSk.origin === 'workspace' && autoWsSk.author === 'alice');

    const autoSrcRes = await fetch(`${info.url}/api/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: autoWsSk.relPath }),
    });
    assert.equal(autoSrcRes.status, 200);
    assert.match((await autoSrcRes.json()).content, /Auto-discovered workspace verify skill/);

    const customPb = cat.playbooks.find((p) => p.id === 'release-gate');
    assert.ok(customPb && customPb.origin === 'custom');
    assert.equal(customPb.attribution.author, 'alice');
    assert.equal(customPb.attribution.pack, 'Team Backend');
    assert.equal(customPb.attribution.theme, 'custom');
    const builtinPb = cat.playbooks.find((p) => p.id === 'bug-fix');
    assert.equal(builtinPb.attribution.author, 'poteto');
    assert.equal(builtinPb.attribution.pack, 'Cursor pstack');
    assert.equal(builtinPb.attribution.theme, 'poteto');
    assert.ok(customPb.graph && customPb.graph.rows.length === 3);
    assert.match(renderFlowchartSvg(customPb.graph), /^<svg/);

    // Prompt composer cites exact file paths for custom playbook & external skills
    const composed = composePrompt(
      {
        primary: { type: 'playbook', id: 'release-gate' },
        addonSkills: ['db-migrate'],
        principles: ['principle-api-compat'],
        goal: '准备发布订单服务 v2',
        lang: 'zh',
      },
      cat
    );
    assert.match(composed.prompt, /release-gate\.md/);
    assert.match(composed.prompt, /\/db-migrate \(`[^`]+db-migrate\/SKILL\.md`\)/);
    assert.match(composed.prompt, /principle-api-compat/);

    // Safe source reading works for user & external items
    const extSk = cat.skills.find((s) => s.id === 'db-migrate');
    const extSrcRes = await fetch(`${info.url}/api/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: extSk.relPath }),
    });
    assert.equal(extSrcRes.status, 200);
    const extSrcJson = await extSrcRes.json();
    assert.match(extSrcJson.content, /Generate safe SQL migrations/);

    // Built-in items cannot be deleted
    const delBuiltin = await fetch(`${info.url}/api/settings/delete-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'playbook', id: 'bug-fix' }),
    });
    assert.equal(delBuiltin.status, 500);

    // 5. Usage recording and resetting persists across requests
    const rec1 = await fetch(`${info.url}/api/usage/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: 'clean-and-open-pr',
        playbookId: 'opening-a-pr',
        skillIds: ['interrogate', 'unslop'],
        principleIds: ['principle-prove-it-works'],
      }),
    });
    assert.equal(rec1.status, 200);
    const rec2 = await fetch(`${info.url}/api/usage/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: 'clean-and-open-pr',
        playbookId: 'opening-a-pr',
        skillIds: ['interrogate'],
      }),
    });
    const rec2Json = await rec2.json();
    assert.equal(rec2Json.usage.playbooks['opening-a-pr'], 2);
    assert.equal(rec2Json.usage.skills.interrogate, 2);
    assert.equal(rec2Json.usage.skills.unslop, 1);

    const resetRes = await fetch(`${info.url}/api/usage/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const resetJson = await resetRes.json();
    assert.deepEqual(resetJson.usage.playbooks, {});
    assert.deepEqual(resetJson.usage.skills, {});
  } finally {
    await srv.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
