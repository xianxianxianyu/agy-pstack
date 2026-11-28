/**
 * @fileoverview Safe plugin update checker & fast-forward applier for pstack Studio.
 *
 * Strategy:
 * - Git installs (primary): fast `git ls-remote` against `origin` (never mutates
 *   local refs or working tree) + optional GitHub Compare API for commit log.
 * - Non-git installs (fallback): semver comparison against remote `plugin.json`.
 * - Persists check cache & dismissed target in `~/.gemini/config/pstack-studio/update-cache.json`
 *   with a default 6-hour TTL so Studio never spams GitHub or blocks startup.
 * - Auto-update runs `git pull --ff-only` ONLY when the working tree is completely clean.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getUserStudioDir } from './user-store.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const GIT_QUICK_TIMEOUT_MS = 6000;
const GIT_PULL_TIMEOUT_MS = 20000;
const HTTP_TIMEOUT_MS = 5000;

export function getUpdateCachePath(overrideUserDir) {
  return join(getUserStudioDir(overrideUserDir), 'update-cache.json');
}

function readUpdateCache(overrideUserDir) {
  const cachePath = getUpdateCachePath(overrideUserDir);
  try {
    if (!existsSync(cachePath)) return null;
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeUpdateCache(payload, overrideUserDir) {
  const cachePath = getUpdateCachePath(overrideUserDir);
  try {
    mkdirSync(resolve(cachePath, '..'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  } catch {
    // Non-fatal in read-only environments
  }
}

export function parseGithubRepo(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return null;
  const match = s.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  return {
    owner,
    repo,
    htmlUrl: `https://github.com/${owner}/${repo}`,
  };
}

export function compareSemver(a, b) {
  const parse = (v) =>
    String(v || '0.0.0')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => {
        const num = parseInt(n, 10);
        return Number.isFinite(num) ? num : 0;
      });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function runGit(args, cwd, timeout = GIT_QUICK_TIMEOUT_MS) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return String(stdout || '').trim();
}

async function fetchJsonWithTimeout(url, fetchImpl = globalThis.fetch, timeoutMs = HTTP_TIMEOUT_MS) {
  if (typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pstack-studio-updater',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectLocalPluginRepo(pluginRoot) {
  const manifestPath = join(pluginRoot, 'plugin.json');
  let manifest = {};
  try {
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    }
  } catch {
    manifest = {};
  }

  const localVersion = String(manifest.version || '0.0.0').trim();
  const fallbackRepoUrl = String(manifest.repository || manifest.homepage || '').trim();
  const hasGitDir = existsSync(join(pluginRoot, '.git'));

  if (!hasGitDir) {
    const githubRepo = parseGithubRepo(fallbackRepoUrl);
    return {
      isGitRepo: false,
      localVersion,
      localSha: '',
      localShortSha: '',
      branch: 'main',
      remoteUrl: fallbackRepoUrl,
      githubRepo,
      isDirty: false,
      dirtyFilesCount: 0,
    };
  }

  let localSha = '';
  let branch = 'main';
  let remoteUrl = '';
  let dirtyFilesCount = 0;

  try {
    localSha = await runGit(['rev-parse', 'HEAD'], pluginRoot);
  } catch {
    localSha = '';
  }

  try {
    const rawBranch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], pluginRoot);
    if (rawBranch && rawBranch !== 'HEAD') branch = rawBranch;
  } catch {
    branch = 'main';
  }

  try {
    remoteUrl = await runGit(['remote', 'get-url', 'origin'], pluginRoot);
  } catch {
    remoteUrl = fallbackRepoUrl;
  }

  try {
    const porcelain = await runGit(['status', '--porcelain'], pluginRoot);
    const lines = porcelain
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => Boolean(l) && !l.endsWith('__pycache__/'));
    dirtyFilesCount = lines.length;
  } catch {
    dirtyFilesCount = 0;
  }

  const githubRepo = parseGithubRepo(remoteUrl) || parseGithubRepo(fallbackRepoUrl);

  return {
    isGitRepo: Boolean(localSha),
    localVersion,
    localSha,
    localShortSha: localSha ? localSha.slice(0, 7) : '',
    branch,
    remoteUrl,
    githubRepo,
    isDirty: dirtyFilesCount > 0,
    dirtyFilesCount,
  };
}

function buildManualCommand(pluginRoot, local) {
  if (local.isGitRepo) {
    return `git -C "${pluginRoot}" pull --ff-only origin ${local.branch || 'main'}`;
  }
  if (local.githubRepo) {
    return `git clone ${local.githubRepo.htmlUrl}.git "${pluginRoot}"`;
  }
  return '';
}

function isTargetDismissed(dismissedTarget, target) {
  return Boolean(dismissedTarget && target && String(dismissedTarget) === String(target));
}

export async function checkForPluginUpdate({
  pluginRoot,
  userDir,
  force = false,
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const effectiveIntervalMs =
    Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0
      ? Number(intervalMs)
      : DEFAULT_CHECK_INTERVAL_MS;
  const intervalHours = Math.round((effectiveIntervalMs / (60 * 60 * 1000)) * 10) / 10;

  const local = await inspectLocalPluginRepo(pluginRoot);
  const cached = readUpdateCache(userDir);
  const dismissedTarget = cached?.dismissedTarget || '';
  const nowMs = Date.now();
  const manualCommand = buildManualCommand(pluginRoot, local);

  // Return fresh cache if within TTL and local HEAD/version hasn't changed
  if (!force && cached && cached.checkedAtMs && nowMs - cached.checkedAtMs < effectiveIntervalMs) {
    const sameLocal = local.isGitRepo
      ? cached.localSha === local.localSha && cached.branch === local.branch
      : cached.localVersion === local.localVersion;
    if (sameLocal && cached.status && cached.status !== 'error') {
      const targetId = cached.remoteSha || cached.remoteVersion || '';
      const hasUpdate = Boolean(cached.hasUpdate);
      return {
        ...cached,
        fromCache: true,
        isDirty: local.isDirty,
        dirtyFilesCount: local.dirtyFilesCount,
        canAutoUpdate: local.isGitRepo && hasUpdate && !local.isDirty && cached.status !== 'diverged',
        dismissed: hasUpdate && isTargetDismissed(dismissedTarget, targetId),
        manualCommand,
      };
    }
  }

  const checkedAt = new Date(nowMs).toISOString();
  const nextCheckAt = new Date(nowMs + effectiveIntervalMs).toISOString();
  const basePayload = {
    ok: true,
    mode: local.isGitRepo ? 'git' : 'version',
    status: 'up-to-date',
    hasUpdate: false,
    dismissed: false,
    fromCache: false,
    checkedAt,
    checkedAtMs: nowMs,
    nextCheckAt,
    intervalHours,
    localVersion: local.localVersion,
    remoteVersion: local.localVersion,
    localSha: local.localSha,
    localShortSha: local.localShortSha,
    remoteSha: local.localSha,
    remoteShortSha: local.localShortSha,
    branch: local.branch,
    aheadBy: 0,
    behindBy: 0,
    isDirty: local.isDirty,
    dirtyFilesCount: local.dirtyFilesCount,
    canAutoUpdate: false,
    commits: [],
    compareUrl: local.githubRepo ? local.githubRepo.htmlUrl : '',
    repoUrl: local.githubRepo ? local.githubRepo.htmlUrl : local.remoteUrl || '',
    manualCommand,
    dismissedTarget,
    error: '',
  };

  if (local.isGitRepo && local.remoteUrl) {
    try {
      let lsOut = '';
      try {
        lsOut = await runGit(['ls-remote', '--heads', 'origin', local.branch], pluginRoot);
      } catch {
        lsOut = '';
      }
      if (!lsOut) {
        lsOut = await runGit(['ls-remote', 'origin', 'HEAD'], pluginRoot);
      }
      const remoteSha = (lsOut.split(/\s+/)[0] || '').trim();
      if (!remoteSha || !/^[0-9a-f]{7,40}$/i.test(remoteSha)) {
        throw new Error('无法解析远程仓库最新提交');
      }

      const remoteShortSha = remoteSha.slice(0, 7);
      if (remoteSha === local.localSha) {
        const result = {
          ...basePayload,
          status: 'up-to-date',
          hasUpdate: false,
          remoteSha,
          remoteShortSha,
        };
        writeUpdateCache(result, userDir);
        return result;
      }

      // Inspect commit relation via GitHub Compare API when available, or local git ancestor check
      let status = 'update-available';
      let hasUpdate = true;
      let aheadBy = 0;
      let behindBy = 0;
      let commits = [];
      let compareUrl = local.githubRepo
        ? `${local.githubRepo.htmlUrl}/compare/${local.localShortSha}...${remoteShortSha}`
        : '';

      if (local.githubRepo) {
        const compareApi = `https://api.github.com/repos/${local.githubRepo.owner}/${local.githubRepo.repo}/compare/${local.localSha}...${remoteSha}`;
        const cmp = await fetchJsonWithTimeout(compareApi, fetchImpl);
        if (cmp && typeof cmp === 'object' && typeof cmp.status === 'string') {
          aheadBy = Number(cmp.ahead_by) || 0;
          behindBy = Number(cmp.behind_by) || 0;
          if (cmp.html_url) compareUrl = String(cmp.html_url);
          if (Array.isArray(cmp.commits)) {
            commits = cmp.commits
              .slice(-10)
              .reverse()
              .map((c) => ({
                sha: String(c.sha || ''),
                shortSha: String(c.sha || '').slice(0, 7),
                message: String(c.commit?.message || '').split('\n')[0].trim(),
                author: String(c.author?.login || c.commit?.author?.name || '').trim(),
                date: String(c.commit?.author?.date || ''),
              }))
              .filter((c) => c.shortSha && c.message);
          }
          if (cmp.status === 'identical') {
            status = 'up-to-date';
            hasUpdate = false;
          } else if (cmp.status === 'behind') {
            // Remote is behind local (user has unpushed local commits)
            status = 'local-ahead';
            hasUpdate = false;
          } else if (cmp.status === 'diverged') {
            status = 'diverged';
            hasUpdate = aheadBy > 0;
          } else {
            status = 'update-available';
            hasUpdate = aheadBy > 0 || remoteSha !== local.localSha;
          }
        }
      }

      // Offline / non-GitHub remote check: verify whether remoteSha is already an ancestor of local HEAD
      if (hasUpdate && commits.length === 0) {
        try {
          await runGit(['merge-base', '--is-ancestor', remoteSha, local.localSha], pluginRoot);
          status = 'local-ahead';
          hasUpdate = false;
        } catch {
          // Not an ancestor -> remote genuinely has commits we don't have locally
        }
      }

      const result = {
        ...basePayload,
        status,
        hasUpdate,
        dismissed: hasUpdate && isTargetDismissed(dismissedTarget, remoteSha),
        remoteSha,
        remoteShortSha,
        aheadBy,
        behindBy,
        canAutoUpdate: hasUpdate && !local.isDirty && status !== 'diverged',
        commits,
        compareUrl,
      };
      writeUpdateCache(result, userDir);
      return result;
    } catch (err) {
      return {
        ...basePayload,
        ok: false,
        status: 'error',
        error: err?.message || '检查远程更新失败',
      };
    }
  }

  // Non-git fallback: compare version in remote plugin.json
  if (local.githubRepo) {
    try {
      const rawManifestUrl = `https://raw.githubusercontent.com/${local.githubRepo.owner}/${local.githubRepo.repo}/${local.branch || 'main'}/plugin.json`;
      const remoteManifest = await fetchJsonWithTimeout(rawManifestUrl, fetchImpl);
      if (!remoteManifest || !remoteManifest.version) {
        throw new Error('无法读取远程 plugin.json 版本信息');
      }
      const remoteVersion = String(remoteManifest.version).trim();
      const hasUpdate = compareSemver(remoteVersion, local.localVersion) > 0;
      const result = {
        ...basePayload,
        status: hasUpdate ? 'update-available' : 'up-to-date',
        hasUpdate,
        dismissed: hasUpdate && isTargetDismissed(dismissedTarget, remoteVersion),
        remoteVersion,
        canAutoUpdate: false,
      };
      writeUpdateCache(result, userDir);
      return result;
    } catch (err) {
      return {
        ...basePayload,
        ok: false,
        status: 'error',
        error: err?.message || '检查远程版本失败',
      };
    }
  }

  return {
    ...basePayload,
    ok: false,
    status: 'error',
    error: '未找到可用的远程仓库配置',
  };
}

export function dismissPluginUpdate({ target = '', userDir } = {}) {
  const cleanTarget = String(target || '').trim();
  const cached = readUpdateCache(userDir) || {};
  const next = {
    ...cached,
    dismissedTarget: cleanTarget,
    dismissed: Boolean(cleanTarget),
  };
  writeUpdateCache(next, userDir);
  return { ok: true, dismissedTarget: cleanTarget };
}

export async function applyPluginUpdate({ pluginRoot, userDir } = {}) {
  const local = await inspectLocalPluginRepo(pluginRoot);
  if (!local.isGitRepo) {
    throw new Error('当前插件目录不是 Git 仓库，请手动重新安装最新插件');
  }
  if (local.isDirty) {
    throw new Error(
      `插件目录存在 ${local.dirtyFilesCount} 处未提交改动，为避免覆盖本地修改已中止更新，请先手动处理`
    );
  }

  const beforeSha = local.localSha;
  const branch = local.branch || 'main';
  await runGit(['pull', '--ff-only', 'origin', branch], pluginRoot, GIT_PULL_TIMEOUT_MS);

  const afterLocal = await inspectLocalPluginRepo(pluginRoot);
  const afterSha = afterLocal.localSha;
  let changedFiles = [];
  if (beforeSha && afterSha && beforeSha !== afterSha) {
    try {
      const diffOut = await runGit(['diff', '--name-only', beforeSha, afterSha], pluginRoot);
      changedFiles = diffOut
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      changedFiles = [];
    }
  }

  const requiresRestart = changedFiles.some(
    (f) => f === 'sidecars/studio/main.mjs' || f === 'sidecars/studio/sidecar.json'
  );
  const requiresReload =
    requiresRestart ||
    changedFiles.some(
      (f) => f.startsWith('sidecars/studio/frontend/') || f.startsWith('sidecars/studio/shared/')
    );

  const nowMs = Date.now();
  const nextCache = {
    ok: true,
    mode: 'git',
    status: 'up-to-date',
    hasUpdate: false,
    dismissed: false,
    fromCache: false,
    checkedAt: new Date(nowMs).toISOString(),
    checkedAtMs: nowMs,
    nextCheckAt: new Date(nowMs + DEFAULT_CHECK_INTERVAL_MS).toISOString(),
    intervalHours: 6,
    localVersion: afterLocal.localVersion,
    remoteVersion: afterLocal.localVersion,
    localSha: afterSha,
    localShortSha: afterLocal.localShortSha,
    remoteSha: afterSha,
    remoteShortSha: afterLocal.localShortSha,
    branch: afterLocal.branch,
    aheadBy: 0,
    behindBy: 0,
    isDirty: afterLocal.isDirty,
    dirtyFilesCount: afterLocal.dirtyFilesCount,
    canAutoUpdate: false,
    commits: [],
    compareUrl: afterLocal.githubRepo ? afterLocal.githubRepo.htmlUrl : '',
    repoUrl: afterLocal.githubRepo ? afterLocal.githubRepo.htmlUrl : afterLocal.remoteUrl || '',
    manualCommand: buildManualCommand(pluginRoot, afterLocal),
    dismissedTarget: '',
    error: '',
  };
  writeUpdateCache(nextCache, userDir);

  return {
    ok: true,
    updated: beforeSha !== afterSha,
    beforeSha,
    beforeShortSha: beforeSha ? beforeSha.slice(0, 7) : '',
    afterSha,
    afterShortSha: afterSha ? afterSha.slice(0, 7) : '',
    changedFiles,
    requiresRestart,
    requiresReload,
    updateInfo: nextCache,
  };
}
