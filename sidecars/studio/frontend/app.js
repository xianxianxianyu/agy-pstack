/**
 * @fileoverview pstack Studio v2 Frontend — Minimalist Master–Detail Workspace.
 *
 * Zero emojis, zero badge soup, region-scoped DOM updates (preserving Chinese
 * IME composition and cursor focus), two-column Master–Detail on >=680px and
 * clean drill-down on narrow Auxiliary Side Panes (<680px).
 */

import { composePrompt } from '/shared/prompt-composer.mjs';
import { renderFlowchartSvg, toMermaidCode } from '/shared/flowchart-svg.mjs';
import {
  markdownToWysiwygHtml,
  serializeWysiwygElement,
  syncComposedIntoUserMarkdown,
} from '/shared/markdown-wysiwyg.mjs';

const ZERO_ARG_SKILLS = new Set([
  'ketchup',
  'ketchup-video',
  'bro',
  'setup-pstack',
  'create-verification-skill',
  'maintain-verification-skill',
  'maintain-formal-verification-skill',
]);

const LAUNCH_MODES = [
  {
    id: 'send-current',
    label: '发送到当前对话',
    menuTitle: '直接发送到当前对话',
    desc: '立即发给当前对话执行（不经过输入框）',
  },
  {
    id: 'copy-to-chat',
    label: '复制到剪贴板',
    menuTitle: '复制到剪贴板',
    desc: '复制到剪贴板，去输入框 Ctrl/⌘+V 粘贴后可继续 @文件 或微调',
  },
  {
    id: 'send-new-conv',
    label: '新开对话执行',
    menuTitle: '新开对话执行',
    desc: '在当前项目新建独立对话并直接开始',
  },
];

function loadSavedLaunchMode() {
  try {
    const saved = window.localStorage?.getItem('pstack_studio_launch_mode');
    if (LAUNCH_MODES.some((m) => m.id === saved)) return saved;
  } catch {
    // Ignore restricted storage
  }
  return 'send-current';
}

const state = {
  catalog: null,
  health: null,
  resolvedProjectId: '',
  themeMode: 'auto', // 'auto' | 'light' | 'dark'
  envPopoverOpen: false,

  // Master list state
  sidebarTab: 'presets', // 'presets' | 'playbooks' | 'skills' | 'principles'
  searchQuery: '',
  selectedNavKey: 'preset:scientific-bug-fix',
  viewingPrincipleId: null,
  mobileDetailOpen: false,

  // Composer state (WYSIWYG Markdown top + all option groups expanded below)
  customizeOpen: true,
  showAllShelfSkills: true,
  showAllShelfPrinciples: true,
  launchMode: loadSavedLaunchMode(),
  launchMenuOpen: false,
  lang: 'zh', // 'zh' | 'en'

  primary: { type: 'playbook', id: 'bug-fix' },
  activeNodeId: null,
  addonSkills: ['tdd'],
  principles: ['principle-fix-root-causes', 'principle-prove-it-works'],
  constraints: ['repro-first', 'real-proof'],
  nativeModifiers: [],
  goal: '',
  doneCheck: '',
  goalPlaceholder: '描述具体缺陷现象、触发路径或异常日志…',
  doneCheckPlaceholder: '原复现路径验证通过，关联流程无回归',
  markdownDoc: '',
  lastEmptyWarnAt: 0,
  sending: false,

  // Source Markdown / Flowchart Lightbox Modal
  canvasZoom: 100, // 75..140
  modal: null, // { kind: 'source'|'flowchart', title?, relPath?, content?, loading?, graph? }
};

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function apiFetch(url, options = {}) {
  if (window.sidecar?.fetch) {
    return window.sidecar.fetch(url, options);
  }
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...options, headers });
}

let toastTimer = null;
function showToast(msg, durationMs = 2600) {
  const el = document.getElementById('toast-el');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
}

function isDarkCssColor(raw) {
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  }
  const rgb = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return 0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3]) < 128;
  }
  return false;
}

function applyThemeAttr() {
  const root = document.documentElement;
  if (state.themeMode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (state.themeMode === 'light') {
    root.removeAttribute('data-theme');
  } else {
    const bg = getComputedStyle(root).getPropertyValue('--background').trim();
    if (bg && isDarkCssColor(bg)) {
      root.setAttribute('data-theme', 'dark');
    } else if (!bg && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }
}

function getComposed() {
  if (!state.catalog) {
    return { prompt: '', titleSuggestion: 'pstack', hasPlaceholder: true, hostOnlySlashes: [] };
  }
  return composePrompt(state, state.catalog);
}

function getEffectivePrompt() {
  const editorEl = document.getElementById('wysiwyg-editor');
  if (editorEl) {
    state.markdownDoc = serializeWysiwygElement(editorEl);
  }
  return (state.markdownDoc || getComposed().prompt).trim();
}

function resetMarkdownFromState() {
  state.markdownDoc = getComposed().prompt;
}

function syncMarkdownFromOptions({ flash = true } = {}) {
  const editorEl = document.getElementById('wysiwyg-editor');
  if (editorEl) {
    state.markdownDoc = serializeWysiwygElement(editorEl);
  }
  const fresh = getComposed().prompt;
  state.markdownDoc = syncComposedIntoUserMarkdown({
    currentMarkdown: state.markdownDoc,
    freshComposedMarkdown: fresh,
    primaryType: state.primary.type,
    constraints: state.catalog?.constraints || [],
  });

  if (flash) {
    requestAnimationFrame(() => {
      const el = document.getElementById('wysiwyg-editor');
      if (el) {
        el.classList.remove('sync-flash');
        void el.offsetWidth;
        el.classList.add('sync-flash');
      }
    });
  }
}

function findPlaybook(id) {
  return state.catalog?.playbooks.find((p) => p.id === id) || null;
}

function findSkill(id) {
  return state.catalog?.skills.find((s) => s.id === id) || null;
}

function findPrinciple(id) {
  return state.catalog?.principles.find((p) => p.id === id) || null;
}

function findScenarioTitle(scId) {
  return state.catalog?.scenarios.find((s) => s.id === scId)?.titleZh || '';
}

// ---------------------------------------------------------------------------
// Shell Mount
// ---------------------------------------------------------------------------

function mountShell() {
  const root = document.getElementById('studio-root');
  root.innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        <span class="brand">pstack</span>
      </div>

      <div class="topbar-right">
        <div class="search-wrap">
          <svg class="search-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="7" cy="7" r="4.8"></circle>
            <path d="M10.6 10.6L14 14" stroke-linecap="round"></path>
          </svg>
          <input
            id="global-search"
            type="text"
            class="search-input"
            placeholder="搜索功能、Playbook 或 /命令…"
            autocomplete="off"
          />
          <span id="search-kbd" class="search-kbd">⌘K</span>
          <button id="search-clear" type="button" class="search-clear hidden" data-action="clear-search">清空</button>
        </div>
        <button id="theme-btn" type="button" class="quiet-icon-btn" data-action="cycle-theme" title="切换外观主题">自动</button>
      </div>
    </header>

    <div id="workspace-grid" class="workspace">
      <aside class="sidebar">
        <div id="sidebar-tabs" class="sidebar-tabs" role="tablist"></div>
        <div id="sidebar-list" class="nav-list"></div>
      </aside>

      <main id="stage-scroll" class="stage">
        <div id="stage-region" class="stage-inner"></div>
      </main>
    </div>

    <div id="modal-region"></div>
    <div id="toast-el" class="toast hidden"></div>
  `;

  const searchEl = document.getElementById('global-search');
  searchEl.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    const hasQ = Boolean(state.searchQuery.trim());
    document.getElementById('search-kbd')?.classList.toggle('hidden', hasQ);
    document.getElementById('search-clear')?.classList.toggle('hidden', !hasQ);
    if (hasQ && window.innerWidth < 680) {
      state.mobileDetailOpen = false;
      syncMobileClass();
    }
    renderSidebarList();
  });

  root.addEventListener('click', handleDelegatedClick);
  window.addEventListener('keydown', handleGlobalKeydown);
}

function syncMobileClass() {
  document.getElementById('workspace-grid')?.classList.toggle('mobile-detail', state.mobileDetailOpen);
}

function renderAll() {
  renderThemeButton();
  renderEnvRegion();
  renderSidebarTabs();
  renderSidebarList();
  renderStageRegion();
  renderModalRegion();
  syncMobileClass();
}

function renderThemeButton() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const map = { auto: '主题: 自动', light: '主题: 浅色', dark: '主题: 深色' };
  btn.textContent = map[state.themeMode] || '主题: 自动';
}

function renderEnvRegion() {
  const el = document.getElementById('env-region');
  if (!el) return;
  const s = state.health?.summary;
  if (!s) {
    el.innerHTML = '';
    return;
  }

  const allReady = s.hasModelsRule && (s.hasVerifySkill || !s.hasWorkspace);
  const label = !s.hasModelsRule
    ? '未配置模型'
    : !s.hasVerifySkill && s.hasWorkspace
      ? '缺实测技能'
      : s.workspaceName || '环境就绪';

  el.innerHTML = `
    <button type="button" class="env-btn" data-action="toggle-env-popover">
      <span class="status-dot ${allReady ? '' : 'warn'}"></span>
      <span>${esc(label)}</span>
    </button>
    ${
      state.envPopoverOpen
        ? `
      <div class="env-popover">
        <div class="env-row">
          <span class="env-label">模型配置</span>
          ${
            s.hasModelsRule
              ? `<span>${esc(s.modelsBudget || '已就绪')}</span>`
              : `<button type="button" class="vs-jump-btn" data-action="select-skill" data-id="setup-pstack">去初始化 →</button>`
          }
        </div>
        <div class="env-row">
          <span class="env-label">项目实测技能</span>
          ${
            s.hasVerifySkill
              ? `<span>${esc(s.verifySkills.join(', '))}</span>`
              : `<button type="button" class="vs-jump-btn" data-action="select-skill" data-id="create-verification-skill">一键生成 →</button>`
          }
        </div>
        ${
          s.workspaceName
            ? `
          <div class="env-row">
            <span class="env-label">当前仓库</span>
            <span>${esc(s.workspaceName)}${s.gitHost === 'gitlab' ? ' (GitLab)' : ''}</span>
          </div>
        `
            : ''
        }
        <div style="border-top:1px solid var(--ps-line);padding-top:6px;display:flex;justify-content:space-between;">
          <button type="button" class="vs-jump-btn" data-action="select-skill" data-id="setup-pstack">调整模型档位</button>
          ${
            s.hasVerifySkill
              ? `<button type="button" class="vs-jump-btn" data-action="select-skill" data-id="maintain-verification-skill">同步实测技能</button>`
              : ''
          }
        </div>
      </div>
    `
        : ''
    }
  `;
}

// ---------------------------------------------------------------------------
// Left Sidebar Rendering
// ---------------------------------------------------------------------------

function renderSidebarTabs() {
  const el = document.getElementById('sidebar-tabs');
  if (!el) return;
  const tabs = [
    { id: 'presets', label: '常用' },
    { id: 'playbooks', label: '流程 (22)' },
    { id: 'skills', label: '技能 (33)' },
    { id: 'principles', label: '原则 (24)' },
  ];
  el.innerHTML = tabs
    .map(
      (t) => `
      <button
        type="button"
        class="s-tab ${state.sidebarTab === t.id && !state.searchQuery.trim() ? 'active' : ''}"
        data-action="switch-sidebar-tab"
        data-tab="${t.id}"
      >${esc(t.label)}</button>
    `
    )
    .join('');
}

function renderSidebarList() {
  const el = document.getElementById('sidebar-list');
  if (!el || !state.catalog) return;

  const q = state.searchQuery.trim().toLowerCase();
  if (q) {
    el.innerHTML = renderSearchSidebarList(q);
    return;
  }

  if (state.sidebarTab === 'presets') {
    el.innerHTML = renderGroupedPresets();
  } else if (state.sidebarTab === 'playbooks') {
    el.innerHTML = renderGroupedPlaybooks();
  } else if (state.sidebarTab === 'skills') {
    el.innerHTML = renderGroupedSkills();
  } else {
    el.innerHTML = renderGroupedPrinciples();
  }
}

function renderNavRow({ navKey, action, id, title, enLabel, active }) {
  return `
    <button
      type="button"
      class="nav-item ${active ? 'active' : ''}"
      data-action="${action}"
      data-id="${esc(id)}"
      data-nav-key="${esc(navKey)}"
    >
      <div class="nav-item-top">
        <span class="nav-item-title">${esc(title)}</span>
        <span class="nav-item-en">${esc(enLabel)}</span>
      </div>
    </button>
  `;
}

function renderGroupedPresets() {
  const cat = state.catalog;
  const order = ['debug', 'build', 'understand', 'verify', 'design', 'autopilot'];
  const chunks = [];
  for (const scId of order) {
    const items = cat.recipes.filter((r) => r.scenario === scId);
    if (items.length === 0) continue;
    chunks.push(`<div class="group-heading">${esc(findScenarioTitle(scId))}</div>`);
    for (const r of items) {
      const enLabel = r.titleEn || (r.primary.type === 'playbook' ? r.primary.id : `/${r.primary.id}`);
      const navKey = `preset:${r.id}`;
      chunks.push(
        renderNavRow({
          navKey,
          action: 'select-preset',
          id: r.id,
          title: r.title,
          enLabel,
          active: state.selectedNavKey === navKey && !state.viewingPrincipleId,
        })
      );
    }
  }
  return chunks.join('');
}

function renderGroupedPlaybooks() {
  const cat = state.catalog;
  const order = ['debug', 'build', 'understand', 'design', 'verify', 'autopilot'];
  const chunks = [];
  for (const scId of order) {
    const items = cat.playbooks.filter((p) => p.scenario === scId);
    if (items.length === 0) continue;
    chunks.push(`<div class="group-heading">${esc(findScenarioTitle(scId))}</div>`);
    for (const pb of items) {
      const navKey = `playbook:${pb.id}`;
      const isSelected =
        !state.viewingPrincipleId &&
        (state.selectedNavKey === navKey ||
          (state.primary.type === 'playbook' && state.primary.id === pb.id && state.sidebarTab === 'playbooks'));
      chunks.push(
        renderNavRow({
          navKey,
          action: 'select-playbook',
          id: pb.id,
          title: pb.titleZh,
          enLabel: pb.titleEn || pb.id,
          active: isSelected,
        })
      );
    }
  }
  return chunks.join('');
}

function renderGroupedSkills() {
  const cat = state.catalog;
  const order = ['understand', 'design', 'debug', 'build', 'verify', 'autopilot'];
  const chunks = [];
  for (const scId of order) {
    const items = cat.skills.filter((s) => s.scenario === scId);
    if (items.length === 0) continue;
    chunks.push(`<div class="group-heading">${esc(findScenarioTitle(scId))}</div>`);
    for (const sk of items) {
      const navKey = `skill:${sk.id}`;
      const isSelected =
        !state.viewingPrincipleId &&
        (state.selectedNavKey === navKey ||
          (state.primary.type === 'skill' && state.primary.id === sk.id && state.sidebarTab === 'skills'));
      chunks.push(
        renderNavRow({
          navKey,
          action: 'select-skill',
          id: sk.id,
          title: sk.titleZh,
          enLabel: sk.slash,
          active: isSelected,
        })
      );
    }
  }
  return chunks.join('');
}

function renderGroupedPrinciples() {
  const groups = [
    { id: 'core', label: '核心原则 Core' },
    { id: 'architecture', label: '架构原则 Architecture' },
    { id: 'verification', label: '验证原则 Verification' },
    { id: 'delegation', label: '协同原则 Delegation' },
    { id: 'meta', label: '元原则 Meta' },
  ];
  const chunks = [];
  for (const g of groups) {
    const items = state.catalog.principles.filter((p) => p.group === g.id);
    if (items.length === 0) continue;
    chunks.push(`<div class="group-heading">${esc(g.label)}</div>`);
    for (const pr of items) {
      const pinned = state.principles.includes(pr.id);
      chunks.push(
        renderNavRow({
          navKey: `principle:${pr.id}`,
          action: 'inspect-principle',
          id: pr.id,
          title: `${pinned ? '✓ ' : ''}${pr.titleZh}`,
          enLabel: pr.titleEn || pr.shortSlug,
          active: state.viewingPrincipleId === pr.id,
        })
      );
    }
  }
  return chunks.join('');
}

function renderSearchSidebarList(q) {
  const cat = state.catalog;
  const hit = (...vals) => vals.some((v) => String(v || '').toLowerCase().includes(q));

  const playbooks = cat.playbooks.filter((p) =>
    hit(p.id, p.titleZh, p.titleEn, p.shortDesc, p.whenToUse, p.builtinSkills.join(' '))
  );
  const skills = cat.skills.filter((s) =>
    hit(s.id, s.slash, s.titleZh, s.titleEn, s.shortDesc, s.whenToUse, s.roleTag)
  );
  const principles = cat.principles.filter((p) =>
    hit(p.id, p.shortSlug, p.titleZh, p.titleEn, p.summary)
  );

  if (playbooks.length + skills.length + principles.length === 0) {
    return `<div class="empty-list">没有匹配「${esc(state.searchQuery)}」的条目</div>`;
  }

  const out = [];
  if (playbooks.length > 0) {
    out.push(`<div class="group-heading">流程 Playbooks (${playbooks.length})</div>`);
    for (const pb of playbooks) {
      out.push(
        renderNavRow({
          navKey: `playbook:${pb.id}`,
          action: 'select-playbook',
          id: pb.id,
          title: pb.titleZh,
          enLabel: pb.titleEn || pb.id,
          active: !state.viewingPrincipleId && state.primary.type === 'playbook' && state.primary.id === pb.id,
        })
      );
    }
  }
  if (skills.length > 0) {
    out.push(`<div class="group-heading">技能 Skills (${skills.length})</div>`);
    for (const sk of skills) {
      out.push(
        renderNavRow({
          navKey: `skill:${sk.id}`,
          action: 'select-skill',
          id: sk.id,
          title: sk.titleZh,
          enLabel: sk.slash,
          active: !state.viewingPrincipleId && state.primary.type === 'skill' && state.primary.id === sk.id,
        })
      );
    }
  }
  if (principles.length > 0) {
    out.push(`<div class="group-heading">原则 Principles (${principles.length})</div>`);
    for (const pr of principles) {
      const pinned = state.principles.includes(pr.id);
      out.push(
        renderNavRow({
          navKey: `principle:${pr.id}`,
          action: 'inspect-principle',
          id: pr.id,
          title: `${pinned ? '✓ ' : ''}${pr.titleZh}`,
          enLabel: pr.titleEn || pr.shortSlug,
          active: state.viewingPrincipleId === pr.id,
        })
      );
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Right Stage Rendering (Header + Visual Pipeline + Direct Composer)
// ---------------------------------------------------------------------------

function renderStageRegion() {
  const el = document.getElementById('stage-region');
  if (!el || !state.catalog) return;

  if (state.viewingPrincipleId) {
    const pr = findPrinciple(state.viewingPrincipleId);
    if (pr) {
      el.innerHTML = renderPrincipleStage(pr) + renderComposerBlock();
      bindComposerInputs();
      return;
    }
  }

  if (state.primary.type === 'playbook') {
    const pb = findPlaybook(state.primary.id) || state.catalog.playbooks[0];
    el.innerHTML = renderPlaybookStage(pb) + renderComposerBlock();
  } else {
    const sk = findSkill(state.primary.id) || state.catalog.skills[0];
    el.innerHTML = renderSkillStage(sk) + renderComposerBlock();
  }

  bindComposerInputs();
}

function renderVsHintBar(vsHint) {
  if (!vsHint) return '';
  return `
    <div class="vs-callout">
      <span>${esc(vsHint.text)}</span>
      <button
        type="button"
        class="vs-jump-btn"
        data-action="follow-vs-hint"
        data-target-type="${esc(vsHint.targetType)}"
        data-target-id="${esc(vsHint.targetId)}"
      >${esc(vsHint.targetLabel)} →</button>
    </div>
  `;
}

function getActiveMountTokenSet() {
  const set = new Set();
  for (const sk of state.addonSkills) set.add(`/${sk}`);
  for (const nm of state.nativeModifiers) set.add(`/${nm}`);
  for (const pr of state.principles) set.add(pr.replace(/^principle-/, ''));
  return set;
}

function findGraphNode(pb, nodeId) {
  if (!pb?.graph || !nodeId) return null;
  for (const row of pb.graph.rows || []) {
    for (const n of row) {
      if (n.id === nodeId) return n;
    }
  }
  return null;
}

function renderPlaybookStage(pb) {
  const scTitle = findScenarioTitle(pb.scenario);
  const activeTokens = getActiveMountTokenSet();
  const hasGraph = Boolean(pb.graph && Array.isArray(pb.graph.rows));
  const focusedNode = hasGraph ? findGraphNode(pb, state.activeNodeId) : null;
  const svgHtml = hasGraph
    ? renderFlowchartSvg(pb.graph, { activeTokens, activeNodeId: state.activeNodeId })
    : '';

  return `
    <button type="button" class="mobile-back-btn" data-action="mobile-back">← 返回目录</button>

    <section class="stage-header">
      <div class="stage-kicker-row">
        <span class="stage-kicker">Playbook 流程 · ${esc(scTitle)} · ${esc(pb.intensityLabel)}</span>
        <button type="button" class="text-link" data-action="open-source" data-path="${esc(pb.relPath)}">查看原文</button>
      </div>
      <div class="stage-title-row">
        <h1 class="stage-title">${esc(pb.titleZh)}</h1>
        <span class="stage-en-name">${esc(pb.titleEn)}</span>
        <span class="stage-slug">${esc(pb.id)}</span>
      </div>
      <p class="stage-summary">${esc(pb.whenToUse)}</p>
      ${renderVsHintBar(pb.vsHint)}
    </section>

    <section class="fc-canvas-block">
      <div class="fc-canvas-surface">
        <div class="fc-floating-bar">
          <div class="fc-toolbar-left">
            <span class="block-label">执行流程图</span>
            ${
              focusedNode
                ? `
              <span class="fc-focus-pill">
                <span>定位节点: ${esc(focusedNode.label)}</span>
                <button type="button" class="fc-focus-clear" data-action="clear-graph-node" title="取消节点定位，恢复完整流程">×</button>
              </span>
            `
                : pb.graph?.topologyLabel
                  ? `<span class="fc-topology-tag">${esc(pb.graph.topologyLabel)} · 点击任意节点可定位执行</span>`
                  : ''
            }
          </div>
          ${
            hasGraph
              ? `
            <div class="fc-toolbar-actions">
              <div class="fc-zoom-group" aria-label="画布缩放">
                <button type="button" class="fc-zoom-btn" data-action="zoom-canvas" data-delta="-10" title="缩小">−</button>
                <button type="button" class="fc-zoom-btn fc-zoom-val" data-action="zoom-canvas" data-reset="1" title="重置为适应宽度">${state.canvasZoom}%</button>
                <button type="button" class="fc-zoom-btn" data-action="zoom-canvas" data-delta="10" title="放大">+</button>
              </div>
              <button type="button" class="text-link" data-action="copy-mermaid" data-id="${esc(pb.id)}">复制 Mermaid</button>
              <button type="button" class="text-link" data-action="open-flowchart-modal" data-id="${esc(pb.id)}">全屏</button>
            </div>
          `
              : ''
          }
        </div>

        ${
          hasGraph
            ? `
          <div class="fc-canvas-scroll">
            <div class="fc-svg-stage" style="width:${state.canvasZoom}%;">${svgHtml}</div>
          </div>
        `
            : ''
        }
      </div>

      <div class="fc-deliverable-note">
        <strong>交付结果：</strong>${esc(pb.deliverable)}
      </div>
    </section>
  `;
}

function renderStepMountPill(mountToken) {
  // Interactive if workflow skill (/xxx), native modifier (/browser, /swarm, /goal), or principle shortSlug
  if (mountToken.startsWith('/')) {
    const slug = mountToken.slice(1);
    if (findSkill(slug)) {
      const pinned = state.addonSkills.includes(slug);
      return `<button type="button" class="mount-pill ${pinned ? 'pinned' : ''}" data-action="toggle-addon-skill" data-id="${esc(slug)}" title="点击在本次指令中强制点名 ${esc(mountToken)}">${pinned ? '✓ ' : ''}${esc(mountToken)}</button>`;
    }
    const nativeMatch = state.catalog.nativeModifiers.find((n) => n.id === slug);
    if (nativeMatch) {
      const on = state.nativeModifiers.includes(slug);
      return `<button type="button" class="mount-pill ${on ? 'pinned' : ''}" data-action="toggle-native" data-id="${esc(slug)}" title="点击开关 ${esc(mountToken)}">${on ? '✓ ' : ''}${esc(mountToken)}</button>`;
    }
  }
  const fullPrinId = `principle-${mountToken}`;
  if (findPrinciple(fullPrinId)) {
    const pinned = state.principles.includes(fullPrinId);
    return `<button type="button" class="mount-pill ${pinned ? 'pinned' : ''}" data-action="toggle-principle" data-id="${esc(fullPrinId)}" title="点击强化该原则">${pinned ? '✓ ' : ''}${esc(mountToken)}</button>`;
  }
  return `<span class="mount-pill" title="子代理自动调度">${esc(mountToken)}</span>`;
}

function renderSkillStage(sk) {
  const scTitle = findScenarioTitle(sk.scenario);
  const relatedCloseCall = state.catalog.closeCalls.find((cc) =>
    cc.items.some((it) => it.ref === sk.slash)
  );

  const pairs = (sk.recommendedPairs || []).map((id) => findSkill(id)).filter(Boolean);

  return `
    <button type="button" class="mobile-back-btn" data-action="mobile-back">← 返回目录</button>

    <section class="stage-header">
      <div class="stage-kicker-row">
        <span class="stage-kicker">独立技能 · ${esc(scTitle)} · ${esc(sk.roleTag)}</span>
        <button type="button" class="text-link" data-action="open-source" data-path="${esc(sk.relPath)}">查看原文</button>
      </div>
      <div class="stage-title-row">
        <h1 class="stage-title">${esc(sk.titleZh)}</h1>
        <span class="stage-en-name">${esc(sk.titleEn)}</span>
        <span class="stage-slug">${esc(sk.slash)}</span>
      </div>
      <p class="stage-summary">${esc(sk.whenToUse)}</p>
      ${renderVsHintBar(sk.vsHint)}
    </section>

    ${
      pairs.length > 0 || relatedCloseCall
        ? `
      <section class="flow-section">
        ${
          pairs.length > 0
            ? `
          <div class="pair-row">
            <span class="block-label" style="margin-right:4px;">常搭配一起跑：</span>
            ${pairs
              .map((p) => {
                const on = state.addonSkills.includes(p.id);
                return `
                <button
                  type="button"
                  class="opt-pill ${on ? 'on' : ''}"
                  data-action="toggle-addon-skill"
                  data-id="${esc(p.id)}"
                >${on ? '✓ 已搭配 ' : '+ 搭配 '}${esc(p.slash)}（${esc(p.titleZh)}）</button>
              `;
              })
              .join('')}
          </div>
        `
            : ''
        }

        ${
          relatedCloseCall
            ? `
          <div style="${pairs.length > 0 ? 'border-top:1px solid var(--ps-line);padding-top:12px;' : ''}display:flex;flex-direction:column;gap:6px;">
            <div class="block-label">相近命令怎么选（${esc(relatedCloseCall.title)}）</div>
            ${relatedCloseCall.items
              .map((it) => {
                const isSelf = it.ref === sk.slash;
                return `
                <div style="display:flex;gap:10px;font-size:12.5px;align-items:baseline;">
                  <button
                    type="button"
                    class="vs-jump-btn"
                    style="font-family:var(--ps-mono);min-width:130px;text-align:left;${isSelf ? 'color:var(--ps-fg);text-decoration:none;cursor:default;' : ''}"
                    ${isSelf ? '' : `data-action="jump-ref" data-ref="${esc(it.ref)}"`}
                  >${esc(it.ref)}${isSelf ? ' (当前)' : ''}</button>
                  <span style="color:var(--ps-muted);">${esc(it.diff)}</span>
                </div>
              `;
              })
              .join('')}
          </div>
        `
            : ''
        }
      </section>
    `
        : ''
    }
  `;
}

function renderPrincipleStage(pr) {
  const pinned = state.principles.includes(pr.id);
  const currentOwnerLabel =
    state.primary.type === 'playbook'
      ? `Playbook: ${findPlaybook(state.primary.id)?.titleZh || state.primary.id}`
      : `技能: /${state.primary.id}`;

  return `
    <button type="button" class="mobile-back-btn" data-action="mobile-back">← 返回目录</button>

    <section class="stage-header">
      <div class="stage-kicker-row">
        <span class="stage-kicker">工程原则 · ${esc(pr.groupLabel)}</span>
        <button type="button" class="text-link" data-action="open-source" data-path="${esc(pr.relPath)}">查看原文</button>
      </div>
      <div class="stage-title-row">
        <h1 class="stage-title">${esc(pr.titleZh)}</h1>
        <span class="stage-en-name">${esc(pr.titleEn)}</span>
        <span class="stage-slug">${esc(pr.shortSlug)}</span>
      </div>
      <p class="stage-summary">${esc(pr.summary)}</p>
    </section>

    <section class="flow-section">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <span style="font-size:13px;color:var(--ps-fg-2);">
          当前准备发送的主流程为 <strong>${esc(currentOwnerLabel)}</strong>，可将此原则作为硬性护栏附加进去：
        </span>
        <button
          type="button"
          class="btn ${pinned ? 'btn-primary' : 'btn-secondary'}"
          data-action="toggle-principle"
          data-id="${esc(pr.id)}"
        >${pinned ? '✓ 已加入当前指令护栏' : '+ 加入当前指令护栏'}</button>
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// Direct Integrated Composer Block
// ---------------------------------------------------------------------------

function renderComposerBlock() {
  const composed = getComposed();
  if (!state.markdownDoc) {
    state.markdownDoc = composed.prompt;
  }

  return `
    <section class="composer-card" id="composer-card">
      <div class="wysiwyg-topbar">
        <span class="wysiwyg-title">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M11.3 2.5a1.5 1.5 0 0 1 2.1 2.1L5.6 12.4 2.5 13.5l1.1-3.1 7.7-7.9Z" stroke-linejoin="round"></path>
          </svg>
          <span>编辑发送指令</span>
        </span>
        <div class="wysiwyg-tools">
          <button type="button" class="text-link" data-action="toggle-lang">
            语言: ${state.lang === 'zh' ? '中文' : 'English'}
          </button>
          <button type="button" class="text-link" data-action="reset-markdown" title="重新按当前搭配生成默认内容">
            重置
          </button>
        </div>
      </div>

      <div class="wysiwyg-well">
        <div
          id="wysiwyg-editor"
          class="wysiwyg-editor"
          contenteditable="true"
          spellcheck="false"
          role="textbox"
          aria-multiline="true"
          aria-label="所见即所得 Markdown 指令输入框"
        >${markdownToWysiwygHtml(state.markdownDoc)}</div>
        <div class="wysiwyg-well-footer">
          <span>点击任意位置直接打字修改 · 下方勾选项将实时同步至此</span>
          <span>⌘/Ctrl + Enter 发送</span>
        </div>
      </div>

      <div id="host-hint-el" class="host-hint ${composed.hostOnlySlashes.length > 0 ? '' : 'hidden'}">
        已附加客户端命令 <strong>${esc(composed.hostOnlySlashes.join(' '))}</strong>：建议点「复制」粘贴到输入框发送以激活原生循环模式，或直接发送作为文本提示词。
      </div>

      ${state.customizeOpen ? renderCustomizeShelfHtml() : ''}

      <div class="composer-footer">
        <button type="button" class="text-link" data-action="toggle-customize">
          ${state.customizeOpen ? '收起搭配选项 ▴' : '展开全部搭配选项 ▾'}
        </button>

        <div class="composer-actions">
          ${renderSplitLaunchButton()}
        </div>
      </div>
    </section>
  `;
}

function renderSplitLaunchButton() {
  const activeMode = LAUNCH_MODES.find((m) => m.id === state.launchMode) || LAUNCH_MODES[0];
  return `
    <div class="split-launch" id="split-launch-wrap">
      <button
        type="button"
        class="btn btn-primary split-main-btn"
        data-action="execute-launch"
        ${state.sending ? 'disabled' : ''}
      >
        <span>${state.sending ? '处理中…' : esc(activeMode.label)}</span>
        <span class="btn-kbd">⌘↵</span>
      </button>
      <button
        type="button"
        class="btn btn-primary split-caret-btn"
        data-action="toggle-launch-menu"
        aria-haspopup="menu"
        aria-expanded="${state.launchMenuOpen ? 'true' : 'false'}"
        title="切换发送或复制方式"
        ${state.sending ? 'disabled' : ''}
      >▾</button>
      ${
        state.launchMenuOpen
          ? `
        <div class="split-menu" role="menu">
          ${LAUNCH_MODES.map(
            (m) => `
            <button
              type="button"
              role="menuitem"
              class="split-menu-item ${m.id === activeMode.id ? 'active' : ''}"
              data-action="select-launch-mode"
              data-mode="${esc(m.id)}"
            >
              <span class="split-menu-title">
                <span>${esc(m.menuTitle)}</span>
                <span>${m.id === activeMode.id ? '✓' : ''}</span>
              </span>
              <span class="split-menu-desc">${esc(m.desc)}</span>
            </button>
          `
          ).join('')}
        </div>
      `
          : ''
      }
    </div>
  `;
}

function renderCustomizeShelfHtml() {
  const cat = state.catalog;
  const quickSkillIds = [
    'architect',
    'tdd',
    'interrogate',
    'blast-radius',
    'arena',
    'how',
    'why',
    'no-comments',
    'unslop',
    'typescript-best-practices',
  ];
  const allSelectableSkills = cat.skills.filter(
    (s) => !(state.primary.type === 'skill' && state.primary.id === s.id)
  );
  const shownSkills = state.showAllShelfSkills
    ? allSelectableSkills
    : quickSkillIds
        .map((id) => findSkill(id))
        .filter((s) => s && !(state.primary.type === 'skill' && state.primary.id === s.id));

  const quickPrincipleIds = [
    'principle-prove-it-works',
    'principle-fix-root-causes',
    'principle-laziness-protocol',
    'principle-model-the-domain',
    'principle-subtract-before-you-add',
    'principle-minimize-reader-load',
  ];
  const shownPrinciples = state.showAllShelfPrinciples
    ? cat.principles
    : quickPrincipleIds.map((id) => findPrinciple(id)).filter(Boolean);

  return `
    <div class="customize-shelf">
      <div class="done-check-row">
        <span class="shelf-title" style="flex-shrink:0;">验收标准：</span>
        <input
          id="done-check-input"
          type="text"
          class="done-input"
          placeholder="选填，例如：${esc(state.doneCheckPlaceholder || '测试通过且页面实测无报错')}"
          value="${esc(state.doneCheck)}"
        />
      </div>

      <div class="shelf-group">
        <span class="shelf-title">执行约束</span>
        <div class="shelf-pills">
          ${cat.constraints
            .map((c) => {
              const on = state.constraints.includes(c.id);
              return `<button type="button" class="opt-pill ${on ? 'on' : ''}" data-action="toggle-constraint" data-id="${esc(c.id)}">${esc(c.label)}</button>`;
            })
            .join('')}
        </div>
      </div>

      <div class="shelf-group">
        <span class="shelf-title">原生能力</span>
        <div class="shelf-pills">
          ${cat.nativeModifiers
            .map((nm) => {
              const on = state.nativeModifiers.includes(nm.id);
              return `<button type="button" class="opt-pill ${on ? 'on' : ''}" data-action="toggle-native" data-id="${esc(nm.id)}" title="${esc(nm.summary)}">${esc(nm.slash)} ${esc(nm.titleZh)}</button>`;
            })
            .join('')}
        </div>
      </div>

      <div class="shelf-group">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span class="shelf-title">叠加技能（${state.showAllShelfSkills ? `全部 ${allSelectableSkills.length} 个` : `常用 ${shownSkills.length} / ${allSelectableSkills.length}`}）</span>
          <button type="button" class="text-link" data-action="toggle-shelf-skills">
            ${state.showAllShelfSkills ? '收起为常用 ▴' : `展开全部 ${allSelectableSkills.length} 个 ▾`}
          </button>
        </div>
        <div class="shelf-pills">
          ${shownSkills
            .map((s) => {
              const on = state.addonSkills.includes(s.id);
              return `<button type="button" class="opt-pill ${on ? 'on' : ''}" data-action="toggle-addon-skill" data-id="${esc(s.id)}" title="${esc(s.titleEn)} · ${esc(s.shortDesc)}">${esc(s.slash)} ${esc(s.titleZh)}</button>`;
            })
            .join('')}
        </div>
      </div>

      <div class="shelf-group">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span class="shelf-title">工程原则（${state.showAllShelfPrinciples ? `全部 ${cat.principles.length} 条` : `常用 ${shownPrinciples.length} / ${cat.principles.length}`}）</span>
          <button type="button" class="text-link" data-action="toggle-shelf-principles">
            ${state.showAllShelfPrinciples ? '收起为常用 ▴' : `展开全部 ${cat.principles.length} 条 ▾`}
          </button>
        </div>
        <div class="shelf-pills">
          ${shownPrinciples
            .map((pr) => {
              const on = state.principles.includes(pr.id);
              return `<button type="button" class="opt-pill ${on ? 'on' : ''}" data-action="toggle-principle" data-id="${esc(pr.id)}" title="${esc(pr.titleEn)}：${esc(pr.summary)}">${esc(pr.titleZh)}</button>`;
            })
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function bindComposerInputs() {
  const editorEl = document.getElementById('wysiwyg-editor');
  const doneEl = document.getElementById('done-check-input');

  if (editorEl) {
    editorEl.addEventListener('input', () => {
      editorEl.classList.remove('warn-empty');
      // Keep the soft blue goal-slot background, only drop muted placeholder style once typed
      for (const ph of editorEl.querySelectorAll('.md-placeholder')) {
        if (!/^<.+>$/.test((ph.textContent || '').trim())) {
          ph.classList.remove('md-placeholder');
        }
      }
      state.markdownDoc = serializeWysiwygElement(editorEl);
    });
    editorEl.addEventListener('keydown', handleSubmitShortcut);
    // Select inner contents of placeholder so typing replaces text while keeping the blue slot pill
    editorEl.addEventListener('click', (e) => {
      const ph = e.target.closest?.('.md-placeholder');
      if (ph) {
        const range = document.createRange();
        range.selectNodeContents(ph);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  }

  if (doneEl) {
    doneEl.addEventListener('input', (e) => {
      state.doneCheck = e.target.value;
      syncMarkdownFromOptions({ flash: false });
      const liveEd = document.getElementById('wysiwyg-editor');
      if (liveEd) liveEd.innerHTML = markdownToWysiwygHtml(state.markdownDoc);
    });
    doneEl.addEventListener('keydown', handleSubmitShortcut);
  }
}

function executeActiveLaunchMode() {
  if (state.launchMode === 'copy-to-chat') {
    void copyPrompt();
  } else if (state.launchMode === 'send-new-conv') {
    void sendToNewConversation();
  } else {
    void sendToCurrentConversation();
  }
}

function handleSubmitShortcut(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    executeActiveLaunchMode();
  }
}

// ---------------------------------------------------------------------------
// Source Modal
// ---------------------------------------------------------------------------

function renderModalRegion() {
  const el = document.getElementById('modal-region');
  if (!el) return;
  if (!state.modal) {
    el.innerHTML = '';
    return;
  }
  if (state.modal.kind === 'flowchart') {
    const activeTokens = getActiveMountTokenSet();
    const svg = renderFlowchartSvg(state.modal.graph, {
      activeTokens,
      activeNodeId: state.activeNodeId,
      width: 940,
    });
    el.innerHTML = `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet" style="width:min(1040px, 100%);" role="dialog" aria-modal="true">
          <div class="modal-header">
            <span class="modal-path">${esc(state.modal.title)}</span>
            <div style="display:flex;gap:6px;">
              <button type="button" class="quiet-icon-btn" data-action="copy-mermaid" data-id="${esc(state.modal.playbookId)}">复制 Mermaid</button>
              <button type="button" class="quiet-icon-btn" data-action="close-modal">关闭</button>
            </div>
          </div>
          <div class="fc-lightbox-body">${svg}</div>
        </div>
      </div>
    `;
    return;
  }
  el.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <div class="modal-sheet" role="dialog" aria-modal="true">
        <div class="modal-header">
          <span class="modal-path">${esc(state.modal.relPath)}</span>
          <button type="button" class="quiet-icon-btn" data-action="close-modal">关闭</button>
        </div>
        <pre class="modal-content">${
          state.modal.loading ? '正在读取文件…' : esc(state.modal.content)
        }</pre>
      </div>
    </div>
  `;
}

async function openSourceModal(relPath) {
  state.modal = { relPath, content: '', loading: true };
  renderModalRegion();
  try {
    const res = await apiFetch('/api/source', {
      method: 'POST',
      body: JSON.stringify({ relPath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '读取失败');
    state.modal = { relPath: data.relPath, content: data.content, loading: false };
  } catch (err) {
    state.modal = { relPath, content: `无法读取文件：${err.message}`, loading: false };
  }
  renderModalRegion();
}

// ---------------------------------------------------------------------------
// Selection & Dispatch Actions
// ---------------------------------------------------------------------------

function toggleArrayItem(arr, val) {
  const i = arr.indexOf(val);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(val);
}

function selectPreset(recipeId) {
  const r = state.catalog.recipes.find((x) => x.id === recipeId);
  if (!r) return;
  state.selectedNavKey = `preset:${r.id}`;
  state.viewingPrincipleId = null;
  state.primary = { ...r.primary };
  state.activeNodeId = null;
  state.addonSkills = [...r.addonSkills];
  state.principles = [...r.principles];
  state.constraints = [...r.constraints];
  state.nativeModifiers = [...r.nativeModifiers];
  state.goalPlaceholder = r.goalPlaceholder || '';
  state.doneCheckPlaceholder = r.doneCheckPlaceholder || '';
  state.doneCheck = '';
  resetMarkdownFromState();
  state.mobileDetailOpen = true;
  renderSidebarList();
  renderStageRegion();
  syncMobileClass();
  document.getElementById('stage-scroll')?.scrollTo({ top: 0 });
}

function selectPlaybook(playbookId) {
  const pb = findPlaybook(playbookId);
  if (!pb) return;
  state.selectedNavKey = `playbook:${pb.id}`;
  state.viewingPrincipleId = null;
  state.primary = { type: 'playbook', id: pb.id };
  state.activeNodeId = null;
  state.addonSkills = [];
  state.principles = pb.builtinPrinciples.slice(0, 1);
  state.constraints = pb.intensity === 'light' && pb.id === 'investigation' ? ['read-only'] : [];
  state.nativeModifiers = [];
  state.goalPlaceholder = `描述「${pb.titleZh}」的具体目标、问题现象或涉及模块…`;
  state.doneCheckPlaceholder = pb.deliverable;
  state.doneCheck = '';
  resetMarkdownFromState();
  state.mobileDetailOpen = true;
  renderSidebarList();
  renderStageRegion();
  syncMobileClass();
  document.getElementById('stage-scroll')?.scrollTo({ top: 0 });
}

function selectSkill(skillId) {
  const sk = findSkill(skillId);
  if (!sk) return;
  state.selectedNavKey = `skill:${sk.id}`;
  state.viewingPrincipleId = null;
  state.envPopoverOpen = false;
  state.primary = { type: 'skill', id: sk.id };
  state.activeNodeId = null;
  state.addonSkills = [];
  state.principles = [];
  state.constraints = [];
  state.nativeModifiers = [];
  state.goalPlaceholder = ZERO_ARG_SKILLS.has(sk.id)
    ? '可直接点右下角发送（也可补充额外说明）…'
    : `输入传给 ${sk.slash} 的具体内容或目标模块…`;
  state.doneCheckPlaceholder = '';
  state.doneCheck = '';
  resetMarkdownFromState();
  state.mobileDetailOpen = true;
  renderEnvRegion();
  renderSidebarList();
  renderStageRegion();
  syncMobileClass();
  document.getElementById('stage-scroll')?.scrollTo({ top: 0 });
}

function checkReadyBeforeSend() {
  const text = getEffectivePrompt();
  if (!text) {
    showToast('请先输入指令内容');
    return false;
  }
  const hasPlaceholder = /<在此填写|<Describe your/i.test(text);
  if (!hasPlaceholder) return true;
  if (state.primary.type === 'skill' && ZERO_ARG_SKILLS.has(state.primary.id)) {
    return true;
  }
  const now = Date.now();
  if (now - state.lastEmptyWarnAt < 4500) {
    return true;
  }
  state.lastEmptyWarnAt = now;
  const editorEl = document.getElementById('wysiwyg-editor');
  if (editorEl) {
    editorEl.classList.add('warn-empty');
    editorEl.focus();
    const ph = editorEl.querySelector('.md-placeholder');
    if (ph) {
      const range = document.createRange();
      range.selectNodeContents(ph);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  showToast('请先替换提示词中的占位目标（再点一次可直接发送模板）', 3200);
  return false;
}

async function copyTextRaw(text, okMsg) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(okMsg);
  }
}

async function copyPrompt() {
  const text = getEffectivePrompt();
  await copyTextRaw(text, '已复制指令，可粘贴到对话框并继续 @文件');
}

async function sendToCurrentConversation() {
  if (state.sending) return;
  if (!checkReadyBeforeSend()) return;

  const text = getEffectivePrompt();
  const convId = window.sidecar?.conversationId;
  if (!convId || !window.sidecar?.agent?.sendMessage) {
    await copyPrompt();
    showToast('未检测到关联对话，已复制指令供直接粘贴');
    return;
  }

  state.sending = true;
  renderStageRegion();
  try {
    await window.sidecar.agent.sendMessage(text, convId);
    state.sending = false;
    state.lastEmptyWarnAt = 0;
    renderStageRegion();
    showToast(
      window.sidecar.isStandalonePreview
        ? '预览模式：已模拟发送到当前对话'
        : '已发送到当前对话'
    );
  } catch (err) {
    state.sending = false;
    renderStageRegion();
    showToast(`发送失败：${err.message}（可点复制手动粘贴）`, 3600);
  }
}

async function sendToNewConversation() {
  if (state.sending) return;
  if (!checkReadyBeforeSend()) return;

  const text = getEffectivePrompt();
  const { titleSuggestion } = getComposed();

  state.sending = true;
  renderStageRegion();
  try {
    const res = await apiFetch('/api/new-conversation', {
      method: 'POST',
      body: JSON.stringify({
        message: text,
        title: titleSuggestion,
        projectId: state.resolvedProjectId || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '启动新对话失败');

    state.sending = false;
    state.lastEmptyWarnAt = 0;
    renderStageRegion();

    const newConvId =
      data?.conversationId ||
      data?.response?.conversationId ||
      data?.response?.conversation_id ||
      '';
    if (newConvId && window.sidecar?.ui?.toggleConversation) {
      window.sidecar.ui.toggleConversation(newConvId);
    }
    showToast(
      window.sidecar?.isStandalonePreview
        ? '预览模式：已模拟创建新对话'
        : '已开启新对话并开始执行'
    );
  } catch (err) {
    state.sending = false;
    renderStageRegion();
    showToast(`开启新对话失败：${err.message}`, 3600);
  }
}

function handleDelegatedClick(e) {
  if (state.envPopoverOpen && !e.target.closest('#env-region')) {
    state.envPopoverOpen = false;
    renderEnvRegion();
  }
  if (state.launchMenuOpen && !e.target.closest('#split-launch-wrap')) {
    state.launchMenuOpen = false;
    renderStageRegion();
  }

  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'cycle-theme': {
      const order = ['auto', 'light', 'dark'];
      state.themeMode = order[(order.indexOf(state.themeMode) + 1) % order.length];
      applyThemeAttr();
      renderThemeButton();
      break;
    }
    case 'toggle-env-popover': {
      state.envPopoverOpen = !state.envPopoverOpen;
      renderEnvRegion();
      break;
    }
    case 'clear-search': {
      state.searchQuery = '';
      const inp = document.getElementById('global-search');
      if (inp) inp.value = '';
      document.getElementById('search-kbd')?.classList.remove('hidden');
      document.getElementById('search-clear')?.classList.add('hidden');
      renderSidebarTabs();
      renderSidebarList();
      break;
    }
    case 'switch-sidebar-tab': {
      state.sidebarTab = target.dataset.tab;
      state.searchQuery = '';
      const inp = document.getElementById('global-search');
      if (inp) inp.value = '';
      document.getElementById('search-kbd')?.classList.remove('hidden');
      document.getElementById('search-clear')?.classList.add('hidden');
      renderSidebarTabs();
      renderSidebarList();
      break;
    }
    case 'select-preset': {
      selectPreset(target.dataset.id);
      break;
    }
    case 'select-playbook': {
      selectPlaybook(target.dataset.id);
      break;
    }
    case 'select-skill': {
      selectSkill(target.dataset.id);
      break;
    }
    case 'inspect-principle': {
      state.viewingPrincipleId = target.dataset.id;
      state.mobileDetailOpen = true;
      renderSidebarList();
      renderStageRegion();
      syncMobileClass();
      break;
    }
    case 'mobile-back': {
      state.mobileDetailOpen = false;
      syncMobileClass();
      break;
    }
    case 'follow-vs-hint': {
      const tType = target.dataset.targetType;
      const tId = target.dataset.targetId;
      if (tType === 'playbook') {
        state.sidebarTab = 'playbooks';
        renderSidebarTabs();
        selectPlaybook(tId);
      } else if (tType === 'skill') {
        state.sidebarTab = 'skills';
        renderSidebarTabs();
        selectSkill(tId);
      } else if (tType === 'native') {
        if (!state.nativeModifiers.includes(tId)) state.nativeModifiers.push(tId);
        renderStageRegion();
        showToast(`已附加 /${tId}`);
      }
      break;
    }
    case 'jump-ref': {
      const ref = target.dataset.ref || '';
      if (ref.startsWith('/')) {
        const id = ref.slice(1);
        if (findSkill(id)) {
          selectSkill(id);
        } else if (state.catalog.nativeModifiers.some((n) => n.id === id)) {
          toggleArrayItem(state.nativeModifiers, id);
          renderStageRegion();
          showToast(`已切换 ${ref}`);
        }
      } else if (findPlaybook(ref)) {
        selectPlaybook(ref);
      }
      break;
    }
    case 'toggle-addon-skill': {
      toggleArrayItem(state.addonSkills, target.dataset.id);
      syncMarkdownFromOptions();
      renderStageRegion();
      break;
    }
    case 'toggle-principle': {
      toggleArrayItem(state.principles, target.dataset.id);
      syncMarkdownFromOptions();
      renderSidebarList();
      renderStageRegion();
      break;
    }
    case 'toggle-constraint': {
      toggleArrayItem(state.constraints, target.dataset.id);
      syncMarkdownFromOptions();
      renderStageRegion();
      break;
    }
    case 'toggle-native': {
      toggleArrayItem(state.nativeModifiers, target.dataset.id);
      syncMarkdownFromOptions();
      renderStageRegion();
      break;
    }
    case 'toggle-customize': {
      state.customizeOpen = !state.customizeOpen;
      renderStageRegion();
      break;
    }
    case 'toggle-shelf-skills': {
      state.showAllShelfSkills = !state.showAllShelfSkills;
      renderStageRegion();
      break;
    }
    case 'toggle-shelf-principles': {
      state.showAllShelfPrinciples = !state.showAllShelfPrinciples;
      renderStageRegion();
      break;
    }
    case 'toggle-editor-view': {
      if (state.editorView === 'wysiwyg') {
        const ed = document.getElementById('wysiwyg-editor');
        if (ed) state.markdownDoc = serializeWysiwygElement(ed);
        state.editorView = 'source';
      } else {
        const src = document.getElementById('markdown-source-input');
        if (src) state.markdownDoc = src.value;
        state.editorView = 'wysiwyg';
      }
      renderStageRegion();
      break;
    }
    case 'reset-markdown': {
      state.activeNodeId = null;
      resetMarkdownFromState();
      renderStageRegion();
      showToast('已重置为当前组合的默认 Markdown 指令');
      break;
    }
    case 'clear-graph-node': {
      state.activeNodeId = null;
      syncMarkdownFromOptions();
      renderStageRegion();
      if (state.modal?.kind === 'flowchart') renderModalRegion();
      showToast('已取消节点定位，恢复执行完整 Playbook');
      break;
    }
    case 'select-graph-node': {
      const nodeId = target.dataset.nodeId || '';
      if (!nodeId || state.primary.type !== 'playbook') break;
      const pb = findPlaybook(state.primary.id);
      const node = findGraphNode(pb, nodeId);
      if (!node) break;

      if (state.activeNodeId === nodeId) {
        state.activeNodeId = null;
        syncMarkdownFromOptions();
        renderStageRegion();
        if (state.modal?.kind === 'flowchart') renderModalRegion();
        showToast('已取消节点定位，恢复执行完整 Playbook');
        break;
      }

      state.activeNodeId = nodeId;
      // Auto-load any skills / native modifiers / principles mounted on this node
      const autoLoaded = [];
      for (const tok of node.mounts || []) {
        if (tok.startsWith('/')) {
          const slug = tok.slice(1);
          if (findSkill(slug) && !state.addonSkills.includes(slug)) {
            state.addonSkills.push(slug);
            autoLoaded.push(tok);
          } else if (
            state.catalog.nativeModifiers.some((n) => n.id === slug) &&
            !state.nativeModifiers.includes(slug)
          ) {
            state.nativeModifiers.push(slug);
            autoLoaded.push(tok);
          }
        } else {
          const prinId = `principle-${tok}`;
          if (findPrinciple(prinId) && !state.principles.includes(prinId)) {
            state.principles.push(prinId);
            autoLoaded.push(tok);
          }
        }
      }

      syncMarkdownFromOptions();
      renderStageRegion();
      if (state.modal?.kind === 'flowchart') renderModalRegion();
      const extraHint = autoLoaded.length > 0 ? `（已自动装载 ${autoLoaded.join('、')}）` : '';
      showToast(`已定位至「${node.label}」${extraHint}`);
      break;
    }
    case 'toggle-lang': {
      state.lang = state.lang === 'zh' ? 'en' : 'zh';
      syncMarkdownFromOptions();
      renderStageRegion();
      break;
    }
    case 'toggle-graph-mount': {
      e.stopPropagation();
      const tok = target.dataset.token || '';
      if (tok.startsWith('/')) {
        const slug = tok.slice(1);
        if (findSkill(slug)) {
          toggleArrayItem(state.addonSkills, slug);
          syncMarkdownFromOptions();
          renderStageRegion();
          if (state.modal?.kind === 'flowchart') renderModalRegion();
          showToast(state.addonSkills.includes(slug) ? `已强化技能 ${tok}` : `已取消强化 ${tok}`);
        } else if (state.catalog.nativeModifiers.some((n) => n.id === slug)) {
          toggleArrayItem(state.nativeModifiers, slug);
          syncMarkdownFromOptions();
          renderStageRegion();
          if (state.modal?.kind === 'flowchart') renderModalRegion();
          showToast(state.nativeModifiers.includes(slug) ? `已附加 ${tok}` : `已移除 ${tok}`);
        }
      } else {
        const prinId = `principle-${tok}`;
        if (findPrinciple(prinId)) {
          toggleArrayItem(state.principles, prinId);
          syncMarkdownFromOptions();
          renderStageRegion();
          if (state.modal?.kind === 'flowchart') renderModalRegion();
          showToast(state.principles.includes(prinId) ? `已附加原则 ${tok}` : `已移除原则 ${tok}`);
        } else {
          showToast(`${tok} 将由流程自动委派调度`);
        }
      }
      break;
    }
    case 'zoom-canvas': {
      if (target.dataset.reset) {
        state.canvasZoom = 100;
      } else {
        const delta = parseInt(target.dataset.delta || '0', 10);
        state.canvasZoom = Math.max(70, Math.min(150, state.canvasZoom + delta));
      }
      renderStageRegion();
      break;
    }
    case 'open-flowchart-modal': {
      const pb = findPlaybook(target.dataset.id);
      if (pb?.graph) {
        state.modal = {
          kind: 'flowchart',
          playbookId: pb.id,
          title: `${pb.titleZh} (${pb.titleEn}) · ${pb.graph.topologyLabel || '执行流程图'}`,
          graph: pb.graph,
        };
        renderModalRegion();
      }
      break;
    }
    case 'copy-mermaid': {
      const pb = findPlaybook(target.dataset.id);
      if (pb?.graph) {
        const code = toMermaidCode(pb.graph);
        void copyTextRaw(code, '已复制标准 Mermaid flowchart 代码');
      }
      break;
    }
    case 'open-source': {
      void openSourceModal(target.dataset.path);
      break;
    }
    case 'close-modal': {
      state.modal = null;
      renderModalRegion();
      break;
    }
    case 'close-modal-backdrop': {
      if (e.target === target) {
        state.modal = null;
        renderModalRegion();
      }
      break;
    }
    case 'execute-launch': {
      state.launchMenuOpen = false;
      executeActiveLaunchMode();
      break;
    }
    case 'toggle-launch-menu': {
      state.launchMenuOpen = !state.launchMenuOpen;
      renderStageRegion();
      break;
    }
    case 'select-launch-mode': {
      const nextMode = target.dataset.mode;
      if (LAUNCH_MODES.some((m) => m.id === nextMode)) {
        state.launchMode = nextMode;
        state.launchMenuOpen = false;
        try {
          window.localStorage?.setItem('pstack_studio_launch_mode', nextMode);
        } catch {
          // Ignore restricted storage
        }
        renderStageRegion();
        if (nextMode === 'copy-to-chat') {
          void copyPrompt();
        } else {
          const modeObj = LAUNCH_MODES.find((m) => m.id === nextMode);
          showToast(`已切换主按钮为「${modeObj?.label || nextMode}」，点击主按钮即可执行`);
        }
      }
      break;
    }
    case 'copy-prompt': {
      void copyPrompt();
      break;
    }
    case 'send-current': {
      void sendToCurrentConversation();
      break;
    }
    case 'send-new-conv': {
      void sendToNewConversation();
      break;
    }
    default:
      break;
  }
}

function handleGlobalKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    document.getElementById('global-search')?.focus();
    return;
  }
  if (e.key === 'Escape') {
    if (state.modal) {
      state.modal = null;
      renderModalRegion();
    } else if (state.envPopoverOpen) {
      state.envPopoverOpen = false;
      renderEnvRegion();
    } else if (state.searchQuery) {
      state.searchQuery = '';
      const inp = document.getElementById('global-search');
      if (inp) inp.value = '';
      document.getElementById('search-kbd')?.classList.remove('hidden');
      document.getElementById('search-clear')?.classList.add('hidden');
      renderSidebarTabs();
      renderSidebarList();
    }
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function refreshHealth(workspaceUris) {
  try {
    const res = await apiFetch('/api/health', {
      method: 'POST',
      body: JSON.stringify({ workspaceUris }),
    });
    if (res.ok) {
      state.health = await res.json();
      renderEnvRegion();
    }
  } catch {
    // Non-fatal
  }
}

async function resolveProjectId() {
  const convId = window.sidecar?.conversationId;
  if (!convId || !window.sidecar?.agent?.getConversationMetadata) return;
  try {
    const data = await window.sidecar.agent.getConversationMetadata(convId);
    const metaEvent = data?.response?.conversationMetadata || data?.response?.conversation_metadata;
    state.resolvedProjectId = metaEvent?.metadata?.projectId || metaEvent?.metadata?.project_id || '';
  } catch {
    // Non-fatal
  }
}

async function init() {
  window.addEventListener('message', (ev) => {
    if (ev.data?.type === 'theme-change') {
      requestAnimationFrame(applyThemeAttr);
    }
  });
  applyThemeAttr();

  try {
    const res = await apiFetch('/api/catalog', { method: 'POST', body: '{}' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.catalog = await res.json();
  } catch (err) {
    const root = document.getElementById('studio-root');
    if (root) {
      root.innerHTML = `<div class="empty-list">加载失败：${esc(err.message)}</div>`;
    }
    return;
  }

  mountShell();
  renderAll();

  void resolveProjectId();

  if (window.sidecar?.getWorkspaceUris) {
    const uris = await window.sidecar.getWorkspaceUris();
    await refreshHealth(uris);
    window.sidecar.onWorkspaceChange?.((nextUris) => {
      void refreshHealth(nextUris);
    });
  } else {
    await refreshHealth([]);
  }
}

void init();
