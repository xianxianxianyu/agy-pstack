#!/usr/bin/env node
/**
 * @fileoverview Standalone HTTP server for pstack Studio preview & automated testing.
 *
 * Usage:
 *   node sidecars/studio/standalone.mjs [--port 8790] [--workspace /path/to/repo]
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, DEFAULT_PLUGIN_ROOT, readCatalogSourceFile } from './backend/catalog-builder.mjs';
import { buildClassicAppBundle } from './backend/bundle-frontend.mjs';
import { checkWorkspaceHealth } from './backend/workspace-health.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = join(__dirname, 'frontend');
const SHARED_DIR = join(__dirname, 'shared');

function buildStandalonePreloadJs(defaultWorkspaceUri) {
  return `
(function() {
  const wsList = ${JSON.stringify(defaultWorkspaceUri ? [defaultWorkspaceUri] : [])};
  const listeners = new Set();
  window.__standaloneDispatched = [];

  window.sidecar = {
    conversationId: 'standalone-preview-conv',
    isStandalonePreview: true,
    fetch(url, options = {}) {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      return fetch(url, { ...options, headers });
    },
    async getWorkspaceUris() {
      return [...wsList];
    },
    onWorkspaceChange(fn) {
      if (typeof fn === 'function') {
        listeners.add(fn);
        queueMicrotask(() => fn([...wsList]));
      }
      return () => listeners.delete(fn);
    },
    agent: {
      async sendMessage(message, convId) {
        const res = await fetch('/_sidecar/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: convId || 'standalone-preview-conv', message })
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        window.__standaloneDispatched.push({ action: 'sendMessage', message, json });
        return json;
      },
      async startConversation(message, title) {
        const res = await fetch('/api/new-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, title })
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        window.__standaloneDispatched.push({ action: 'startConversation', message, title, json });
        return json;
      },
      async getConversationMetadata() {
        return { response: { conversationMetadata: { metadata: { projectId: 'standalone-proj' } } } };
      }
    },
    ui: {
      toggleAuxPane() {},
      toggleConversation() {},
      addArtifactComment() {}
    }
  };
})();
`;
}

export function createStandaloneStudioServer({
  host = '127.0.0.1',
  port = 0,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  workspacePath = DEFAULT_PLUGIN_ROOT,
} = {}) {
  const dispatchedMessages = [];
  const defaultWsUri = workspacePath ? `file://${workspacePath}` : '';

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}`);
    const sendJson = (status, payload) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(payload));
    };
    const sendFile = (absPath, contentType) => {
      if (!existsSync(absPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(readFileSync(absPath, 'utf-8'));
    };

    if (req.method === 'GET') {
      if (url.pathname === '/') return sendFile(join(FRONTEND_DIR, 'index.html'), 'text/html; charset=utf-8');
      if (url.pathname === '/styles.css') return sendFile(join(FRONTEND_DIR, 'styles.css'), 'text/css; charset=utf-8');
      if (url.pathname === '/app.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end(buildClassicAppBundle(__dirname));
        return;
      }
      if (url.pathname === '/shared/prompt-composer.mjs') {
        return sendFile(join(SHARED_DIR, 'prompt-composer.mjs'), 'application/javascript; charset=utf-8');
      }
      if (url.pathname === '/shared/flowchart-svg.mjs') {
        return sendFile(join(SHARED_DIR, 'flowchart-svg.mjs'), 'application/javascript; charset=utf-8');
      }
      if (url.pathname === '/shared/markdown-wysiwyg.mjs') {
        return sendFile(join(SHARED_DIR, 'markdown-wysiwyg.mjs'), 'application/javascript; charset=utf-8');
      }
      if (url.pathname === '/preload.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(buildStandalonePreloadJs(defaultWsUri));
        return;
      }
      if (url.pathname === '/api/catalog') {
        return sendJson(200, buildCatalog(pluginRoot));
      }
      if (url.pathname === '/api/debug-dispatched') {
        return sendJson(200, { items: dispatchedMessages });
      }
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          if (url.pathname === '/api/catalog') {
            return sendJson(200, buildCatalog(pluginRoot));
          }
          if (url.pathname === '/api/health') {
            return sendJson(
              200,
              checkWorkspaceHealth({
                workspaceUris: Array.isArray(data.workspaceUris) ? data.workspaceUris : [],
                fallbackWorkspacePath: workspacePath,
              })
            );
          }
          if (url.pathname === '/api/source') {
            return sendJson(200, readCatalogSourceFile(data.relPath, pluginRoot));
          }
          if (url.pathname === '/_sidecar/send-message') {
            const entry = {
              mode: 'standalone-preview',
              action: 'send-message',
              conversationId: data.conversationId || 'standalone-preview-conv',
              message: data.message || '',
              at: new Date().toISOString(),
            };
            dispatchedMessages.push(entry);
            return sendJson(200, { ok: true, preview: true, entry });
          }
          if (url.pathname === '/api/new-conversation') {
            const entry = {
              mode: 'standalone-preview',
              action: 'new-conversation',
              conversationId: `preview-new-${dispatchedMessages.length + 1}`,
              title: data.title || '',
              message: data.message || '',
              at: new Date().toISOString(),
            };
            dispatchedMessages.push(entry);
            return sendJson(200, { ok: true, preview: true, conversationId: entry.conversationId, entry });
          }
          return sendJson(404, { error: 'Unknown API route' });
        } catch (err) {
          return sendJson(500, { error: err.message });
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return {
    server,
    dispatchedMessages,
    start() {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const addr = server.address();
          resolve({
            host,
            port: addr.port,
            url: `http://${host}:${addr.port}`,
          });
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function parseCliArgs(argv) {
  let port = 8790;
  let host = '127.0.0.1';
  let workspacePath = DEFAULT_PLUGIN_ROOT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      port = parseInt(argv[++i], 10);
    } else if (argv[i] === '--host' && argv[i + 1]) {
      host = argv[++i];
    } else if (argv[i] === '--workspace' && argv[i + 1]) {
      workspacePath = argv[++i];
    }
  }
  return { port, host, workspacePath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const opts = parseCliArgs(process.argv.slice(2));
  const instance = createStandaloneStudioServer(opts);
  const info = await instance.start();
  console.log(`[pstack-studio] Standalone preview listening at ${info.url}`);
  process.on('SIGINT', async () => {
    await instance.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await instance.stop();
    process.exit(0);
  });
}
