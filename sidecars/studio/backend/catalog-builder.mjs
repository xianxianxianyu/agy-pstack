/**
 * @fileoverview Dynamic catalog builder for pstack Studio.
 *
 * Scans the real plugin directory (`skills/`, `skills/poteto-mode/playbooks/`,
 * `agents/`, `plugin.json`), parses YAML frontmatter, numbered playbook steps,
 * reply contracts, and cross-references, and merges them with the curated
 * bilingual UX metadata from `metadata-zh.mjs`.
 *
 * Any newly added skill or playbook on disk is automatically discovered and
 * rendered with sensible fallbacks even before `metadata-zh.mjs` is updated.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_META,
  CLOSE_CALLS,
  CONSTRAINTS,
  GOLDEN_RECIPES,
  INTENT_MATCHER,
  NATIVE_MODIFIERS,
  PLAYBOOK_META,
  PRINCIPLE_META,
  SCENARIOS,
  SKILL_LINES,
  SKILL_META,
} from './metadata-zh.mjs';
import { PLAYBOOK_GRAPHS } from './playbook-graphs.mjs';
import {
  discoverSkillsInDirectory,
  expandHomePath,
  getUserStudioPaths,
  readUsageStats,
  readUserConfig,
} from './user-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PLUGIN_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * Minimal YAML frontmatter parser for SKILL.md / agent markdown files.
 */
export function parseFrontmatter(markdown) {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized.trim() };
  }
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) {
    return { attributes: {}, body: normalized.trim() };
  }
  const rawYaml = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 5).trim();
  const attributes = {};
  let currentKey = null;
  let multilineBuf = [];

  const flushMultiline = () => {
    if (currentKey && multilineBuf.length > 0) {
      attributes[currentKey] = multilineBuf.join(' ').trim();
    }
    currentKey = null;
    multilineBuf = [];
  };

  for (const line of rawYaml.split('\n')) {
    if (/^\s+/.test(line) && currentKey) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.includes(':')) {
        multilineBuf.push(trimmed);
        continue;
      }
    }
    flushMultiline();
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const [, key, rawVal] = match;
    const val = rawVal.trim();
    if (val === '>-' || val === '>' || val === '|') {
      currentKey = key;
      multilineBuf = [];
    } else {
      attributes[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  flushMultiline();

  return { attributes, body };
}

/**
 * Extracts title, lead paragraph, numbered/bulleted steps, and `**Reply:**`
 * contract from a playbook markdown file, plus cross-referenced skills/principles.
 */
export function parsePlaybookMarkdown(id, markdown, knownWorkflowSkillIds, knownPrincipleIds) {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');

  let heading = id;
  let replyContractEn = '';
  const rawSteps = [];
  let leadLines = [];
  let inSteps = false;

  for (const line of lines) {
    const hMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (hMatch && heading === id) {
      heading = hMatch[1].trim();
      continue;
    }
    const replyMatch = line.match(/^\*\*Reply:\*\*\s*(.+)$/i);
    if (replyMatch) {
      replyContractEn = replyMatch[1].trim();
      continue;
    }
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      inSteps = true;
      rawSteps.push(numMatch[2].trim());
      continue;
    }
    if (!inSteps && rawSteps.length === 0) {
      const bulletMatch = line.match(/^-\s+(.+)$/);
      if (bulletMatch && id === 'babysit') {
        rawSteps.push(bulletMatch[1].trim());
        continue;
      }
      if (line.trim()) {
        leadLines.push(line.trim());
      }
    }
  }

  // Fallback for short prose playbooks like opening-a-pr.md without numbered list
  if (rawSteps.length === 0) {
    for (const para of normalized.split(/\n\s*\n/)) {
      const clean = para.trim();
      if (!clean || /^#{1,3}\s+/.test(clean) || /^\*\*Reply:\*\*/i.test(clean)) continue;
      rawSteps.push(clean.replace(/\n+/g, ' '));
    }
  }

  const detectRefsInText = (text) => {
    const lower = text.toLowerCase();
    const skills = [];
    const principles = [];
    const natives = [];
    const subagents = [];

    for (const skillId of knownWorkflowSkillIds) {
      if (skillId === 'poteto-mode' || skillId === 'poteto-help') continue;
      const escaped = skillId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(\\/${escaped}\\b|\\*\\*${escaped}\\*\\*|\\\`${escaped}\\\`)`, 'i');
      if (re.test(text)) {
        skills.push(skillId);
      }
    }
    if (/Opening a PR|opening-a-pr\.md/i.test(text) && id !== 'opening-a-pr') {
      if (!skills.includes('unslop')) skills.push('unslop');
      if (!skills.includes('no-comments')) skills.push('no-comments');
    }

    for (const prinId of knownPrincipleIds) {
      const shortSlug = prinId.replace(/^principle-/, '');
      const escapedFull = prinId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedShort = shortSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(${escapedFull}|\\*\\*${escapedShort}\\*\\*)`, 'i');
      if (re.test(text)) {
        principles.push(prinId);
      }
    }

    if (/\/swarm\b|swarm\{/i.test(text)) natives.push('/swarm');
    if (/\/goal\b/i.test(text)) natives.push('/goal');
    if (/\/browser\b|`browser`\s+subagent/i.test(text)) natives.push('/browser');
    if (/run_workflow/i.test(text)) natives.push('run_workflow');
    if (/\bschedule\b\s+tool|`schedule`/i.test(text)) natives.push('schedule');

    if (/poteto-agent/i.test(lower)) subagents.push('poteto-agent');
    if (/`research`\s+subagent/i.test(text)) subagents.push('research');
    if (/`browser`\s+subagent/i.test(text)) subagents.push('browser');
    if (/comment-sicko|Comment Sicko/i.test(text)) subagents.push('comment-sicko');

    return { skills, principles, natives, subagents };
  };

  const fullRefs = detectRefsInText(normalized);
  const parsedStepsEn = rawSteps.map((stepText, idx) => ({
    index: idx + 1,
    textEn: stepText,
    refs: detectRefsInText(stepText),
  }));

  return {
    headingEn: heading,
    leadEn: leadLines.slice(0, 2).join(' '),
    replyContractEn,
    parsedStepsEn,
    detectedRefs: fullRefs,
  };
}

function uniqueMerge(...arrays) {
  const out = [];
  const seen = new Set();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out;
}

const PRINCIPLE_GROUP_LABELS = {
  core: '核心原则 Core',
  architecture: '架构原则 Architecture',
  verification: '验证原则 Verification',
  delegation: '协同原则 Delegation',
  meta: '元原则 Meta',
};

export const POTETO_ATTRIBUTION = {
  theme: 'poteto',
  author: 'poteto',
  authorName: 'Lauren Tan',
  pack: 'Cursor pstack',
  roleZh: '原版方法论作者',
  quote: 'If you want to go fast, go deep first.',
  quoteZh: '欲速则先深耕——目标不是写更多代码，而是写更少、更高质量、经得起验证的代码。',
  repoLabel: 'cursor/plugins · pstack',
  repoUrl: 'https://github.com/cursor/plugins/tree/main/pstack',
  portBy: 'ahmetdotsh',
  portLabel: 'agy-pstack (Antigravity 原生适配)',
  portUrl: 'https://github.com/ahmetdotsh/agy-pstack',
};

function buildCustomAttribution(attributes = {}) {
  const author = String(attributes.author || 'custom').trim().replace(/^@/, '');
  const authorName = String(attributes.authorName || author || '本地作者').trim();
  const pack = String(attributes.pack || 'Custom Flow').trim();
  const quote = String(attributes.quote || '').trim();
  const repoUrl = String(attributes.authorUrl || attributes.repoUrl || '').trim();
  return {
    theme: 'custom',
    author,
    authorName,
    pack,
    roleZh: '自定义流程作者',
    quote,
    quoteZh: quote ? '' : '存放在本地独立用户目录，持续跟随上游内置技能演进且零合并冲突。',
    repoLabel: repoUrl || '~/.gemini/config/pstack-studio/playbooks',
    repoUrl,
    portBy: 'poteto',
    portLabel: '基于 Cursor pstack 引擎装配',
    portUrl: 'https://github.com/cursor/plugins/tree/main/pstack',
  };
}

function parseCsvAttr(val) {
  if (!val) return [];
  return String(val)
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeSkillAuthor(attributes = {}) {
  const raw = String(attributes.author || '').trim().replace(/^@/, '');
  if (!raw) {
    return { author: 'other', authorLabel: 'Other' };
  }
  const clean = raw.toLowerCase();
  if (clean === 'poteto') {
    return { author: 'poteto', authorLabel: '@poteto · Cursor pstack' };
  }
  return { author: raw, authorLabel: `@${raw}` };
}

function uriToLocalPath(uri) {
  const s = String(uri || '').trim();
  if (!s) return '';
  if (s.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(s).pathname);
    } catch {
      return s.slice('file://'.length);
    }
  }
  return s;
}

function readSkillsJsonEntryDirs(jsonPath, baseDir) {
  if (!existsSync(jsonPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const dirs = [];
    for (const entry of entries) {
      const p = typeof entry === 'string' ? entry : entry?.path;
      if (!p || !String(p).trim()) continue;
      const trimmed = String(p).trim();
      const resolved =
        trimmed.startsWith('/') || trimmed.startsWith('~')
          ? expandHomePath(trimmed)
          : resolve(baseDir, trimmed);
      if (resolved && existsSync(resolved)) dirs.push(resolved);
    }
    return dirs;
  } catch {
    return [];
  }
}

/**
 * Collects Antigravity's default-loaded skill directories:
 * - Global: `~/.gemini/config/skills/` and `~/.gemini/config/skills.json`
 * - Workspace: `<ws>/.agents/skills/` and `<ws>/.agents/skills.json`
 */
function collectDefaultLoadedSkillDirs({ geminiConfigDir, workspaceUris = [], fallbackWorkspacePath = '' } = {}) {
  const globalCfgDir = geminiConfigDir
    ? resolve(geminiConfigDir)
    : join(homedir(), '.gemini', 'config');
  const results = [];
  const seen = new Set();
  const pushDir = (dirPath, origin, sourceLabel) => {
    const abs = resolve(dirPath);
    if (seen.has(abs) || !existsSync(abs)) return;
    seen.add(abs);
    results.push({ absPath: abs, origin, sourceLabel });
  };

  // 1. Active workspace(s) `.agents/skills` & `.agents/skills.json`
  const wsPaths = workspaceUris.map(uriToLocalPath).filter(Boolean);
  if (wsPaths.length === 0 && fallbackWorkspacePath) {
    wsPaths.push(resolve(fallbackWorkspacePath));
  }
  for (const ws of wsPaths) {
    const wsName = basename(ws) || '工作区';
    for (const dotDir of ['.agents', '.agent']) {
      const dotPath = join(ws, dotDir);
      pushDir(join(dotPath, 'skills'), 'workspace', `项目 · ${wsName}`);
      for (const extraDir of readSkillsJsonEntryDirs(join(dotPath, 'skills.json'), ws)) {
        pushDir(extraDir, 'workspace', `项目配置 · ${wsName}`);
      }
    }
  }

  // 2. Global `~/.gemini/config/skills` & `~/.gemini/config/skills.json`
  pushDir(join(globalCfgDir, 'skills'), 'global', '全局默认技能');
  for (const extraDir of readSkillsJsonEntryDirs(join(globalCfgDir, 'skills.json'), globalCfgDir)) {
    pushDir(extraDir, 'global', '全局配置技能');
  }

  return results;
}

/**
 * Generates a clean clickable linear SVG flowchart topology for custom playbooks
 * that do not provide an explicit `<slug>.graph.json`.
 */
export function buildAutoFlowchartGraph(steps, fallbackTitle = '执行步骤') {
  const list = Array.isArray(steps) && steps.length > 0 ? steps : [{ index: 1, title: fallbackTitle, detail: '', mounts: [] }];
  const rows = [];
  const edges = [];
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    const id = `step_${i + 1}`;
    const rawLabel = st.title || `步骤 ${i + 1}`;
    const label = rawLabel.length > 30 ? rawLabel.slice(0, 28) + '…' : rawLabel;
    const rawSub = st.detail && st.detail !== st.title ? st.detail : '';
    const sub = rawSub.length > 36 ? rawSub.slice(0, 34) + '…' : rawSub;
    const mounts = Array.isArray(st.mounts) ? st.mounts.slice(0, 6) : [];
    rows.push([{ id, type: 'step', label, sub, mounts }]);
    if (i > 0) {
      edges.push({ from: `step_${i}`, to: id });
    }
  }
  return {
    topologyLabel: `自定义流程 · ${list.length} 步`,
    rows,
    edges,
  };
}

/**
 * Builds the complete Studio catalog from `pluginRoot`, dynamically overlaid with
 * user-space Playbooks, external/custom Skills, custom Principles, UI settings,
 * and persisted usage frequency counters (zero modification to upstream files).
 */
export function buildCatalog(pluginRoot = DEFAULT_PLUGIN_ROOT, options = {}) {
  const userDir = options?.userDir;
  const userPaths = getUserStudioPaths(userDir);
  const userConfig = readUserConfig(userDir);
  const usage = readUsageStats(userDir);

  const pluginJsonPath = join(pluginRoot, 'plugin.json');
  const pluginManifest = existsSync(pluginJsonPath)
    ? JSON.parse(readFileSync(pluginJsonPath, 'utf-8'))
    : { name: 'pstack', version: '1.2.0' };

  const skillsDir = join(pluginRoot, 'skills');
  const playbooksDir = join(skillsDir, 'poteto-mode', 'playbooks');
  const agentsDir = join(pluginRoot, 'agents');

  // 1. Discover all built-in skill directories on disk
  const skillEntries = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((name) => {
        const full = join(skillsDir, name);
        return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
      }).sort()
    : [];

  const builtinWorkflowSkillIds = skillEntries.filter((n) => !n.startsWith('principle-'));
  const builtinPrincipleSkillIds = skillEntries.filter((n) => n.startsWith('principle-'));

  // 2. Build Built-in Workflow Skills list
  const builtinSkillsList = builtinWorkflowSkillIds.map((id) => {
    const relPath = `skills/${id}/SKILL.md`;
    const absPath = join(pluginRoot, relPath);
    const raw = readFileSync(absPath, 'utf-8');
    const { attributes, body } = parseFrontmatter(raw);
    const meta = SKILL_META[id] || {};
    return {
      id,
      slash: `/${id}`,
      name: attributes.name || id,
      titleZh: meta.titleZh || id,
      titleEn: meta.titleEn || id,
      shortDesc: meta.shortDesc || meta.whenToUse || attributes.description || '',
      scenario: meta.scenario || 'build',
      line: meta.line || 'engineering',
      roleTag: meta.roleTag || '工作流技能',
      descriptionEn: attributes.description || '',
      whenToUse: meta.whenToUse || attributes.description || '',
      vsHint: meta.vsHint || null,
      recommendedPairs: Array.isArray(meta.recommendedPairs) ? meta.recommendedPairs : [],
      examplePrompt: meta.examplePrompt || `/${id} `,
      relPath,
      sourceFilePath: absPath,
      origin: 'builtin',
      author: 'poteto',
      authorLabel: '@poteto · Cursor pstack',
      attribution: POTETO_ATTRIBUTION,
      lineCount: raw.split('\n').length,
      previewExcerpt: body.split('\n').slice(0, 12).join('\n'),
    };
  });

  // 2b. Discover User Custom Skills (`~/.gemini/config/pstack-studio/skills/`),
  // External Mounted Skill Dirs, and Antigravity Default-Loaded Global/Workspace Skills
  const seenSkillIds = new Set(builtinWorkflowSkillIds);
  const customSkillsList = [];

  const appendDiscoveredSkill = (entry, { origin, sourceLabel, relPath }) => {
    if (!entry || entry.id.startsWith('principle-')) return { added: false, conflict: false };
    if (seenSkillIds.has(entry.id)) {
      return { added: false, conflict: true };
    }
    seenSkillIds.add(entry.id);
    const raw = readFileSync(entry.filePath, 'utf-8');
    const { attributes, body } = parseFrontmatter(raw);
    const id = entry.id;
    const titleZh = attributes.titleZh || attributes.title || attributes.name || id;
    const titleEn = attributes.titleEn || attributes.name || id;
    const desc = attributes.shortDesc || attributes.description || `来自 ${sourceLabel} 的扩展技能`;
    const { author, authorLabel } = normalizeSkillAuthor(attributes);
    const roleTagMap = {
      external: `外部 · ${sourceLabel}`,
      workspace: sourceLabel,
      global: sourceLabel,
      custom: '自定义技能',
    };
    customSkillsList.push({
      id,
      slash: `/${id}`,
      name: attributes.name || id,
      titleZh,
      titleEn,
      shortDesc: desc.slice(0, 90),
      scenario: attributes.scenario || 'build',
      line: attributes.line || '',
      roleTag: roleTagMap[origin] || '扩展技能',
      descriptionEn: attributes.description || '',
      whenToUse: attributes.whenToUse || attributes.description || desc,
      vsHint: null,
      recommendedPairs: [],
      examplePrompt: `/${id} `,
      relPath,
      sourceFilePath: entry.filePath,
      sourceLabel,
      origin,
      author,
      authorLabel,
      attribution: author === 'poteto' ? POTETO_ATTRIBUTION : buildCustomAttribution({ ...attributes, author: author === 'other' ? sourceLabel : author }),
      lineCount: raw.split('\n').length,
      previewExcerpt: body.split('\n').slice(0, 12).join('\n'),
    });
    return { added: true, conflict: false };
  };

  if (existsSync(userPaths.skillsDir)) {
    const scan = discoverSkillsInDirectory(userPaths.skillsDir);
    for (const entry of scan.skills) {
      appendDiscoveredSkill(entry, {
        origin: 'custom',
        sourceLabel: '自定义技能目录',
        relPath: `user:skills/${entry.id}/SKILL.md`,
      });
    }
  }

  const enrichedSkillDirs = userConfig.skillDirs.map((dirEntry, idx) => {
    const scan = discoverSkillsInDirectory(dirEntry.resolvedPath);
    const loadedIds = [];
    const skippedConflicts = [];
    for (const entry of scan.skills) {
      const res = appendDiscoveredSkill(entry, {
        origin: 'external',
        sourceLabel: dirEntry.label || basename(dirEntry.resolvedPath),
        relPath: `ext:${idx}:${entry.id}`,
      });
      if (res.added) loadedIds.push(entry.id);
      else if (res.conflict) skippedConflicts.push(entry.id);
    }
    return {
      ...dirEntry,
      exists: scan.exists && scan.isDir,
      discoveredCount: scan.skills.length,
      loadedIds,
      skippedConflicts,
    };
  });

  // 2c. Auto-discover Antigravity default-loaded Global & Workspace skills
  const defaultLoadedDirs = collectDefaultLoadedSkillDirs({
    geminiConfigDir: options?.geminiConfigDir,
    workspaceUris: Array.isArray(options?.workspaceUris) ? options.workspaceUris : [],
    fallbackWorkspacePath: options?.fallbackWorkspacePath || '',
  });
  const defaultSkillSources = [];
  defaultLoadedDirs.forEach((d, dIdx) => {
    const scan = discoverSkillsInDirectory(d.absPath);
    const loadedIds = [];
    for (const entry of scan.skills) {
      const res = appendDiscoveredSkill(entry, {
        origin: d.origin,
        sourceLabel: d.sourceLabel,
        relPath: `auto:${dIdx}:${entry.id}`,
      });
      if (res.added) loadedIds.push(entry.id);
    }
    if (loadedIds.length > 0) {
      defaultSkillSources.push({
        path: d.absPath,
        origin: d.origin,
        label: d.sourceLabel,
        loadedIds,
      });
    }
  });

  const skills = [...builtinSkillsList, ...customSkillsList];
  const allWorkflowSkillIds = skills.map((s) => s.id);

  // 3. Build Built-in + Custom Principles list
  const groupOrder = ['core', 'architecture', 'verification', 'delegation', 'meta'];
  const seenPrincipleIds = new Set(builtinPrincipleSkillIds);

  const builtinPrinciplesList = builtinPrincipleSkillIds.map((id) => {
    const shortSlug = id.replace(/^principle-/, '');
    const relPath = `skills/${id}/SKILL.md`;
    const absPath = join(pluginRoot, relPath);
    const raw = readFileSync(absPath, 'utf-8');
    const { attributes } = parseFrontmatter(raw);
    const meta = PRINCIPLE_META[id] || {};
    return {
      id,
      shortSlug,
      slash: `/${id}`,
      titleZh: meta.titleZh || shortSlug,
      titleEn: meta.titleEn || shortSlug,
      group: meta.group || 'core',
      groupLabel: meta.groupLabel || PRINCIPLE_GROUP_LABELS[meta.group] || '核心原则 Core',
      summary: meta.summary || attributes.description || '',
      descriptionEn: attributes.description || '',
      relPath,
      sourceFilePath: absPath,
      origin: 'builtin',
      attribution: POTETO_ATTRIBUTION,
    };
  });

  const customPrinciplesList = [];
  if (existsSync(userPaths.principlesDir)) {
    const entries = readdirSync(userPaths.principlesDir).sort();
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const full = join(userPaths.principlesDir, name);
      let filePath = '';
      let rawSlug = '';
      let relPath = '';
      try {
        const st = statSync(full);
        if (st.isFile() && name.endsWith('.md')) {
          filePath = full;
          rawSlug = basename(name, '.md');
          relPath = `user:principles/${name}`;
        } else if (st.isDirectory() && existsSync(join(full, 'SKILL.md'))) {
          filePath = join(full, 'SKILL.md');
          rawSlug = name;
          relPath = `user:principles/${name}/SKILL.md`;
        }
      } catch {
        continue;
      }
      if (!filePath || !rawSlug) continue;
      const shortSlug = rawSlug.replace(/^principle-/, '');
      const id = `principle-${shortSlug}`;
      if (seenPrincipleIds.has(id)) continue;
      seenPrincipleIds.add(id);

      const raw = readFileSync(filePath, 'utf-8');
      const { attributes, body } = parseFrontmatter(raw);
      const grp = groupOrder.includes(attributes.group) ? attributes.group : 'core';
      const firstBodyLine =
        body
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith('#')) || '';
      customPrinciplesList.push({
        id,
        shortSlug,
        slash: `/${id}`,
        titleZh: attributes.titleZh || attributes.title || shortSlug,
        titleEn: attributes.titleEn || shortSlug,
        group: grp,
        groupLabel: PRINCIPLE_GROUP_LABELS[grp] || '核心原则 Core',
        summary: attributes.summary || attributes.description || firstBodyLine || shortSlug,
        descriptionEn: attributes.description || '',
        relPath,
        sourceFilePath: filePath,
        origin: 'custom',
      });
    }
  }

  const principles = [...builtinPrinciplesList, ...customPrinciplesList].sort((a, b) => {
    const ga = groupOrder.indexOf(a.group);
    const gb = groupOrder.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    if (a.origin !== b.origin) return a.origin === 'custom' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  const allPrincipleIds = principles.map((p) => p.id);

  // 4. Discover and parse Built-in + Custom Playbooks
  const playbookFiles = existsSync(playbooksDir)
    ? readdirSync(playbooksDir).filter((f) => f.endsWith('.md')).sort()
    : [];

  const playbookOrder = Object.keys(PLAYBOOK_META);
  const builtinPlaybooks = playbookFiles.map((filename) => {
    const id = basename(filename, '.md');
    const relPath = `skills/poteto-mode/playbooks/${filename}`;
    const absPath = join(pluginRoot, relPath);
    const raw = readFileSync(absPath, 'utf-8');
    const parsed = parsePlaybookMarkdown(id, raw, allWorkflowSkillIds, allPrincipleIds);
    const meta = PLAYBOOK_META[id] || {};

    const steps =
      Array.isArray(meta.stepsZh) && meta.stepsZh.length > 0
        ? meta.stepsZh.map((s, idx) => {
            const matchedEn = parsed.parsedStepsEn[idx];
            return {
              index: idx + 1,
              title: s.title,
              detail: s.detail,
              mounts: Array.isArray(s.mounts) ? s.mounts : [],
              refs: matchedEn ? matchedEn.refs : { skills: [], principles: [], natives: [], subagents: [] },
            };
          })
        : parsed.parsedStepsEn.map((s) => ({
            index: s.index,
            title: `Step ${s.index}`,
            detail: s.textEn.slice(0, 140),
            mounts: [...s.refs.skills.map((x) => `/${x}`), ...s.refs.natives],
            refs: s.refs,
          }));

    const builtinSkills = uniqueMerge(meta.builtinSkills, parsed.detectedRefs.skills);
    const builtinPrinciples = uniqueMerge(meta.builtinPrinciples, parsed.detectedRefs.principles);
    const subagents = uniqueMerge(meta.subagents, parsed.detectedRefs.subagents);
    const nativeTools = uniqueMerge(meta.nativeTools, parsed.detectedRefs.natives);
    const chainsOpeningPr = id !== 'opening-a-pr' && /Opening a PR|opening-a-pr\.md/i.test(raw);

    return {
      id,
      titleZh: meta.titleZh || parsed.headingEn,
      titleEn: meta.titleEn || parsed.headingEn,
      shortDesc: meta.shortDesc || meta.whenToUse || parsed.leadEn,
      scenario: meta.scenario || 'build',
      intensity: meta.intensity || 'standard',
      intensityLabel: meta.intensityLabel || '标准流程',
      whenToUse: meta.whenToUse || parsed.leadEn,
      vsHint: meta.vsHint || null,
      deliverable: meta.deliverable || parsed.replyContractEn,
      replyContractEn: parsed.replyContractEn,
      graph: PLAYBOOK_GRAPHS[id] || null,
      steps,
      rawStepCount: parsed.parsedStepsEn.length,
      builtinSkills,
      builtinPrinciples,
      subagents,
      nativeTools,
      chainsOpeningPr,
      relPath,
      sourceFilePath: absPath,
      origin: 'builtin',
      attribution: POTETO_ATTRIBUTION,
    };
  });

  const seenPlaybookIds = new Set(builtinPlaybooks.map((p) => p.id));
  const customPlaybooks = [];
  if (existsSync(userPaths.playbooksDir)) {
    const userPbFiles = readdirSync(userPaths.playbooksDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .sort();
    for (const filename of userPbFiles) {
      const id = basename(filename, '.md');
      if (seenPlaybookIds.has(id)) continue;
      seenPlaybookIds.add(id);

      const absPath = join(userPaths.playbooksDir, filename);
      const raw = readFileSync(absPath, 'utf-8');
      const { attributes, body } = parseFrontmatter(raw);
      const parsed = parsePlaybookMarkdown(id, body || raw, allWorkflowSkillIds, allPrincipleIds);

      const steps = parsed.parsedStepsEn.map((s) => {
        const cleanText = s.textEn.replace(/\*\*/g, '');
        const splitColon = cleanText.match(/^([^：:]{2,26})[：:]\s*(.+)$/);
        return {
          index: s.index,
          title: splitColon ? splitColon[1].trim() : `${s.index}. ${cleanText.slice(0, 26)}`,
          detail: splitColon ? splitColon[2].trim() : cleanText,
          mounts: [
            ...s.refs.skills.map((x) => `/${x}`),
            ...s.refs.natives,
            ...s.refs.principles.map((p) => p.replace(/^principle-/, '')),
          ],
          refs: s.refs,
        };
      });

      let customGraph = null;
      const graphJsonPath = join(userPaths.playbooksDir, `${id}.graph.json`);
      if (existsSync(graphJsonPath)) {
        try {
          const parsedGraph = JSON.parse(readFileSync(graphJsonPath, 'utf-8'));
          if (parsedGraph && Array.isArray(parsedGraph.rows) && Array.isArray(parsedGraph.edges)) {
            customGraph = parsedGraph;
          }
        } catch {
          // Fall back to auto-generated flowchart
        }
      }
      if (!customGraph) {
        customGraph = buildAutoFlowchartGraph(steps, attributes.titleZh || parsed.headingEn || id);
      }

      const titleZh = attributes.titleZh || attributes.title || parsed.headingEn || id;
      const titleEn = attributes.titleEn || id;
      const validScenarios = SCENARIOS.map((s) => s.id);
      const scenario = validScenarios.includes(attributes.scenario) ? attributes.scenario : 'build';

      customPlaybooks.push({
        id,
        titleZh,
        titleEn,
        shortDesc: attributes.shortDesc || attributes.whenToUse || parsed.leadEn || '用户自定义编排流程',
        scenario,
        intensity: attributes.intensity || 'standard',
        intensityLabel: attributes.intensityLabel || '自定义流程',
        whenToUse: attributes.whenToUse || parsed.leadEn || '由用户或 Agent 在本地扩展目录创建的自定义 Playbook。',
        vsHint: null,
        deliverable: attributes.deliverable || parsed.replyContractEn || '按自定义流程步骤验收交付',
        replyContractEn: parsed.replyContractEn || '',
        graph: customGraph,
        steps,
        rawStepCount: parsed.parsedStepsEn.length,
        builtinSkills: uniqueMerge(parseCsvAttr(attributes.builtinSkills), parsed.detectedRefs.skills),
        builtinPrinciples: uniqueMerge(parseCsvAttr(attributes.builtinPrinciples), parsed.detectedRefs.principles),
        subagents: parsed.detectedRefs.subagents,
        nativeTools: parsed.detectedRefs.natives,
        chainsOpeningPr: /Opening a PR|opening-a-pr\.md/i.test(raw),
        relPath: `user:playbooks/${filename}`,
        sourceFilePath: absPath,
        origin: 'custom',
        attribution: buildCustomAttribution(attributes),
      });
    }
  }

  const playbooks = [...builtinPlaybooks, ...customPlaybooks].sort((a, b) => {
    const ia = playbookOrder.indexOf(a.id);
    const ib = playbookOrder.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.id.localeCompare(b.id);
  });

  // 4b. Annotate each skill with all playbooks (built-in + custom) that reference it
  const skillPlaybookUsage = new Map();
  const markSkillUsedInPlaybook = (skillId, pbId) => {
    const cleanId = String(skillId || '').replace(/^\//, '').trim();
    if (!cleanId) return;
    if (!skillPlaybookUsage.has(cleanId)) skillPlaybookUsage.set(cleanId, []);
    const list = skillPlaybookUsage.get(cleanId);
    if (!list.includes(pbId)) list.push(pbId);
  };
  for (const pb of playbooks) {
    for (const skId of pb.builtinSkills || []) {
      markSkillUsedInPlaybook(skId, pb.id);
    }
    if (pb.graph) {
      for (const row of pb.graph.rows || []) {
        for (const n of row) {
          for (const tok of n.mounts || []) {
            if (typeof tok === 'string' && tok.startsWith('/')) {
              markSkillUsedInPlaybook(tok.slice(1), pb.id);
            }
          }
        }
      }
    }
  }
  for (const sk of skills) {
    sk.usedInPlaybooks = skillPlaybookUsage.get(sk.id) || [];
    sk.inAnyPlaybook = sk.usedInPlaybooks.length > 0;
  }

  // 5. Discover Subagents
  const agentFiles = existsSync(agentsDir)
    ? readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort()
    : [];

  const agents = agentFiles.map((filename) => {
    const id = basename(filename, '.md');
    const relPath = `agents/${filename}`;
    const raw = readFileSync(join(pluginRoot, relPath), 'utf-8');
    const { attributes } = parseFrontmatter(raw);
    const meta = AGENT_META[id] || {};
    return {
      id,
      titleZh: meta.titleZh || id,
      summary: meta.summary || attributes.description || '',
      descriptionEn: attributes.description || '',
      relPath,
    };
  });

  return {
    plugin: {
      name: pluginManifest.name || 'pstack',
      displayName: pluginManifest.displayName || 'pstack',
      version: pluginManifest.version || '1.3.0',
      description: pluginManifest.description || '',
      rootPath: pluginRoot,
      defaultAttribution: POTETO_ATTRIBUTION,
    },
    counts: {
      playbooks: playbooks.length,
      builtinPlaybooks: builtinPlaybooks.length,
      customPlaybooks: customPlaybooks.length,
      skills: skills.length,
      builtinSkills: builtinSkillsList.length,
      customSkills: customSkillsList.length,
      principles: principles.length,
      builtinPrinciples: builtinPrinciplesList.length,
      customPrinciples: customPrinciplesList.length,
      agents: agents.length,
      recipes: GOLDEN_RECIPES.length,
    },
    userPaths,
    settings: {
      ui: userConfig.ui,
      skillDirs: enrichedSkillDirs,
      defaultSkillSources,
    },
    usage,
    scenarios: SCENARIOS,
    skillLines: SKILL_LINES,
    intentMatcher: INTENT_MATCHER,
    closeCalls: CLOSE_CALLS,
    constraints: CONSTRAINTS,
    nativeModifiers: NATIVE_MODIFIERS,
    recipes: GOLDEN_RECIPES,
    playbooks,
    skills,
    principles,
    agents,
  };
}

/**
 * Safely reads a markdown source file from:
 * - Built-in `pluginRoot` relative path (e.g. `skills/tdd/SKILL.md`)
 * - User overlay path (`user:playbooks/<slug>.md`, `user:skills/<slug>/SKILL.md`, `user:principles/...`)
 * - Mounted external skill directory (`ext:<dirIdx>:<skillSlug>`)
 */
export function readCatalogSourceFile(relPath, pluginRoot = DEFAULT_PLUGIN_ROOT, options = {}) {
  const rawRef = String(relPath || '').trim();
  if (!rawRef || rawRef.includes('..')) {
    throw new Error('Invalid markdown source path');
  }

  if (rawRef.startsWith('user:')) {
    const sub = rawRef.slice('user:'.length).replace(/^\/+/, '');
    if (!sub || sub.includes('..') || !sub.endsWith('.md')) {
      throw new Error('Invalid user markdown source path');
    }
    const userPaths = getUserStudioPaths(options?.userDir);
    const absPath = resolve(userPaths.root, sub);
    const rootPrefix = resolve(userPaths.root) + '/';
    if (!absPath.startsWith(rootPrefix) || !existsSync(absPath)) {
      throw new Error(`User source file not found: ${sub}`);
    }
    return {
      relPath: rawRef,
      absPath,
      content: readFileSync(absPath, 'utf-8'),
    };
  }

  if (rawRef.startsWith('ext:')) {
    const match = rawRef.match(/^ext:(\d+):([A-Za-z0-9._-]+)$/);
    if (!match) {
      throw new Error('Invalid external skill reference');
    }
    const dirIdx = Number(match[1]);
    const skillId = match[2];
    const cfg = readUserConfig(options?.userDir);
    const dirEntry = cfg.skillDirs[dirIdx];
    if (!dirEntry) {
      throw new Error('External skill directory not configured');
    }
    const scan = discoverSkillsInDirectory(dirEntry.resolvedPath);
    const found = scan.skills.find((s) => s.id === skillId);
    if (!found || !existsSync(found.filePath)) {
      throw new Error(`External skill not found: ${skillId}`);
    }
    return {
      relPath: found.filePath,
      absPath: found.filePath,
      content: readFileSync(found.filePath, 'utf-8'),
    };
  }

  if (rawRef.startsWith('auto:')) {
    const match = rawRef.match(/^auto:(\d+):([A-Za-z0-9._-]+)$/);
    if (!match) {
      throw new Error('Invalid auto-discovered skill reference');
    }
    const dirIdx = Number(match[1]);
    const skillId = match[2];
    const autoDirs = collectDefaultLoadedSkillDirs({
      geminiConfigDir: options?.geminiConfigDir,
      workspaceUris: Array.isArray(options?.workspaceUris) ? options.workspaceUris : [],
      fallbackWorkspacePath: options?.fallbackWorkspacePath || '',
    });
    const dirEntry = autoDirs[dirIdx];
    if (!dirEntry) {
      throw new Error('Auto-discovered skill directory not found');
    }
    const scan = discoverSkillsInDirectory(dirEntry.absPath);
    const found = scan.skills.find((s) => s.id === skillId);
    if (!found || !existsSync(found.filePath)) {
      throw new Error(`Auto-discovered skill not found: ${skillId}`);
    }
    return {
      relPath: found.filePath,
      absPath: found.filePath,
      content: readFileSync(found.filePath, 'utf-8'),
    };
  }

  const safeRel = rawRef.replace(/^\/+/, '');
  if (!safeRel || safeRel.includes('..') || !safeRel.endsWith('.md')) {
    throw new Error('Invalid markdown source path');
  }
  const absPath = resolve(pluginRoot, safeRel);
  const rootPrefix = resolve(pluginRoot) + '/';
  if (!absPath.startsWith(rootPrefix) || !existsSync(absPath)) {
    throw new Error(`Source file not found: ${safeRel}`);
  }
  return {
    relPath: safeRel,
    absPath,
    content: readFileSync(absPath, 'utf-8'),
  };
}
