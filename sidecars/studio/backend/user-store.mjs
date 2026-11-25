/**
 * @fileoverview User-space configuration, external skill path registry,
 * custom playbooks/skills/principles storage, and usage frequency tracking
 * for pstack Studio.
 *
 * All user data lives outside the plugin git repository (default:
 * `~/.gemini/config/pstack-studio/`) so pulling upstream plugin updates
 * never creates merge conflicts.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export const VALID_THEMES = ['auto', 'light', 'dark'];
export const VALID_FONTS = ['system', 'sans-cn', 'mono', 'serif'];
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 16;

export const DEFAULT_UI_SETTINGS = {
  themeMode: 'auto',
  fontFamily: 'system',
  fontSize: 14,
};

export const EMPTY_USAGE = {
  presets: {},
  playbooks: {},
  skills: {},
  principles: {},
};

export function getUserStudioDir(overrideDir) {
  if (overrideDir) return resolve(String(overrideDir));
  if (process.env.PSTACK_STUDIO_USER_DIR) {
    return resolve(String(process.env.PSTACK_STUDIO_USER_DIR));
  }
  return join(homedir(), '.gemini', 'config', 'pstack-studio');
}

export function getUserStudioPaths(overrideDir) {
  const root = getUserStudioDir(overrideDir);
  return {
    root,
    configPath: join(root, 'config.json'),
    usagePath: join(root, 'usage.json'),
    playbooksDir: join(root, 'playbooks'),
    skillsDir: join(root, 'skills'),
    principlesDir: join(root, 'principles'),
  };
}

export function expandHomePath(rawPath) {
  const s = String(rawPath || '').trim();
  if (!s) return '';
  if (s === '~') return homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) {
    return join(homedir(), s.slice(2));
  }
  return resolve(s);
}

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  ensureDir(resolve(filePath, '..'));
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function normalizeUiSettings(rawUi = {}) {
  const themeMode = VALID_THEMES.includes(rawUi.themeMode) ? rawUi.themeMode : DEFAULT_UI_SETTINGS.themeMode;
  const fontFamily = VALID_FONTS.includes(rawUi.fontFamily) ? rawUi.fontFamily : DEFAULT_UI_SETTINGS.fontFamily;
  const parsedSize = Number(rawUi.fontSize);
  const fontSize = Number.isFinite(parsedSize)
    ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(parsedSize)))
    : DEFAULT_UI_SETTINGS.fontSize;
  return { themeMode, fontFamily, fontSize };
}

export function readUserConfig(overrideDir) {
  const paths = getUserStudioPaths(overrideDir);
  const raw = readJsonSafe(paths.configPath, {});
  const ui = normalizeUiSettings(raw?.ui);
  const rawDirs = Array.isArray(raw?.skillDirs) ? raw.skillDirs : [];
  const seen = new Set();
  const skillDirs = [];
  for (const item of rawDirs) {
    const rawPath = typeof item === 'string' ? item : item?.path;
    if (!rawPath || !String(rawPath).trim()) continue;
    const expanded = expandHomePath(rawPath);
    if (seen.has(expanded)) continue;
    seen.add(expanded);
    skillDirs.push({
      path: String(rawPath).trim(),
      resolvedPath: expanded,
      label: typeof item === 'object' && item?.label ? String(item.label).trim() : basename(expanded),
      addedAt: typeof item === 'object' && item?.addedAt ? String(item.addedAt) : '',
    });
  }
  return { ui, skillDirs };
}

export function saveUserConfig(config, overrideDir) {
  const paths = getUserStudioPaths(overrideDir);
  const clean = {
    ui: normalizeUiSettings(config?.ui),
    skillDirs: (Array.isArray(config?.skillDirs) ? config.skillDirs : []).map((d) => ({
      path: String(d.path || '').trim(),
      label: String(d.label || basename(expandHomePath(d.path || ''))).trim(),
      addedAt: d.addedAt || new Date().toISOString(),
    })),
  };
  writeJsonAtomic(paths.configPath, clean);
  return readUserConfig(overrideDir);
}

export function updateUiSettings(patch = {}, overrideDir) {
  const current = readUserConfig(overrideDir);
  const nextUi = normalizeUiSettings({ ...current.ui, ...patch });
  return saveUserConfig({ ...current, ui: nextUi }, overrideDir);
}

/**
 * Discovers skill folders inside `dirPath`.
 * Supports BOTH:
 * - Single skill folder containing `SKILL.md` directly
 * - Container directory holding one-level `<slug>/SKILL.md` subfolders
 */
export function discoverSkillsInDirectory(dirPath) {
  const resolved = expandHomePath(dirPath);
  if (!resolved || !existsSync(resolved)) {
    return { exists: false, isDir: false, resolvedPath: resolved, skills: [] };
  }
  let st;
  try {
    st = statSync(resolved);
  } catch {
    return { exists: false, isDir: false, resolvedPath: resolved, skills: [] };
  }
  if (!st.isDirectory()) {
    return { exists: true, isDir: false, resolvedPath: resolved, skills: [] };
  }

  const skills = [];
  const directSkillMd = join(resolved, 'SKILL.md');
  if (existsSync(directSkillMd)) {
    skills.push({
      id: basename(resolved),
      dirPath: resolved,
      filePath: directSkillMd,
    });
    return { exists: true, isDir: true, resolvedPath: resolved, skills };
  }

  const entries = readdirSync(resolved).sort();
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const sub = join(resolved, name);
    try {
      if (!statSync(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    const mdPath = join(sub, 'SKILL.md');
    if (existsSync(mdPath)) {
      skills.push({
        id: name,
        dirPath: sub,
        filePath: mdPath,
      });
    }
  }
  return { exists: true, isDir: true, resolvedPath: resolved, skills };
}

export function addSkillDir({ path: inputPath, label = '' } = {}, overrideDir) {
  const rawPath = String(inputPath || '').trim();
  if (!rawPath) {
    throw new Error('请填写技能文件夹路径');
  }
  const scan = discoverSkillsInDirectory(rawPath);
  if (!scan.exists || !scan.isDir) {
    throw new Error(`目录不存在或不是有效文件夹：${scan.resolvedPath}`);
  }
  const current = readUserConfig(overrideDir);
  if (current.skillDirs.some((d) => d.resolvedPath === scan.resolvedPath)) {
    throw new Error('该技能目录已在列表中');
  }
  const next = {
    ...current,
    skillDirs: [
      ...current.skillDirs,
      {
        path: rawPath,
        label: String(label || '').trim() || basename(scan.resolvedPath),
        addedAt: new Date().toISOString(),
      },
    ],
  };
  const saved = saveUserConfig(next, overrideDir);
  return {
    settings: saved,
    discoveredCount: scan.skills.length,
    discoveredIds: scan.skills.map((s) => s.id),
  };
}

export function removeSkillDir(targetPath, overrideDir) {
  const resolvedTarget = expandHomePath(targetPath);
  const current = readUserConfig(overrideDir);
  const nextDirs = current.skillDirs.filter(
    (d) => d.path !== targetPath && d.resolvedPath !== resolvedTarget
  );
  return saveUserConfig({ ...current, skillDirs: nextDirs }, overrideDir);
}

function sanitizeCountMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (k && Number.isFinite(n) && n > 0) {
      out[k] = Math.floor(n);
    }
  }
  return out;
}

export function readUsageStats(overrideDir) {
  const paths = getUserStudioPaths(overrideDir);
  const raw = readJsonSafe(paths.usagePath, EMPTY_USAGE);
  return {
    presets: sanitizeCountMap(raw?.presets),
    playbooks: sanitizeCountMap(raw?.playbooks),
    skills: sanitizeCountMap(raw?.skills),
    principles: sanitizeCountMap(raw?.principles),
  };
}

export function recordUsage(
  { presetId = '', playbookId = '', skillIds = [], principleIds = [] } = {},
  overrideDir
) {
  const paths = getUserStudioPaths(overrideDir);
  const usage = readUsageStats(overrideDir);

  if (presetId && typeof presetId === 'string') {
    usage.presets[presetId] = (usage.presets[presetId] || 0) + 1;
  }
  if (playbookId && typeof playbookId === 'string') {
    usage.playbooks[playbookId] = (usage.playbooks[playbookId] || 0) + 1;
  }
  const uniqSkills = new Set(Array.isArray(skillIds) ? skillIds.filter((s) => typeof s === 'string' && s) : []);
  for (const sid of uniqSkills) {
    usage.skills[sid] = (usage.skills[sid] || 0) + 1;
  }
  const uniqPrinciples = new Set(
    Array.isArray(principleIds) ? principleIds.filter((p) => typeof p === 'string' && p) : []
  );
  for (const pid of uniqPrinciples) {
    usage.principles[pid] = (usage.principles[pid] || 0) + 1;
  }

  writeJsonAtomic(paths.usagePath, usage);
  return usage;
}

export function resetUsageStats(overrideDir) {
  const paths = getUserStudioPaths(overrideDir);
  const empty = { presets: {}, playbooks: {}, skills: {}, principles: {} };
  writeJsonAtomic(paths.usagePath, empty);
  return empty;
}

export function slugifyId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function createUserPrinciple(
  { slug = '', titleZh = '', titleEn = '', group = 'core', summary = '', body = '' } = {},
  overrideDir
) {
  const paths = getUserStudioPaths(overrideDir);
  const cleanTitleZh = String(titleZh || '').trim();
  const cleanSummary = String(summary || '').trim();
  const baseSlug = slugifyId(slug || titleEn || cleanTitleZh);
  if (!cleanTitleZh) {
    throw new Error('请填写原则中文名称');
  }
  if (!baseSlug) {
    throw new Error('请填写英文标识（slug，如 strict-error-budget）');
  }
  const shortSlug = baseSlug.replace(/^principle-/, '');
  const fullId = `principle-${shortSlug}`;
  const validGroups = ['core', 'architecture', 'verification', 'delegation', 'meta'];
  const cleanGroup = validGroups.includes(group) ? group : 'core';
  const cleanTitleEn = String(titleEn || shortSlug).trim();
  const cleanBody =
    String(body || '').trim() ||
    `# ${cleanTitleZh} (${cleanTitleEn})\n\n${cleanSummary || '在涉及该决策时必须遵守此工程原则。'}`;

  ensureDir(paths.principlesDir);
  const filePath = join(paths.principlesDir, `${shortSlug}.md`);
  const md = [
    '---',
    `name: ${fullId}`,
    `titleZh: ${cleanTitleZh}`,
    `titleEn: ${cleanTitleEn}`,
    `group: ${cleanGroup}`,
    `summary: ${cleanSummary || cleanTitleZh}`,
    `description: ${cleanSummary || cleanTitleEn}`,
    '---',
    '',
    cleanBody,
    '',
  ].join('\n');

  writeFileSync(filePath, md, 'utf-8');
  return { id: fullId, shortSlug, filePath };
}

export function deleteUserItem({ kind, id } = {}, overrideDir) {
  const paths = getUserStudioPaths(overrideDir);
  const safeId = String(id || '').trim();
  if (!safeId || safeId.includes('..') || safeId.includes('/') || safeId.includes('\\')) {
    throw new Error('非法的条目标识');
  }

  if (kind === 'playbook') {
    const mdPath = join(paths.playbooksDir, `${safeId}.md`);
    const graphPath = join(paths.playbooksDir, `${safeId}.graph.json`);
    if (!existsSync(mdPath)) {
      throw new Error('仅支持删除用户自定义流程（内置流程受只读保护）');
    }
    rmSync(mdPath, { force: true });
    if (existsSync(graphPath)) rmSync(graphPath, { force: true });
    return { deleted: true, kind, id: safeId };
  }

  if (kind === 'skill') {
    const dirPath = join(paths.skillsDir, safeId);
    if (!existsSync(dirPath)) {
      throw new Error('仅支持删除自定义目录内的技能（外部挂载请移除目录，内置技能受只读保护）');
    }
    rmSync(dirPath, { recursive: true, force: true });
    return { deleted: true, kind, id: safeId };
  }

  if (kind === 'principle') {
    const shortSlug = safeId.replace(/^principle-/, '');
    const candidates = [
      join(paths.principlesDir, `${shortSlug}.md`),
      join(paths.principlesDir, `${safeId}.md`),
      join(paths.principlesDir, safeId),
      join(paths.principlesDir, shortSlug),
    ];
    let removed = false;
    for (const c of candidates) {
      if (existsSync(c)) {
        rmSync(c, { recursive: true, force: true });
        removed = true;
      }
    }
    if (!removed) {
      throw new Error('仅支持删除用户自定义原则（内置原则受只读保护）');
    }
    return { deleted: true, kind, id: safeId };
  }

  throw new Error(`不支持的条目类型：${kind}`);
}

export function getUserStoreMtimeSignature(overrideDir) {
  const paths = getUserStudioPaths(overrideDir);
  const probe = (p) => {
    try {
      return existsSync(p) ? String(statSync(p).mtimeMs) : '0';
    } catch {
      return '0';
    }
  };
  const parts = [
    probe(paths.configPath),
    probe(paths.usagePath),
    probe(paths.playbooksDir),
    probe(paths.skillsDir),
    probe(paths.principlesDir),
  ];
  const cfg = readUserConfig(overrideDir);
  for (const d of cfg.skillDirs) {
    parts.push(probe(d.resolvedPath));
  }
  return parts.join('|');
}
