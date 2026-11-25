/**
 * @fileoverview Zero-dependency runtime classic-script bundler for pstack Studio.
 *
 * Antigravity's sidecar gateway proxies classic `<script src="/app.js">` cleanly
 * (matching built-in `swarm_board` and `usage-monitor`), whereas `<script type="module">`
 * sub-imports trigger strict CORS / token-less sub-requests that can fail inside
 * the host iframe.
 *
 * This helper concatenates the pure ESM `shared/*.mjs` modules and `frontend/app.js`
 * into one classic IIFE script on demand from disk, keeping both live disk refresh
 * and direct ESM unit testing in `node --test`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function stripEsmModuleSyntax(source) {
  return String(source || '')
    // Remove multi-line or single-line import statements targeting /shared/*.mjs
    .replace(/^import\s+[\s\S]*?\s+from\s+['"]\/shared\/[^'"]+['"];?\s*$/gm, '')
    // Strip leading `export ` keyword from declarations
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');
}

export function buildClassicAppBundle(studioDir) {
  const sharedDir = join(studioDir, 'shared');
  const frontendDir = join(studioDir, 'frontend');

  const files = [
    join(sharedDir, 'prompt-composer.mjs'),
    join(sharedDir, 'flowchart-svg.mjs'),
    join(sharedDir, 'markdown-wysiwyg.mjs'),
    join(frontendDir, 'app.js'),
  ];

  const chunks = files.map((filePath) => {
    const raw = readFileSync(filePath, 'utf-8');
    return stripEsmModuleSyntax(raw);
  });

  return `(function() {\n'use strict';\n${chunks.join('\n\n')}\n})();\n`;
}
