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
  SKILL_META,
} from './metadata-zh.mjs';
import { PLAYBOOK_GRAPHS } from './playbook-graphs.mjs';

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

/**
 * Builds the complete Studio catalog from `pluginRoot`.
 */
export function buildCatalog(pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const pluginJsonPath = join(pluginRoot, 'plugin.json');
  const pluginManifest = existsSync(pluginJsonPath)
    ? JSON.parse(readFileSync(pluginJsonPath, 'utf-8'))
    : { name: 'pstack', version: '1.1.0' };

  const skillsDir = join(pluginRoot, 'skills');
  const playbooksDir = join(skillsDir, 'poteto-mode', 'playbooks');
  const agentsDir = join(pluginRoot, 'agents');

  // 1. Discover all skill directories on disk
  const skillEntries = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((name) => {
        const full = join(skillsDir, name);
        return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
      }).sort()
    : [];

  const workflowSkillIds = skillEntries.filter((n) => !n.startsWith('principle-'));
  const principleSkillIds = skillEntries.filter((n) => n.startsWith('principle-'));

  // 2. Build Workflow Skills list
  const skills = workflowSkillIds.map((id) => {
    const relPath = `skills/${id}/SKILL.md`;
    const raw = readFileSync(join(pluginRoot, relPath), 'utf-8');
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
      roleTag: meta.roleTag || '工作流技能',
      descriptionEn: attributes.description || '',
      whenToUse: meta.whenToUse || attributes.description || '',
      vsHint: meta.vsHint || null,
      recommendedPairs: Array.isArray(meta.recommendedPairs) ? meta.recommendedPairs : [],
      examplePrompt: meta.examplePrompt || `/${id} `,
      relPath,
      lineCount: raw.split('\n').length,
      previewExcerpt: body.split('\n').slice(0, 12).join('\n'),
    };
  });

  // 3. Build Principles list
  const groupOrder = ['core', 'architecture', 'verification', 'delegation', 'meta'];
  const principles = principleSkillIds
    .map((id) => {
      const shortSlug = id.replace(/^principle-/, '');
      const relPath = `skills/${id}/SKILL.md`;
      const raw = readFileSync(join(pluginRoot, relPath), 'utf-8');
      const { attributes } = parseFrontmatter(raw);
      const meta = PRINCIPLE_META[id] || {};
      return {
        id,
        shortSlug,
        slash: `/${id}`,
        titleZh: meta.titleZh || shortSlug,
        titleEn: meta.titleEn || shortSlug,
        group: meta.group || 'core',
        groupLabel: meta.groupLabel || '核心思维 Core',
        summary: meta.summary || attributes.description || '',
        descriptionEn: attributes.description || '',
        relPath,
      };
    })
    .sort((a, b) => {
      const ga = groupOrder.indexOf(a.group);
      const gb = groupOrder.indexOf(b.group);
      if (ga !== gb) return ga - gb;
      return a.id.localeCompare(b.id);
    });

  // 4. Discover and parse all Playbooks
  const playbookFiles = existsSync(playbooksDir)
    ? readdirSync(playbooksDir).filter((f) => f.endsWith('.md')).sort()
    : [];

  const playbookOrder = Object.keys(PLAYBOOK_META);
  const playbooks = playbookFiles
    .map((filename) => {
      const id = basename(filename, '.md');
      const relPath = `skills/poteto-mode/playbooks/${filename}`;
      const raw = readFileSync(join(pluginRoot, relPath), 'utf-8');
      const parsed = parsePlaybookMarkdown(id, raw, workflowSkillIds, principleSkillIds);
      const meta = PLAYBOOK_META[id] || {};

      // Align curated Chinese steps with real parsed references where possible
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
      };
    })
    .sort((a, b) => {
      const ia = playbookOrder.indexOf(a.id);
      const ib = playbookOrder.indexOf(b.id);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.id.localeCompare(b.id);
    });

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
      version: pluginManifest.version || '1.1.0',
      description: pluginManifest.description || '',
      rootPath: pluginRoot,
    },
    counts: {
      playbooks: playbooks.length,
      skills: skills.length,
      principles: principles.length,
      agents: agents.length,
      recipes: GOLDEN_RECIPES.length,
    },
    scenarios: SCENARIOS,
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
 * Safely reads a relative markdown file inside `pluginRoot` for inline preview.
 */
export function readCatalogSourceFile(relPath, pluginRoot = DEFAULT_PLUGIN_ROOT) {
  const safeRel = String(relPath || '').replace(/^\/+/, '');
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
