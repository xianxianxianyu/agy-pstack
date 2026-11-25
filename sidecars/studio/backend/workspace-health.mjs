/**
 * @fileoverview Active workspace & global configuration readiness checker.
 *
 * Inspects:
 * 1. `~/.gemini/config/rules/pstack-models.md` (written by `/setup-pstack`)
 * 2. Active workspace directories (`file:///...` URIs pushed by `window.sidecar`)
 *    - `.agents/skills/verify-<app>/SKILL.md` (app verification skill)
 *    - `.agents/skills/<formal-skill>/SKILL.md` (formal verification skill)
 *    - `AGENTS.md` / `CONTEXT.md` (project rules & domain context)
 *    - `.git/config` remote host (`gitlab` vs `github`)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function uriToFsPath(uriOrPath) {
  const raw = String(uriOrPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('file://')) {
    try {
      return fileURLToPath(raw);
    } catch {
      return '';
    }
  }
  if (raw.startsWith('/')) return raw;
  return '';
}

function inspectModelsRule(geminiConfigDir) {
  const rulePath = join(geminiConfigDir, 'rules', 'pstack-models.md');
  if (!existsSync(rulePath)) {
    return {
      configured: false,
      path: rulePath,
      budget: null,
      roleCount: 0,
      hasGitlabRule: false,
    };
  }
  const content = readFileSync(rulePath, 'utf-8');
  const budgetMatch = content.match(/^#\s*budget\s*:\s*(.+)$/im);
  const roles = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const kv = trimmed.match(/^([a-z0-9 ,_-]+)\s*:\s*(.+)$/i);
    if (kv) {
      roles.push({ role: kv[1].trim(), value: kv[2].trim() });
    }
  }
  return {
    configured: true,
    path: rulePath,
    budget: budgetMatch ? budgetMatch[1].trim() : 'custom',
    roleCount: roles.length,
    roles: roles.slice(0, 12),
    hasGitlabRule: /gitlab|glab/i.test(content),
  };
}

function inspectSingleWorkspace(wsPath) {
  if (!wsPath || !existsSync(wsPath)) return null;
  let stat;
  try {
    stat = statSync(wsPath);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  const verifySkills = [];
  const formalSkills = [];
  const candidateRoots = ['.agents/skills', '.agent/skills'];

  for (const relRoot of candidateRoots) {
    const absSkillsDir = join(wsPath, relRoot);
    if (!existsSync(absSkillsDir)) continue;
    try {
      for (const entry of readdirSync(absSkillsDir)) {
        const skillMd = join(absSkillsDir, entry, 'SKILL.md');
        if (!existsSync(skillMd)) continue;
        if (entry.startsWith('verify-')) {
          verifySkills.push(entry);
        } else if (/formal|tla|kani|tlc/i.test(entry)) {
          formalSkills.push(entry);
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  let gitHost = null;
  const gitConfigPath = join(wsPath, '.git', 'config');
  if (existsSync(gitConfigPath)) {
    try {
      const gitCfg = readFileSync(gitConfigPath, 'utf-8');
      if (/gitlab/i.test(gitCfg)) {
        gitHost = 'gitlab';
      } else if (/github\.com/i.test(gitCfg)) {
        gitHost = 'github';
      } else {
        gitHost = 'git';
      }
    } catch {
      gitHost = 'git';
    }
  }

  return {
    name: basename(wsPath),
    path: wsPath,
    verifySkills,
    formalSkills,
    hasAgentsMd: existsSync(join(wsPath, 'AGENTS.md')),
    hasContextMd: existsSync(join(wsPath, 'CONTEXT.md')),
    gitHost,
  };
}

export function checkWorkspaceHealth({
  workspaceUris = [],
  geminiConfigDir = process.env.ANTIGRAVITY_GEMINI_CONFIG_DIR || join(homedir(), '.gemini', 'config'),
  fallbackWorkspacePath = '',
} = {}) {
  const modelsRule = inspectModelsRule(geminiConfigDir);

  const fsPaths = [];
  for (const uri of Array.isArray(workspaceUris) ? workspaceUris : []) {
    const p = uriToFsPath(uri);
    if (p && !fsPaths.includes(p)) fsPaths.push(p);
  }
  if (fsPaths.length === 0 && fallbackWorkspacePath) {
    const fallback = uriToFsPath(fallbackWorkspacePath);
    if (fallback) fsPaths.push(fallback);
  }

  const workspaces = fsPaths.map(inspectSingleWorkspace).filter(Boolean);
  const allVerifySkills = [...new Set(workspaces.flatMap((w) => w.verifySkills))];
  const allFormalSkills = [...new Set(workspaces.flatMap((w) => w.formalSkills))];
  const primaryWs = workspaces[0] || null;

  return {
    modelsRule,
    workspaces,
    summary: {
      hasWorkspace: workspaces.length > 0,
      workspaceName: primaryWs ? primaryWs.name : '',
      hasModelsRule: modelsRule.configured,
      modelsBudget: modelsRule.budget,
      hasVerifySkill: allVerifySkills.length > 0,
      verifySkills: allVerifySkills,
      hasFormalSkill: allFormalSkills.length > 0,
      formalSkills: allFormalSkills,
      gitHost: primaryWs ? primaryWs.gitHost : null,
    },
  };
}
