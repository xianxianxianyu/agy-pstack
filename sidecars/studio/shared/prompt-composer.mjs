/**
 * @fileoverview Isomorphic prompt composer for pstack Studio.
 *
 * Shared between Node unit tests (`test/studio.test.mjs`) and the browser
 * frontend (`frontend/app.js`). Follows pstack's `references/prompting.md`:
 * - States the goal and pass/fail done check cleanly
 * - Locks `/poteto-mode` onto an explicit named Playbook when chosen (eliminating
 *   blind routing guesswork) or invokes a standalone workflow `/skill` directly
 * - Appends only explicit skill overrides, pinned principles, and hard constraints
 * - Flags client-intercepted native slash commands (`/goal`, `/plan`, `/grill-me`)
 */

function buildNodeFocusLine(pb, activeNodeId, lang) {
  if (!pb?.graph || !activeNodeId) return '';
  const allNodes = [];
  for (const row of pb.graph.rows || []) {
    for (const n of row) allNodes.push(n);
  }
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const node = nodeMap.get(activeNodeId);
  if (!node) return '';

  const pbName = pb.titleEn || pb.id;
  if (node.type === 'decision') {
    const outEdges = (pb.graph.edges || []).filter((e) => e.from === node.id);
    const branchDesc = outEdges
      .map((e) => {
        const dst = nodeMap.get(e.to);
        if (!dst) return '';
        const dstMounts =
          Array.isArray(dst.mounts) && dst.mounts.length > 0 ? ` (${dst.mounts.join('、')})` : '';
        return e.label ? `${e.label} → ${dst.label}${dstMounts}` : `${dst.label}${dstMounts}`;
      })
      .filter(Boolean);

    if (lang === 'en') {
      const branchesPart = branchDesc.length > 0 ? ` Branches: ${branchDesc.join('; ')}.` : '';
      return `Current stage focus: We are at decision node "${node.label}" of the **${pbName}** playbook.${branchesPart} Evaluate this condition against the current code first, state your conclusion, and proceed along the matching branch.`;
    }
    const branchesPart = branchDesc.length > 0 ? `（分支：${branchDesc.join('；')}）` : '';
    return `当前阶段定位：已推进至 **${pbName}** Playbook 的判断节点「${node.label}」，请结合当前代码评估该条件${branchesPart}，给出明确判断结论后再按命中分支继续推进。`;
  }

  const mountNote =
    Array.isArray(node.mounts) && node.mounts.length > 0
      ? lang === 'en'
        ? ` (using ${node.mounts.join(', ')})`
        : `（联动 ${node.mounts.join('、')}）`
      : '';
  if (lang === 'en') {
    return `Current stage focus: We are at step "${node.label}"${mountNote} of the **${pbName}** playbook. Start directly from this step without redoing completed earlier steps.`;
  }
  return `当前阶段定位：已推进至 **${pbName}** Playbook 的节点「${node.label}」${mountNote}，请直接从该节点切入执行，无需重跑已完成的前置步骤。`;
}

/**
 * @param {object} state
 * @param {{type: 'playbook'|'skill', id: string}|null} state.primary
 * @param {string|null} [state.activeNodeId]
 * @param {string[]} [state.addonSkills]
 * @param {string[]} [state.principles]
 * @param {string[]} [state.constraints]
 * @param {string[]} [state.nativeModifiers]
 * @param {string} [state.goal]
 * @param {string} [state.doneCheck]
 * @param {'zh'|'en'} [state.lang]
 * @param {object} catalog
 */
export function composePrompt(state, catalog) {
  const lang = state?.lang === 'en' ? 'en' : 'zh';
  const primary = state?.primary || { type: 'playbook', id: 'bug-fix' };
  const activeNodeId = state?.activeNodeId || '';
  const addonIds = Array.isArray(state?.addonSkills) ? state.addonSkills : [];
  const principleIds = Array.isArray(state?.principles) ? state.principles : [];
  const constraintIds = Array.isArray(state?.constraints) ? state.constraints : [];
  const nativeIds = Array.isArray(state?.nativeModifiers) ? state.nativeModifiers : [];
  const goalText = String(state?.goal || '').trim();
  const doneCheckText = String(state?.doneCheck || '').trim();

  const playbookMap = new Map((catalog?.playbooks || []).map((p) => [p.id, p]));
  const skillMap = new Map((catalog?.skills || []).map((s) => [s.id, s]));
  const principleMap = new Map((catalog?.principles || []).map((p) => [p.id, p]));
  const constraintMap = new Map((catalog?.constraints || []).map((c) => [c.id, c]));
  const nativeMap = new Map((catalog?.nativeModifiers || []).map((n) => [n.id, n]));

  // Detect host-only leading slash commands (/goal, /plan, /grill-me)
  const selectedNatives = nativeIds.map((id) => nativeMap.get(id)).filter(Boolean);
  const hostOnlyNatives = selectedNatives.filter((n) => n.hostInterceptOnly);
  const agentReadableNatives = selectedNatives.filter((n) => !n.hostInterceptOnly);

  const leadingHostSlashes = hostOnlyNatives.map((n) => n.slash).join(' ');
  const hasNewTaskPrefix = constraintIds.includes('new-task');
  const otherConstraints = constraintIds
    .filter((id) => id !== 'new-task')
    .map((id) => constraintMap.get(id))
    .filter(Boolean);

  // Deduplicate addon skills against primary if primary is a skill
  const cleanAddons = addonIds.filter((id) => !(primary.type === 'skill' && primary.id === id));

  let headerLine = '';
  let titleSuggestion = 'pstack 任务';

  if (primary.type === 'playbook') {
    const pb = playbookMap.get(primary.id);
    const pbNameEn = pb ? pb.titleEn : primary.id;
    const pbTitleZh = pb ? pb.titleZh : primary.id;
    const pbPathRef =
      pb?.origin === 'custom' && pb?.sourceFilePath
        ? pb.sourceFilePath
        : `skills/poteto-mode/playbooks/${primary.id}.md`;
    titleSuggestion = `[pstack] ${pbTitleZh}`;

    const prefixParts = [];
    if (leadingHostSlashes) prefixParts.push(leadingHostSlashes);
    prefixParts.push('/poteto-mode');

    if (lang === 'en') {
      const newTaskStr = hasNewTaskPrefix ? 'New task — ' : '';
      headerLine = `${prefixParts.join(' ')} ${newTaskStr}Run the **${pbNameEn}** playbook (\`${pbPathRef}\`).`;
    } else {
      const newTaskStr = hasNewTaskPrefix ? '【新任务】' : '';
      headerLine = `${prefixParts.join(' ')} ${newTaskStr}请严格按 **${pbNameEn}（${pbTitleZh}）** Playbook（\`${pbPathRef}\`）执行。`;
    }
  } else {
    const sk = skillMap.get(primary.id);
    const slash = sk ? sk.slash : `/${primary.id}`;
    const skTitleZh = sk ? sk.titleZh : primary.id;
    const customSkillHint =
      sk && sk.origin && sk.origin !== 'builtin' && sk.sourceFilePath
        ? lang === 'en'
          ? ` (read skill definition from \`${sk.sourceFilePath}\`)`
          : `（技能定义见 \`${sk.sourceFilePath}\`）`
        : '';
    titleSuggestion = `[pstack] ${slash} ${skTitleZh}`;

    const prefixParts = [];
    if (leadingHostSlashes) prefixParts.push(leadingHostSlashes);
    prefixParts.push(slash);

    if (lang === 'en') {
      const newTaskStr = hasNewTaskPrefix ? 'New task: ' : '';
      headerLine = `${prefixParts.join(' ')}${customSkillHint} ${newTaskStr}`.trim();
    } else {
      const newTaskStr = hasNewTaskPrefix ? '【新任务】' : '';
      headerLine = `${prefixParts.join(' ')}${customSkillHint} ${newTaskStr}`.trim();
    }
  }

  const lines = [];

  // Combine header + goal smoothly
  const effectiveGoal =
    goalText ||
    (lang === 'en'
      ? '<Describe your concrete goal, symptom, or target files here>'
      : '<在此填写具体目标、问题现象或涉及模块>');

  if (primary.type === 'skill' && !goalText && skHasCleanExample(primary.id, skillMap) && cleanAddons.length === 0 && principleIds.length === 0 && otherConstraints.length === 0 && selectedNatives.length === 0 && !hasNewTaskPrefix) {
    lines.push(skillMap.get(primary.id).examplePrompt);
  } else if (primary.type === 'skill') {
    lines.push(`${headerLine} ${effectiveGoal}`.trim());
  } else {
    const pb = playbookMap.get(primary.id);
    const focusLine = buildNodeFocusLine(pb, activeNodeId, lang);
    lines.push(headerLine);
    if (focusLine) {
      lines.push('');
      lines.push(focusLine);
    }
    lines.push('');
    lines.push(lang === 'en' ? `Goal: ${effectiveGoal}` : `任务目标：${effectiveGoal}`);
  }

  if (doneCheckText) {
    lines.push(
      lang === 'en'
        ? `Done check: ${doneCheckText}`
        : `验收标准（Done Check）：${doneCheckText}`
    );
  }

  const directives = [];

  if (cleanAddons.length > 0 || agentReadableNatives.length > 0) {
    const tags = [
      ...cleanAddons.map((id) => {
        const sk = skillMap.get(id);
        if (sk && sk.origin && sk.origin !== 'builtin' && sk.sourceFilePath) {
          return `/${id} (\`${sk.sourceFilePath}\`)`;
        }
        return `/${id}`;
      }),
      ...agentReadableNatives.map((n) => n.slash),
    ];
    directives.push(
      lang === 'en'
        ? `- Explicitly incorporate skills/tools: ${tags.join(', ')}.`
        : `- 显式联动技能/工具：${tags.join('、')}。`
    );
  }

  if (principleIds.length > 0) {
    const pNames = principleIds.map((id) => {
      const p = principleMap.get(id);
      if (!p) return id;
      const base = `${id} (${lang === 'en' ? p.shortSlug : p.titleZh.split('（')[0]})`;
      if (p.origin === 'custom' && p.sourceFilePath) {
        return `${base} [\`${p.sourceFilePath}\`]`;
      }
      return base;
    });
    directives.push(
      lang === 'en'
        ? `- Apply principles and cite how each shaped your choices: ${pNames.join(', ')}.`
        : `- 重点贯彻以下工程原则（并在总结中指明每条原则改变了哪个具体决策）：${pNames.join('、')}。`
    );
  }

  for (const c of otherConstraints) {
    directives.push(`- ${lang === 'en' ? c.promptEn : c.promptZh}`);
  }

  if (directives.length > 0) {
    lines.push('');
    lines.push(...directives);
  }

  if (goalText) {
    const compactGoal = goalText.replace(/\s+/g, ' ').slice(0, 28);
    titleSuggestion = `${titleSuggestion} · ${compactGoal}`;
  }

  return {
    prompt: lines.join('\n').trim(),
    titleSuggestion: titleSuggestion.slice(0, 60),
    hasPlaceholder: !goalText,
    hostOnlySlashes: hostOnlyNatives.map((n) => n.slash),
  };
}

function skHasCleanExample(skillId, skillMap) {
  const sk = skillMap.get(skillId);
  return Boolean(sk && sk.examplePrompt);
}
