/**
 * @fileoverview Antigravity Sidecar entry point for pstack Studio.
 *
 * Serves static frontend assets from disk (with no-store cache headers for
 * live refresh) and JSON APIs for dynamic playbook/skill scanning, active
 * workspace readiness checks, markdown source preview, and non-downgrading
 * new-conversation creation.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { DEFAULT_PLUGIN_ROOT, readCatalogSourceFile } from './backend/catalog-builder.mjs';
import { buildClassicAppBundle } from './backend/bundle-frontend.mjs';
import { checkWorkspaceHealth } from './backend/workspace-health.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = join(__dirname, 'frontend');
const SHARED_DIR = join(__dirname, 'shared');
const BACKEND_DIR = join(__dirname, 'backend');

let cachedCatalogKey = '';
let cachedCatalogData = null;

async function getLiveCatalog() {
  const m1 = statSync(join(BACKEND_DIR, 'metadata-zh.mjs')).mtimeMs;
  const m2 = statSync(join(BACKEND_DIR, 'catalog-builder.mjs')).mtimeMs;
  const m3 = statSync(join(BACKEND_DIR, 'playbook-graphs.mjs')).mtimeMs;
  const key = `${m1}:${m2}:${m3}`;
  if (key === cachedCatalogKey && cachedCatalogData) {
    return cachedCatalogData;
  }
  const builderUrl = pathToFileURL(join(BACKEND_DIR, 'catalog-builder.mjs')).href;
  const mod = await import(`${builderUrl}?v=${m1}_${m2}_${m3}`);
  cachedCatalogData = mod.buildCatalog(DEFAULT_PLUGIN_ROOT);
  cachedCatalogKey = key;
  return cachedCatalogData;
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

function serveDiskAsset(absPath, contentType) {
  const body = readFileSync(absPath, 'utf-8');
  return new Response(body, {
    contentType,
    status: 200,
    headers: NO_STORE_HEADERS,
  });
}

function invokeAgentApiNewConversation({ message, title, model, projectId } = {}) {
  const text = String(message || '').trim();
  if (!text) {
    throw new Error('Message cannot be empty');
  }
  const env = { ...process.env };
  if (projectId) {
    env.ANTIGRAVITY_PROJECT_ID = String(projectId);
  }
  const args = ['new-conversation'];
  if (model) {
    args.push(`--model=${model}`);
  }
  if (title) {
    args.push(`--title=${title}`);
  }
  args.push(text);

  const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE;
  const file = exe || 'agentapi';
  const execArgs = exe ? ['agentapi', ...args] : args;

  const out = execFileSync(file, execArgs, {
    encoding: 'utf-8',
    env,
  });
  return out.trim() ? JSON.parse(out) : { ok: true };
}

const app = new SidecarApp();

app.page('/', () => serveDiskAsset(join(FRONTEND_DIR, 'index.html'), 'text/html; charset=utf-8'));
app.page('/styles.css', () => serveDiskAsset(join(FRONTEND_DIR, 'styles.css'), 'text/css; charset=utf-8'));
app.page('/app.js', () => new Response(buildClassicAppBundle(__dirname), {
  contentType: 'application/javascript; charset=utf-8',
  status: 200,
  headers: NO_STORE_HEADERS,
}));
app.page('/shared/prompt-composer.mjs', () =>
  serveDiskAsset(join(SHARED_DIR, 'prompt-composer.mjs'), 'application/javascript; charset=utf-8')
);
app.page('/shared/flowchart-svg.mjs', () =>
  serveDiskAsset(join(SHARED_DIR, 'flowchart-svg.mjs'), 'application/javascript; charset=utf-8')
);
app.page('/shared/markdown-wysiwyg.mjs', () =>
  serveDiskAsset(join(SHARED_DIR, 'markdown-wysiwyg.mjs'), 'application/javascript; charset=utf-8')
);

app.api('/api/catalog', () => getLiveCatalog(), 'GET');
app.api('/api/catalog', () => getLiveCatalog(), 'POST');

app.api('/api/health', (data) => {
  const workspaceUris = Array.isArray(data?.workspaceUris) ? data.workspaceUris : [];
  return checkWorkspaceHealth({ workspaceUris });
}, 'POST');

app.api('/api/source', (data) => {
  return readCatalogSourceFile(data?.relPath, DEFAULT_PLUGIN_ROOT);
}, 'POST');

app.api('/api/new-conversation', (data) => {
  return invokeAgentApiNewConversation({
    message: data?.message,
    title: data?.title,
    model: data?.model,
    projectId: data?.projectId,
  });
}, 'POST');

await app.run();
