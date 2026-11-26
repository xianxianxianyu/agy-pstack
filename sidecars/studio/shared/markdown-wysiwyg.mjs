/**
 * @fileoverview Isomorphic Markdown <-> WYSIWYG HTML renderer, serializer,
 * and non-destructive directive patcher for pstack Studio.
 *
 * Allows users to edit the full prompt directly inside a WYSIWYG Markdown
 * `contenteditable` box while clicking constraints, skills, principles, or
 * flowchart mounts below updates only the structured header/directives
 * without wiping out custom user edits.
 */

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders inline Markdown (`**bold**`, `` `code` ``, `/slash-cmd`, `<placeholder>`)
 * into clean WYSIWYG HTML.
 */
export function renderInlineMarkdown(raw) {
  const text = String(raw || '');
  // Split out inline code spans first so inner chars aren't parsed as bold/placeholder
  const segments = text.split(/(`[^`]+`)/g);
  return segments
    .map((seg) => {
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
        return `<code class="md-code">${escHtml(seg.slice(1, -1))}</code>`;
      }
      let h = escHtml(seg);
      // **bold**
      h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Placeholder tokens like <在此填写...> or <Describe...>
      h = h.replace(
        /&lt;([^&]{3,80})&gt;/g,
        '<span class="md-placeholder">&lt;$1&gt;</span>'
      );
      // Leading or space-preceded /slash-commands (supports hyphens and underscores like /generative_ui)
      h = h.replace(
        /(^|\s)(\/[a-z][a-z0-9_-]*)(?=[\s，。、.,:：]|$)/g,
        '$1<span class="md-slash">$2</span>'
      );
      return h;
    })
    .join('');
}

/**
 * Renders a full Markdown prompt string into clean semantic WYSIWYG HTML.
 */
export function markdownToWysiwygHtml(markdown) {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (!inList) {
        out.push('<ul class="md-list">');
        inList = true;
      }
      out.push(`<li>${renderInlineMarkdown(bulletMatch[1])}</li>`);
      continue;
    }

    closeList();

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<p class="md-h${level}" data-md-heading="${level}">${renderInlineMarkdown(headingMatch[2])}</p>`);
      continue;
    }

    if (line.startsWith('当前阶段定位：') || line.startsWith('Current stage focus:')) {
      out.push(`<p class="md-p md-stage-focus">${renderInlineMarkdown(line)}</p>`);
      continue;
    }

    const goalMatch = line.match(/^(任务目标：|Goal:\s*)(.+)$/);
    if (goalMatch) {
      const prefix = escHtml(goalMatch[1]);
      const rawVal = goalMatch[2].trim();
      const isPlaceholder = /^<.+>$/.test(rawVal);
      const cls = isPlaceholder ? 'md-goal-slot md-placeholder' : 'md-goal-slot';
      out.push(`<p class="md-p">${prefix}<span class="${cls}">${escHtml(rawVal)}</span></p>`);
      continue;
    }

    if (i === 0 && !/^(?:\/[a-z0-9-]+\s+)*\/poteto-mode\b/.test(trimmed)) {
      const soloSkillMatch = line.match(
        /^((?:\/[a-z0-9-]+\s+)*\/[a-z][a-z0-9-]*(?:（技能定义见\s*`[^`]+`）|\s*\(read skill definition from `[^`]+`\))?\s+(?:【新任务】\s*|New task:\s*)?)(.+)$/
      );
      if (soloSkillMatch) {
        const prefixHtml = renderInlineMarkdown(soloSkillMatch[1]);
        const rawVal = soloSkillMatch[2].trim();
        const isPlaceholder = /^<.+>$/.test(rawVal);
        const cls = isPlaceholder ? 'md-goal-slot md-placeholder' : 'md-goal-slot';
        out.push(`<p class="md-p">${prefixHtml}<span class="${cls}">${escHtml(rawVal)}</span></p>`);
        continue;
      }
    }

    out.push(`<p class="md-p">${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  return out.length > 0 ? out.join('') : '<p class="md-p"><br></p>';
}

/**
 * Serializes a live `contenteditable` DOM element back into clean Markdown.
 */
export function serializeWysiwygElement(rootEl) {
  if (!rootEl) return '';

  const serializeInline = (node) => {
    if (!node) return '';
    if (node.nodeType === 3) {
      return (node.nodeValue || '').replace(/\u00a0/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toUpperCase();
    if (tag === 'BR') return '\n';
    const inner = [...node.childNodes].map(serializeInline).join('');
    if (tag === 'CODE') {
      const clean = inner.replace(/`/g, '');
      return clean ? `\`${clean}\`` : '';
    }
    if (tag === 'STRONG' || tag === 'B') {
      const clean = inner.trim();
      return clean ? `**${clean}**` : '';
    }
    return inner;
  };

  const blocks = [];

  const visitBlock = (node) => {
    if (node.nodeType === 3) {
      const t = (node.nodeValue || '').replace(/\u00a0/g, ' ').trim();
      if (t) blocks.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();

    if (tag === 'UL' || tag === 'OL') {
      const items = [];
      for (const child of node.children) {
        if (child.tagName.toUpperCase() === 'LI') {
          const txt = [...child.childNodes].map(serializeInline).join('').replace(/\n+/g, ' ').trim();
          if (txt) items.push(`- ${txt}`);
        }
      }
      if (items.length > 0) blocks.push(items.join('\n'));
      return;
    }

    if (tag === 'P' || tag === 'DIV' || /^H[1-6]$/.test(tag)) {
      const headingLevel = Number(node.getAttribute?.('data-md-heading') || 0);
      const txt = [...node.childNodes].map(serializeInline).join('').trim();
      if (!txt) return;
      if (headingLevel > 0) {
        blocks.push(`${'#'.repeat(headingLevel)} ${txt}`);
      } else {
        blocks.push(txt);
      }
      return;
    }

    const fallback = serializeInline(node).trim();
    if (fallback) blocks.push(fallback);
  };

  for (const child of rootEl.childNodes) {
    visitBlock(child);
  }

  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Known auto-generated directive line prefixes so we can cleanly replace ONLY
 * the managed directive bullets when options below change, while preserving
 * any custom text or custom bullets the user wrote directly in the WYSIWYG box.
 */
const AUTO_DIRECTIVE_PATTERNS = [
  /^- 显式联动技能\/工具：/,
  /^- Explicitly incorporate skills\/tools:/,
  /^- 重点贯彻以下工程原则/,
  /^- Apply principles and cite how each shaped your choices:/,
];

function isManagedConstraintLine(line, constraints) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- ')) return false;
  const body = trimmed.slice(2).trim();
  for (const c of constraints || []) {
    if (body === c.promptZh || body === c.promptEn) return true;
  }
  return false;
}

function isManagedHeaderLine(line) {
  const t = line.trim();
  return (
    /^(?:\/[a-z0-9_-]+\s+)*\/poteto-mode\b/.test(t) ||
    /^(?:\/[a-z0-9_-]+\s+)*\/[a-z][a-z0-9_-]*\b/.test(t)
  );
}

/**
 * Extracts the user's typed goal text (the blue `.md-goal-slot` content) from a
 * Markdown prompt, returning `''` if only the default `<...>` placeholder exists.
 */
export function extractUserGoalFromMarkdown(markdown) {
  const normalized = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const goalMatch = line.match(/^(?:任务目标：|Goal:\s*)(.+)$/);
    if (goalMatch) {
      const val = goalMatch[1].trim();
      return /^<.+>$/.test(val) ? '' : val;
    }
    if (i === 0 && !/^(?:\/[a-z0-9-]+\s+)*\/poteto-mode\b/.test(line)) {
      const soloSkillMatch = line.match(
        /^(?:\/[a-z0-9-]+\s+)*\/[a-z][a-z0-9-]*(?:（技能定义见\s*`[^`]+`）|\s*\(read skill definition from `[^`]+`\))?\s+(?:【新任务】\s*|New task:\s*)?(.+)$/
      );
      if (soloSkillMatch) {
        const val = soloSkillMatch[1].trim();
        return /^<.+>$/.test(val) ? '' : val;
      }
    }
  }
  return '';
}

/**
 * Merges a freshly composed Markdown prompt (reflecting updated pills/options)
 * with the user's current Markdown text in the WYSIWYG editor, preserving the
 * user's custom goal/body edits while updating the leading slash header,
 * optional `验收标准 / Done check` line, and managed directive bullets.
 */
export function syncComposedIntoUserMarkdown({
  currentMarkdown,
  freshComposedMarkdown,
  primaryType,
  constraints = [],
}) {
  const cur = String(currentMarkdown || '').replace(/\r\n/g, '\n').trim();
  const fresh = String(freshComposedMarkdown || '').replace(/\r\n/g, '\n').trim();
  if (!cur) return fresh;

  const freshLines = fresh.split('\n');
  const freshHeader = freshLines[0] || '';
  const freshFocusLine = freshLines.find(
    (l) => l.startsWith('当前阶段定位：') || l.startsWith('Current stage focus:')
  );
  const freshDoneLine = freshLines.find(
    (l) => l.startsWith('验收标准（Done Check）：') || l.startsWith('Done check:')
  );
  const freshDirectives = freshLines.filter(
    (l) =>
      AUTO_DIRECTIVE_PATTERNS.some((re) => re.test(l.trim())) ||
      isManagedConstraintLine(l, constraints)
  );

  // Separate user's current markdown into: header, user custom body lines, and drop old auto directives
  const curLines = cur.split('\n');
  const keptBodyLines = [];
  let replacedHeader = false;

  for (let i = 0; i < curLines.length; i++) {
    const line = curLines[i];
    const trimmed = line.trim();

    // Replace line 0 header if it's a managed slash header
    if (i === 0 && isManagedHeaderLine(trimmed)) {
      if (primaryType === 'skill') {
        const restMatch = trimmed.match(/^(?:\/[a-z0-9-]+\s+)*(?:【新任务】\s*|New task:\s*)?(.*)$/);
        const userTail = restMatch ? restMatch[1].trim() : '';
        const freshPrefixMatch = freshHeader.match(/^((?:\/[a-z0-9-]+\s+)*(?:【新任务】\s*|New task:\s*)?)/);
        const freshPrefix = freshPrefixMatch ? freshPrefixMatch[1].trim() : freshHeader;
        if (userTail && !/^<.+>$/.test(userTail)) {
          keptBodyLines.push(`${freshPrefix} ${userTail}`.trim());
        } else {
          keptBodyLines.push(freshHeader);
        }
      } else {
        keptBodyLines.push(freshHeader);
        if (freshFocusLine) {
          keptBodyLines.push('');
          keptBodyLines.push(freshFocusLine);
        }
      }
      replacedHeader = true;
      continue;
    }

    // Drop previous stage-focus line so it gets cleanly replaced or removed
    if (trimmed.startsWith('当前阶段定位：') || trimmed.startsWith('Current stage focus:')) {
      continue;
    }

    // Drop old auto-generated directive bullets (they will be re-appended cleanly from freshDirectives)
    if (
      AUTO_DIRECTIVE_PATTERNS.some((re) => re.test(trimmed)) ||
      isManagedConstraintLine(trimmed, constraints)
    ) {
      continue;
    }

    // Update Done Check line if controlled by the doneCheck input
    if (
      trimmed.startsWith('验收标准（Done Check）：') ||
      trimmed.startsWith('Done check:')
    ) {
      continue;
    }

    keptBodyLines.push(line);
  }

  // Collapse trailing empty lines from keptBodyLines
  while (keptBodyLines.length > 0 && !keptBodyLines[keptBodyLines.length - 1].trim()) {
    keptBodyLines.pop();
  }

  if (!replacedHeader) {
    keptBodyLines.unshift('');
    keptBodyLines.unshift(freshHeader);
  }

  if (freshDoneLine) {
    keptBodyLines.push(freshDoneLine);
  }

  if (freshDirectives.length > 0) {
    keptBodyLines.push('');
    keptBodyLines.push(...freshDirectives);
  }

  return keptBodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
