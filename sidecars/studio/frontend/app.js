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

const FONT_OPTIONS = [
  {
    id: 'system',
    name: '系统默认',
    sample: '简洁清晰 Aa',
    previewStyle: '-apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", sans-serif',
  },
  {
    id: 'sans-cn',
    name: '现代无衬线',
    sample: '工程文档 Aa',
    previewStyle: '"Inter", "Noto Sans SC", "PingFang SC", sans-serif',
  },
  {
    id: 'mono',
    name: '等宽工程风',
    sample: 'Code / 01',
    previewStyle: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
  },
  {
    id: 'serif',
    name: '人文衬线',
    sample: '深度阅读 Aa',
    previewStyle: '"Noto Serif SC", "Songti SC", Georgia, serif',
  },
];

const FONT_SIZE_OPTIONS = [
  { size: 12, label: '12px 紧凑' },
  { size: 13, label: '13px 偏小' },
  { size: 14, label: '14px 标准' },
  { size: 15, label: '15px 偏大' },
  { size: 16, label: '16px 宽松' },
];

const SETTINGS_TABS = [
  { id: 'general', title: '通用', sub: 'General' },
  { id: 'playbooks', title: '流程', sub: 'Playbooks' },
  { id: 'skills', title: '技能', sub: 'Skills' },
  { id: 'principles', title: '原则', sub: 'Principles' },
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

function loadLocalUiPrefs() {
  try {
    const raw = window.localStorage?.getItem('pstack_studio_ui_prefs');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        themeMode: ['auto', 'light', 'dark'].includes(parsed.themeMode) ? parsed.themeMode : 'auto',
        fontFamily: FONT_OPTIONS.some((f) => f.id === parsed.fontFamily) ? parsed.fontFamily : 'system',
        fontSize: Number.isFinite(Number(parsed.fontSize))
          ? Math.max(12, Math.min(16, Math.round(Number(parsed.fontSize))))
          : 14,
      };
    }
  } catch {
    // Ignore restricted storage
  }
  return { themeMode: 'auto', fontFamily: 'system', fontSize: 14 };
}

function saveLocalUiPrefs(ui) {
  try {
    window.localStorage?.setItem('pstack_studio_ui_prefs', JSON.stringify(ui));
  } catch {
    // Ignore restricted storage
  }
}

function loadLocalUsage() {
  try {
    const raw = window.localStorage?.getItem('pstack_studio_usage');
    if (raw) {
      const p = JSON.parse(raw);
      return {
        presets: p?.presets && typeof p.presets === 'object' ? p.presets : {},
        playbooks: p?.playbooks && typeof p.playbooks === 'object' ? p.playbooks : {},
        skills: p?.skills && typeof p.skills === 'object' ? p.skills : {},
        principles: p?.principles && typeof p.principles === 'object' ? p.principles : {},
      };
    }
  } catch {
    // Ignore restricted storage
  }
  return { presets: {}, playbooks: {}, skills: {}, principles: {} };
}

function saveLocalUsage(usage) {
  try {
    window.localStorage?.setItem('pstack_studio_usage', JSON.stringify(usage));
  } catch {
    // Ignore restricted storage
  }
}

function loadPlaqueCollapsed() {
  try {
    return window.localStorage?.getItem('pstack_studio_plaque_collapsed') === '1';
  } catch {
    return false;
  }
}

const initialUiPrefs = loadLocalUiPrefs();

const state = {
  catalog: null,
  health: null,
  resolvedProjectId: '',
  themeMode: initialUiPrefs.themeMode, // 'auto' | 'light' | 'dark'
  fontFamily: initialUiPrefs.fontFamily, // 'system' | 'sans-cn' | 'mono' | 'serif'
  fontSize: initialUiPrefs.fontSize, // 12..16
  plaqueCollapsed: loadPlaqueCollapsed(),
  settingsOpen: false,
  settingsTab: 'general', // 'general' | 'playbooks' | 'skills' | 'principles'
  settingsDraft: {
    playbookIdea: '',
    skillPath: '',
    skillLabel: '',
    skillIdea: '',
    prinTitleZh: '',
    prinSlug: '',
    prinGroup: 'core',
    prinSummary: '',
  },
  usage: loadLocalUsage(),

  // Master list state (Playbooks only, usage-ranked)
  selectedNavKey: 'playbook:bug-fix',
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

function applyUiPreferences() {
  applyThemeAttr();
  const root = document.documentElement;
  if (state.fontFamily && state.fontFamily !== 'system') {
    root.setAttribute('data-font', state.fontFamily);
  } else {
    root.removeAttribute('data-font');
  }
  const size = Math.max(12, Math.min(16, Number(state.fontSize) || 14));
  root.style.setProperty('--ps-base-size', `${size}px`);
}

function getPlaybookUsage(id) {
  return Number(state.usage?.playbooks?.[id] || 0);
}

function getSkillUsage(id) {
  return Number(state.usage?.skills?.[id] || 0);
}

function getPrincipleUsage(id) {
  return Number(state.usage?.principles?.[id] || 0);
}

function sortByUsageDesc(items, scoreFn) {
  return items
    .map((item, idx) => ({ item, idx, score: scoreFn(item) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx))
    .map((x) => x.item);
}

function recordCurrentDispatchUsage() {
  const playbookId = state.primary.type === 'playbook' ? state.primary.id : '';
  const skillIds = [
    ...(state.primary.type === 'skill' ? [state.primary.id] : []),
    ...state.addonSkills,
  ];
  const principleIds = [...state.principles];

  // Optimistic update for immediate sorting feedback
  if (playbookId) {
    state.usage.playbooks[playbookId] = (state.usage.playbooks[playbookId] || 0) + 1;
  }
  for (const sid of new Set(skillIds)) {
    state.usage.skills[sid] = (state.usage.skills[sid] || 0) + 1;
  }
  for (const pid of new Set(principleIds)) {
    state.usage.principles[pid] = (state.usage.principles[pid] || 0) + 1;
  }
  saveLocalUsage(state.usage);
  renderSidebarList();
  renderStageRegion();
  if (state.settingsOpen) renderSettingsRegion();

  void apiFetch('/api/usage/record', {
    method: 'POST',
    body: JSON.stringify({ playbookId, skillIds, principleIds }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.usage) {
        state.usage = data.usage;
        saveLocalUsage(state.usage);
        renderSidebarList();
        renderStageRegion();
        if (state.settingsOpen) renderSettingsRegion();
      }
    })
    .catch(() => {});
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
        <button id="settings-btn" type="button" class="quiet-icon-btn" data-action="toggle-settings" title="打开插件设置">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" aria-hidden="true">
            <circle cx="8" cy="8" r="2.3"></circle>
            <path d="M8 1.8v1.5M8 12.7v1.5M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.5M12.7 8h1.5M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" stroke-linecap="round"></path>
          </svg>
          <span id="settings-btn-label">设置</span>
        </button>
      </div>
    </header>

    <div id="workspace-grid" class="workspace">
      <aside class="sidebar">
        <div id="sidebar-list" class="nav-list"></div>
      </aside>

      <main id="stage-scroll" class="stage">
        <div id="stage-region" class="stage-inner"></div>
      </main>
    </div>

    <div id="settings-view" class="settings-workspace hidden"></div>

    <div id="modal-region"></div>
    <div id="toast-el" class="toast hidden"></div>
  `;

  root.addEventListener('click', handleDelegatedClick);
  window.addEventListener('keydown', handleGlobalKeydown);
}

function syncMobileClass() {
  document.getElementById('workspace-grid')?.classList.toggle('mobile-detail', state.mobileDetailOpen);
}

function syncSettingsVisibility() {
  const wsEl = document.getElementById('workspace-grid');
  const setEl = document.getElementById('settings-view');
  const btn = document.getElementById('settings-btn');
  const lbl = document.getElementById('settings-btn-label');
  if (wsEl) wsEl.classList.toggle('hidden', state.settingsOpen);
  if (setEl) setEl.classList.toggle('hidden', !state.settingsOpen);
  if (btn) btn.classList.toggle('active', state.settingsOpen);
  if (lbl) lbl.textContent = state.settingsOpen ? '返回工作台' : '设置';
}

function renderAll() {
  applyUiPreferences();
  syncSettingsVisibility();
  renderSidebarList();
  renderStageRegion();
  if (state.settingsOpen) {
    renderSettingsRegion();
  }
  renderModalRegion();
  syncMobileClass();
}

// ---------------------------------------------------------------------------
// Left Sidebar Rendering (Playbooks Only, Usage-Frequency Ranked)
// ---------------------------------------------------------------------------

function renderSidebarList() {
  const el = document.getElementById('sidebar-list');
  if (!el || !state.catalog) return;
  el.innerHTML = renderGroupedPlaybooks();
}

function renderNavRow({ navKey, action, id, title, enLabel, active, usageCount = 0, origin = '' }) {
  const originTag =
    origin === 'custom'
      ? '<span class="origin-tag">自定义</span>'
      : origin === 'external'
        ? '<span class="origin-tag">外部</span>'
        : '';
  const usageTag =
    usageCount > 0
      ? `<span class="usage-badge" title="已使用 ${usageCount} 次">${usageCount}次</span>`
      : '';
  return `
    <button
      type="button"
      class="nav-item ${active ? 'active' : ''}"
      data-action="${action}"
      data-id="${esc(id)}"
      data-nav-key="${esc(navKey)}"
    >
      <div class="nav-item-top">
        <span class="nav-item-title-wrap">
          <span class="nav-item-title">${esc(title)}</span>
          ${originTag}
        </span>
        <span class="nav-item-meta">
          ${usageTag}
          <span class="nav-item-en">${esc(enLabel)}</span>
        </span>
      </div>
    </button>
  `;
}

function renderGroupedPlaybooks() {
  const cat = state.catalog;
  const order = ['debug', 'build', 'understand', 'design', 'verify', 'autopilot'];
  const chunks = [];

  const renderPb = (pb) => {
    const navKey = `playbook:${pb.id}`;
    const isSelected =
      !state.viewingPrincipleId &&
      state.primary.type === 'playbook' &&
      state.primary.id === pb.id;
    return renderNavRow({
      navKey,
      action: 'select-playbook',
      id: pb.id,
      title: pb.titleZh,
      enLabel: pb.titleEn || pb.id,
      usageCount: getPlaybookUsage(pb.id),
      origin: pb.origin === 'custom' ? 'custom' : '',
      active: isSelected,
    });
  };

  const used = sortByUsageDesc(
    cat.playbooks.filter((p) => getPlaybookUsage(p.id) > 0),
    (p) => getPlaybookUsage(p.id)
  );
  const usedIds = new Set(used.map((p) => p.id));

  if (used.length > 0) {
    chunks.push(`<div class="group-heading">高频使用 · 按次数排序</div>`);
    for (const pb of used) chunks.push(renderPb(pb));
  }

  const unusedCustom = cat.playbooks.filter((p) => p.origin === 'custom' && !usedIds.has(p.id));
  if (unusedCustom.length > 0) {
    chunks.push(`<div class="group-heading">自定义流程 Custom</div>`);
    for (const pb of unusedCustom) chunks.push(renderPb(pb));
  }

  for (const scId of order) {
    const items = cat.playbooks.filter(
      (p) => p.origin !== 'custom' && p.scenario === scId && !usedIds.has(p.id)
    );
    if (items.length === 0) continue;
    chunks.push(`<div class="group-heading">${esc(findScenarioTitle(scId))}</div>`);
    for (const pb of items) chunks.push(renderPb(pb));
  }
  return chunks.join('');
}

// ---------------------------------------------------------------------------
// Right Stage Rendering (Header + Visual Pipeline + Direct Composer)
// ---------------------------------------------------------------------------

function renderStageRegion() {
  const el = document.getElementById('stage-region');
  if (!el || !state.catalog) return;

  const fallbackAttr = state.catalog.plugin?.defaultAttribution || null;

  if (state.viewingPrincipleId) {
    const pr = findPrinciple(state.viewingPrincipleId);
    if (pr) {
      el.innerHTML =
        renderPrincipleStage(pr) +
        renderComposerBlock() +
        renderAuthorPlaque(pr.attribution || fallbackAttr, {
          collapsed: state.plaqueCollapsed,
          contextLabel: pr.titleZh,
        });
      bindComposerInputs();
      return;
    }
  }

  if (state.primary.type === 'playbook') {
    const pb = findPlaybook(state.primary.id) || state.catalog.playbooks[0];
    el.innerHTML =
      renderPlaybookStage(pb) +
      renderComposerBlock() +
      renderAuthorPlaque(pb?.attribution || fallbackAttr, {
        collapsed: state.plaqueCollapsed,
        contextLabel: pb ? `${pb.titleZh} · ${pb.titleEn}` : '',
      });
  } else {
    const sk = findSkill(state.primary.id) || state.catalog.skills[0];
    el.innerHTML =
      renderSkillStage(sk) +
      renderComposerBlock() +
      renderAuthorPlaque(sk?.attribution || fallbackAttr, {
        collapsed: state.plaqueCollapsed,
        contextLabel: sk ? `${sk.slash} · ${sk.titleZh}` : '',
      });
  }

  bindComposerInputs();
}

/**
 * Reusable collapsible Developer Tribute Plaque (Colophon).
 * Renders an iridescent, dignified credit card honoring the flow's original
 * author (e.g. Lauren Tan @poteto for Cursor pstack, or custom flow authors).
 */
function renderAuthorPlaque(attribution, { collapsed = false, allowCollapse = true } = {}) {
  const attr = attribution || state.catalog?.plugin?.defaultAttribution;
  if (!attr) return '';

  const isCustom = attr.theme === 'custom';
  const themeClass = isCustom ? 'plaque-custom' : 'plaque-poteto';
  const collapsedClass = allowCollapse && collapsed ? 'plaque-collapsed' : '';
  const kickerText = isCustom ? 'Flow 作者' : '致敬原作者';
  const handleText = `@${attr.author || 'poteto'}`;

  const emblemSvg = isCustom
    ? `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
         <path d="M10 3l6.5 3.7L10 10.4 3.5 6.7 10 3z" stroke-linejoin="round"></path>
         <path d="M3.5 11l6.5 3.7 6.5-3.7" stroke-linecap="round" stroke-linejoin="round"></path>
         <path d="M3.5 14.5l6.5 3.5 6.5-3.5" stroke-linecap="round" stroke-linejoin="round"></path>
       </svg>`
    : `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
         <path d="M10 2.6l7 3.9-7 3.9-7-3.9 7-3.9z" fill="currentColor" fill-opacity="0.22" stroke-linejoin="round"></path>
         <path d="M3 10.3l7 3.9 7-3.9" stroke-linecap="round" stroke-linejoin="round"></path>
         <path d="M3 14l7 3.9 7-3.9" stroke-linecap="round" stroke-linejoin="round"></path>
       </svg>`;

  const toggleBtnHtml = allowCollapse
    ? `<button type="button" class="plaque-toggle-pill" data-action="toggle-plaque" aria-expanded="${collapsed ? 'false' : 'true'}">${collapsed ? '展开 ▾' : '收起 ▴'}</button>`
    : '';

  const handleBtnHtml = attr.repoUrl
    ? `<a class="plaque-handle" href="${esc(attr.repoUrl)}" target="_blank" rel="noopener noreferrer" title="打开原版出处：${esc(attr.repoUrl)}">${esc(handleText)} ↗</a>`
    : `<span class="plaque-handle">${esc(handleText)}</span>`;

  const headerAttrs = allowCollapse
    ? `class="plaque-header" data-action="toggle-plaque" aria-expanded="${collapsed ? 'false' : 'true'}"`
    : `class="plaque-header" style="cursor:default;"`;

  return `
    <section class="tribute-plaque ${themeClass} ${collapsedClass}" aria-label="开发者致敬铭牌">
      <div ${headerAttrs}>
        <div class="plaque-header-left">
          <span class="plaque-emblem">${emblemSvg}</span>
          <div class="plaque-identity">
            <span class="plaque-kicker">${esc(kickerText)}</span>
            <span class="plaque-name">${esc(attr.authorName || attr.author)}</span>
            ${handleBtnHtml}
            <span class="plaque-pack-tag">${esc(attr.pack || 'Cursor pstack')}</span>
            ${
              allowCollapse && collapsed && attr.quote
                ? `<span class="plaque-mini-quote">“${esc(attr.quote)}”</span>`
                : ''
            }
          </div>
        </div>
        ${toggleBtnHtml}
      </div>

      ${
        !allowCollapse || !collapsed
          ? `
        <div class="plaque-body">
          ${
            attr.quote || attr.quoteZh
              ? `
            <div class="plaque-quote-box">
              ${attr.quote ? `<div class="plaque-quote-en">“${esc(attr.quote)}”</div>` : ''}
              ${attr.quoteZh ? `<div class="plaque-quote-zh">${esc(attr.quoteZh)}</div>` : ''}
            </div>
          `
              : ''
          }
        </div>
      `
          : ''
      }
    </section>
  `;
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
  const allSelectableSkills = sortByUsageDesc(
    cat.skills.filter((s) => !(state.primary.type === 'skill' && state.primary.id === s.id)),
    (s) => getSkillUsage(s.id)
  );
  const shownSkills = state.showAllShelfSkills
    ? allSelectableSkills
    : (() => {
        const usedTop = allSelectableSkills.filter((s) => getSkillUsage(s.id) > 0);
        const defaults = quickSkillIds
          .map((id) => findSkill(id))
          .filter((s) => s && !(state.primary.type === 'skill' && state.primary.id === s.id));
        const seen = new Set();
        const merged = [];
        for (const s of [...usedTop, ...defaults]) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
          }
          if (merged.length >= 10) break;
        }
        return merged;
      })();

  const quickPrincipleIds = [
    'principle-prove-it-works',
    'principle-fix-root-causes',
    'principle-laziness-protocol',
    'principle-model-the-domain',
    'principle-subtract-before-you-add',
    'principle-minimize-reader-load',
  ];
  const sortedPrinciples = sortByUsageDesc(cat.principles, (p) => getPrincipleUsage(p.id));
  const shownPrinciples = state.showAllShelfPrinciples
    ? sortedPrinciples
    : (() => {
        const usedTop = sortedPrinciples.filter((p) => getPrincipleUsage(p.id) > 0);
        const defaults = quickPrincipleIds.map((id) => findPrinciple(id)).filter(Boolean);
        const seen = new Set();
        const merged = [];
        for (const p of [...usedTop, ...defaults]) {
          if (!seen.has(p.id)) {
            seen.add(p.id);
            merged.push(p);
          }
          if (merged.length >= 6) break;
        }
        return merged;
      })();

  const hasSkillCounts = allSelectableSkills.some((s) => getSkillUsage(s.id) > 0);
  const hasPrinCounts = sortedPrinciples.some((p) => getPrincipleUsage(p.id) > 0);

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
          <span class="shelf-title">叠加技能（${state.showAllShelfSkills ? `全部 ${allSelectableSkills.length} 个` : `常用 ${shownSkills.length} / ${allSelectableSkills.length}`}${hasSkillCounts ? ' · 已按使用频次靠前' : ''}）</span>
          <button type="button" class="text-link" data-action="toggle-shelf-skills">
            ${state.showAllShelfSkills ? '收起为常用 ▴' : `展开全部 ${allSelectableSkills.length} 个 ▾`}
          </button>
        </div>
        <div class="shelf-pills">
          ${shownSkills
            .map((s) => {
              const on = state.addonSkills.includes(s.id);
              const cnt = getSkillUsage(s.id);
              return `<button type="button" class="opt-pill ${on ? 'on' : ''}" data-action="toggle-addon-skill" data-id="${esc(s.id)}" title="${esc(s.titleEn)} · ${esc(s.shortDesc)}"><span>${esc(s.slash)} ${esc(s.titleZh)}</span>${cnt > 0 ? `<span class="pill-count">${cnt}</span>` : ''}</button>`;
            })
            .join('')}
        </div>
      </div>

      <div class="shelf-group">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span class="shelf-title">工程原则（${state.showAllShelfPrinciples ? `全部 ${cat.principles.length} 条` : `常用 ${shownPrinciples.length} / ${cat.principles.length}`}${hasPrinCounts ? ' · 已按使用频次靠前' : ''}）</span>
          <button type="button" class="text-link" data-action="toggle-shelf-principles">
            ${state.showAllShelfPrinciples ? '收起为常用 ▴' : `展开全部 ${cat.principles.length} 条 ▾`}
          </button>
        </div>
        <div class="shelf-pills">
          ${shownPrinciples
            .map((pr) => {
              const on = state.principles.includes(pr.id);
              const cnt = getPrincipleUsage(pr.id);
              return `<button type="button" class="opt-pill ${on ? 'on' : ''}" data-action="toggle-principle" data-id="${esc(pr.id)}" title="${esc(pr.titleEn)}：${esc(pr.summary)}"><span>${esc(pr.titleZh)}</span>${cnt > 0 ? `<span class="pill-count">${cnt}</span>` : ''}</button>`;
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
// Settings Full-Pane View (General / Playbooks / Skills / Principles)
// ---------------------------------------------------------------------------

function sumCountMap(map) {
  return Object.values(map || {}).reduce((acc, n) => acc + (Number(n) || 0), 0);
}

function renderSettingsRegion() {
  const el = document.getElementById('settings-view');
  if (!el || !state.catalog) return;

  const navHtml = `
    <nav class="settings-nav" aria-label="设置分类">
      <div class="settings-nav-heading">设置 Settings</div>
      ${SETTINGS_TABS.map(
        (t) => `
        <button
          type="button"
          class="settings-nav-item ${state.settingsTab === t.id ? 'active' : ''}"
          data-action="switch-settings-tab"
          data-tab="${t.id}"
        >
          <span>${esc(t.title)}</span>
          <span class="settings-nav-sub">${esc(t.sub)}</span>
        </button>
      `
      ).join('')}
      <div class="settings-nav-footer">
        <button type="button" class="settings-nav-item" data-action="refresh-catalog">
          <span>重新扫描目录</span>
          <span class="settings-nav-sub">Refresh</span>
        </button>
        <button type="button" class="settings-nav-item" data-action="toggle-settings">
          <span>← 返回工作台</span>
          <span class="settings-nav-sub">Esc</span>
        </button>
      </div>
    </nav>
  `;

  let bodyHtml = '';
  if (state.settingsTab === 'general') {
    bodyHtml = renderSettingsGeneralTab();
  } else if (state.settingsTab === 'playbooks') {
    bodyHtml = renderSettingsPlaybooksTab();
  } else if (state.settingsTab === 'skills') {
    bodyHtml = renderSettingsSkillsTab();
  } else {
    bodyHtml = renderSettingsPrinciplesTab();
  }

  el.innerHTML = `${navHtml}<div class="settings-body"><div class="settings-inner">${bodyHtml}</div></div>`;
  bindSettingsInputs();
}

function renderSettingsGeneralTab() {
  const themeChoices = [
    { id: 'auto', label: '跟随宿主 (自动)' },
    { id: 'light', label: '浅色 Light' },
    { id: 'dark', label: '深色 Dark' },
  ];
  const pbTotal = sumCountMap(state.usage?.playbooks);
  const skTotal = sumCountMap(state.usage?.skills);

  return `
    <div class="settings-header">
      <div>
        <h1 class="settings-title">通用设置</h1>
        <p class="settings-desc">配置面板外观主题、字体族与界面字号，所有设置均保存在本地用户配置目录，不影响上游插件更新。</p>
      </div>
    </div>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">主题颜色</h2>
        <p class="settings-card-sub">选择跟随 Antigravity 宿主明暗外观，或手动锁定为浅色 / 深色。</p>
      </div>
      <div class="seg-group">
        ${themeChoices
          .map(
            (t) => `
          <button
            type="button"
            class="seg-btn ${state.themeMode === t.id ? 'active' : ''}"
            data-action="set-theme-mode"
            data-value="${t.id}"
          >${esc(t.label)}</button>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">界面字体</h2>
        <p class="settings-card-sub">即时切换左侧目录、流程图说明与所见即所得编辑器的正文字体。</p>
      </div>
      <div class="font-grid">
        ${FONT_OPTIONS.map(
          (f) => `
          <button
            type="button"
            class="font-card ${state.fontFamily === f.id ? 'active' : ''}"
            data-action="set-font-family"
            data-value="${f.id}"
          >
            <span class="font-card-sample" style="font-family:${esc(f.previewStyle)};">${esc(f.sample)}</span>
            <span class="font-card-name">${esc(f.name)}</span>
          </button>
        `
        ).join('')}
      </div>
    </section>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">字号大小（当前 ${state.fontSize}px）</h2>
        <p class="settings-card-sub">按比例协调缩放全局字号，方便在高分屏或窄侧边栏下阅读。</p>
      </div>
      <div class="seg-group">
        ${FONT_SIZE_OPTIONS.map(
          (opt) => `
          <button
            type="button"
            class="seg-btn ${state.fontSize === opt.size ? 'active' : ''}"
            data-action="set-font-size"
            data-value="${opt.size}"
          >${esc(opt.label)}</button>
        `
        ).join('')}
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h2 class="settings-card-title">使用频次排序统计</h2>
          <p class="settings-card-sub">每次发送或复制指令时自动记录流程与技能使用次数，高频条目会自动排在左侧流程列表与右侧搭配选项最前方。</p>
        </div>
        <button type="button" class="btn btn-ghost" data-action="reset-usage">重置所有计数</button>
      </div>
      <div class="settings-stats-grid">
        <div class="settings-stat-box">
          <div class="settings-stat-num">${pbTotal}</div>
          <div class="settings-stat-label">流程累计执行</div>
        </div>
        <div class="settings-stat-box">
          <div class="settings-stat-num">${skTotal}</div>
          <div class="settings-stat-label">技能累计调用</div>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">致敬与出处（Credits）</h2>
        <p class="settings-card-sub">自定义流程可在 Frontmatter 中填写 <code>author</code>、<code>authorName</code>、<code>pack</code>、<code>quote</code>，右侧工作台会自动复用同款多彩铭牌展示你的署名。</p>
      </div>
      ${renderAuthorPlaque(state.catalog?.plugin?.defaultAttribution, { allowCollapse: false })}
    </section>
  `;
}

function renderSettingsPlaybooksTab() {
  const cat = state.catalog;
  const userDir = cat.userPaths?.playbooksDir || '~/.gemini/config/pstack-studio/playbooks';
  const customPlaybooks = cat.playbooks.filter((p) => p.origin === 'custom');

  return `
    <div class="settings-header">
      <div>
        <h1 class="settings-title">流程管理（Playbooks）</h1>
        <p class="settings-desc">内置 ${cat.counts.builtinPlaybooks ?? 22} 条流程保持只读以持续跟随上游更新；新增自定义流程存放于本地独立目录，写入后自动发现并生成可点击流程图。</p>
      </div>
      <button type="button" class="btn btn-secondary" data-action="refresh-catalog">刷新扫描</button>
    </div>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">通过主对话让 Agent 新建流程</h2>
        <p class="settings-card-sub">直接将固定目录路径、Frontmatter 规范与已有技能清单发送给主对话 Agent，由 Agent 装配写入文件，无需额外注册工具。</p>
      </div>
      <div class="settings-path-box">
        <span>${esc(userDir)}</span>
        <button type="button" class="text-link" data-action="copy-path" data-path="${esc(userDir)}">复制路径</button>
      </div>
      <textarea
        id="settings-playbook-idea"
        class="settings-textarea"
        placeholder="选填：描述你想装配的新流程（例如：后端接口发布前依次执行影响面分析 /blast-radius、红绿单测 /tdd 与对抗审查 /interrogate）…"
      >${esc(state.settingsDraft.playbookIdea)}</textarea>
      <div class="settings-form-row">
        <button type="button" class="btn btn-primary" data-action="agent-create-playbook">发送到主对话新建流程</button>
        <button type="button" class="btn btn-ghost" data-action="copy-agent-create-playbook">复制新建规范提示词</button>
      </div>
      <details class="settings-schema-details">
        <summary>查看自定义流程文件格式约定（&lt;slug&gt;.md + 可选 &lt;slug&gt;.graph.json）</summary>
        <pre class="settings-schema-pre">---
titleZh: 接口发布前检查
titleEn: Release Gate
author: your-handle
authorName: 你的名字
pack: Team Flow
quote: Ship small, verify on the real surface.
scenario: verify        # debug | build | understand | design | verify | autopilot
whenToUse: 合并高风险后端改动前依次检查影响面与测试证据
deliverable: 影响面清单、测试输出与审查结论
builtinSkills: blast-radius, interrogate
builtinPrinciples: principle-prove-it-works
---

# Release Gate

1. 评估变更影响面：运行 /blast-radius 列出受影响调用方。
2. 补齐边界测试：调用 /tdd 验证核心与异常路径。
3. 合入前对抗审查：执行 /interrogate 复核关键风险。

**Reply:** 汇总影响面、测试证据与最终放行结论。</pre>
      </details>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <h2 class="settings-card-title">自定义流程（${customPlaybooks.length}）</h2>
        <span class="settings-card-sub">内置只读：${cat.counts.builtinPlaybooks ?? 22} 条</span>
      </div>
      ${
        customPlaybooks.length === 0
          ? `<div class="empty-list" style="padding:14px 8px;">暂无自定义流程。点击上方「发送到主对话新建流程」，或在目录中新增 <code>.md</code> 后点刷新扫描。</div>`
          : `
        <div class="settings-item-list">
          ${customPlaybooks
            .map(
              (pb) => `
            <div class="settings-item-row">
              <div class="settings-item-main">
                <div class="settings-item-title">
                  <span>${esc(pb.titleZh)}</span>
                  <span class="origin-tag">${esc(pb.id)}</span>
                </div>
                <div class="settings-item-path">${esc(pb.sourceFilePath || pb.relPath)}</div>
              </div>
              <div class="settings-item-actions">
                <button type="button" class="text-link" data-action="open-item-from-settings" data-kind="playbook" data-id="${esc(pb.id)}">去使用</button>
                <button type="button" class="text-link" data-action="open-source" data-path="${esc(pb.relPath)}">查看原文</button>
                <button type="button" class="btn-danger-link" data-action="delete-user-item" data-kind="playbook" data-id="${esc(pb.id)}">删除</button>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
      }
    </section>
  `;
}

function renderSettingsSkillsTab() {
  const cat = state.catalog;
  const userSkillsDir = cat.userPaths?.skillsDir || '~/.gemini/config/pstack-studio/skills';
  const skillDirs = cat.settings?.skillDirs || [];
  const customSkills = cat.skills.filter((s) => s.origin !== 'builtin');

  return `
    <div class="settings-header">
      <div>
        <h1 class="settings-title">技能管理（Skills）</h1>
        <p class="settings-desc">内置 ${cat.counts.builtinSkills ?? 33} 个技能保持只读以持续接收上游更新。可通过挂载外部文件夹路径直接引入团队/个人技能，或让主对话 Agent 新建自定义技能。</p>
      </div>
      <button type="button" class="btn btn-secondary" data-action="refresh-catalog">刷新扫描</button>
    </div>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">按路径挂载外部技能文件夹</h2>
        <p class="settings-card-sub">支持填写单个含 <code>SKILL.md</code> 的技能目录，或包含多个 <code>&lt;skill&gt;/SKILL.md</code> 子目录的父文件夹（支持 <code>~/</code> 开头）。</p>
      </div>
      <div class="settings-form-row">
        <input
          id="settings-skill-dir-path"
          type="text"
          class="settings-input grow"
          placeholder="例如：~/my-skills 或 /data/team-repo/.agents/skills"
          value="${esc(state.settingsDraft.skillPath)}"
        />
        <input
          id="settings-skill-dir-label"
          type="text"
          class="settings-input"
          style="width:140px;"
          placeholder="备注名（选填）"
          value="${esc(state.settingsDraft.skillLabel)}"
        />
        <button type="button" class="btn btn-primary" data-action="add-skill-dir">添加路径</button>
      </div>

      ${
        skillDirs.length === 0
          ? `<div class="empty-list" style="padding:10px 4px;">尚未挂载外部技能文件夹。</div>`
          : `
        <div class="settings-item-list">
          ${skillDirs
            .map(
              (d) => `
            <div class="settings-item-row">
              <div class="settings-item-main">
                <div class="settings-item-title">
                  <span class="status-dot ${d.exists ? '' : 'warn'}"></span>
                  <span>${esc(d.label || d.path)}</span>
                  <span class="origin-tag">${d.exists ? `发现 ${d.discoveredCount} 个技能` : '目录不存在'}</span>
                </div>
                <div class="settings-item-path">${esc(d.resolvedPath || d.path)}</div>
                ${
                  d.loadedIds?.length
                    ? `<div class="settings-card-sub">已载入：${esc(d.loadedIds.map((x) => `/${x}`).join('、'))}</div>`
                    : ''
                }
                ${
                  d.skippedConflicts?.length
                    ? `<div class="settings-card-sub">跳过与内置重名项：${esc(d.skippedConflicts.join('、'))}</div>`
                    : ''
                }
              </div>
              <div class="settings-item-actions">
                <button type="button" class="btn-danger-link" data-action="remove-skill-dir" data-path="${esc(d.path)}">移除</button>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
      }
    </section>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">通过主对话让 Agent 新建自定义技能</h2>
        <p class="settings-card-sub">Agent 直接将新技能写入固定扩展目录，插件自动读取，且拼装指令时会自动附带文件路径，无需修改插件源码。</p>
      </div>
      <div class="settings-path-box">
        <span>${esc(userSkillsDir)}</span>
        <button type="button" class="text-link" data-action="copy-path" data-path="${esc(userSkillsDir)}">复制路径</button>
      </div>
      <textarea
        id="settings-skill-idea"
        class="settings-textarea"
        placeholder="选填：描述你想新建的技能用途（例如：按团队规范自动生成数据库迁移脚本与回滚 SQL）…"
      >${esc(state.settingsDraft.skillIdea)}</textarea>
      <div class="settings-form-row">
        <button type="button" class="btn btn-primary" data-action="agent-create-skill">发送到主对话新建技能</button>
        <button type="button" class="btn btn-ghost" data-action="copy-agent-create-skill">复制新建规范提示词</button>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <h2 class="settings-card-title">已扩展的技能（${customSkills.length}）</h2>
        <span class="settings-card-sub">内置只读：${cat.counts.builtinSkills ?? 33} 个</span>
      </div>
      ${
        customSkills.length === 0
          ? `<div class="empty-list" style="padding:12px 4px;">暂无扩展技能。挂载目录或让 Agent 新建后会自动出现在这里与右侧搭配区。</div>`
          : `
        <div class="settings-item-list">
          ${customSkills
            .map(
              (sk) => `
            <div class="settings-item-row">
              <div class="settings-item-main">
                <div class="settings-item-title">
                  <span>${esc(sk.titleZh)}</span>
                  <span class="origin-tag">${esc(sk.slash)}</span>
                  <span class="origin-tag">${sk.origin === 'external' ? '外部路径' : '自定义目录'}</span>
                </div>
                <div class="settings-item-path">${esc(sk.sourceFilePath || sk.relPath)}</div>
              </div>
              <div class="settings-item-actions">
                <button type="button" class="text-link" data-action="open-item-from-settings" data-kind="skill" data-id="${esc(sk.id)}">去使用</button>
                <button type="button" class="text-link" data-action="open-source" data-path="${esc(sk.relPath)}">查看原文</button>
                ${
                  sk.origin === 'custom'
                    ? `<button type="button" class="btn-danger-link" data-action="delete-user-item" data-kind="skill" data-id="${esc(sk.id)}">删除</button>`
                    : ''
                }
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
      }
    </section>
  `;
}

function renderSettingsPrinciplesTab() {
  const cat = state.catalog;
  const userPrinDir = cat.userPaths?.principlesDir || '~/.gemini/config/pstack-studio/principles';
  const customPrinciples = cat.principles.filter((p) => p.origin === 'custom');

  return `
    <div class="settings-header">
      <div>
        <h1 class="settings-title">原则管理（Principles）</h1>
        <p class="settings-desc">内置 ${cat.counts.builtinPrinciples ?? 24} 条原则保持只读以同步上游演进；在此新增团队或个人工程原则，自动加入左侧原则列表与右侧搭配护栏。</p>
      </div>
      <button type="button" class="btn btn-secondary" data-action="refresh-catalog">刷新扫描</button>
    </div>

    <section class="settings-card">
      <div>
        <h2 class="settings-card-title">快速新增工程原则</h2>
        <p class="settings-card-sub">保存为 Markdown 文件至 <code>${esc(userPrinDir)}</code>，也可一键交给主对话 Agent 润色生成。</p>
      </div>
      <div class="settings-form-row">
        <input
          id="settings-prin-title"
          type="text"
          class="settings-input grow"
          placeholder="中文名称，例如：接口向后兼容优先"
          value="${esc(state.settingsDraft.prinTitleZh)}"
        />
        <input
          id="settings-prin-slug"
          type="text"
          class="settings-input"
          style="width:190px;"
          placeholder="英文 slug，如 api-compat"
          value="${esc(state.settingsDraft.prinSlug)}"
        />
        <select id="settings-prin-group" class="settings-select">
          <option value="core" ${state.settingsDraft.prinGroup === 'core' ? 'selected' : ''}>核心原则 Core</option>
          <option value="architecture" ${state.settingsDraft.prinGroup === 'architecture' ? 'selected' : ''}>架构原则 Architecture</option>
          <option value="verification" ${state.settingsDraft.prinGroup === 'verification' ? 'selected' : ''}>验证原则 Verification</option>
          <option value="delegation" ${state.settingsDraft.prinGroup === 'delegation' ? 'selected' : ''}>协同原则 Delegation</option>
          <option value="meta" ${state.settingsDraft.prinGroup === 'meta' ? 'selected' : ''}>元原则 Meta</option>
        </select>
      </div>
      <textarea
        id="settings-prin-summary"
        class="settings-textarea"
        placeholder="一句话工程准则（例如：对外部公开接口只做增量扩展，变更已有字段前必须保留兼容过渡并验证旧调用方）"
      >${esc(state.settingsDraft.prinSummary)}</textarea>
      <div class="settings-form-row">
        <button type="button" class="btn btn-primary" data-action="create-principle">直接保存原则</button>
        <button type="button" class="btn btn-secondary" data-action="agent-create-principle">发送到主对话让 Agent 撰写</button>
        <button type="button" class="btn btn-ghost" data-action="copy-agent-create-principle">复制规范提示词</button>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <h2 class="settings-card-title">自定义原则（${customPrinciples.length}）</h2>
        <span class="settings-card-sub">内置只读：${cat.counts.builtinPrinciples ?? 24} 条</span>
      </div>
      ${
        customPrinciples.length === 0
          ? `<div class="empty-list" style="padding:12px 4px;">暂无自定义原则。填写上方表单保存，或让主对话 Agent 直接在目录中创建。</div>`
          : `
        <div class="settings-item-list">
          ${customPrinciples
            .map(
              (pr) => `
            <div class="settings-item-row">
              <div class="settings-item-main">
                <div class="settings-item-title">
                  <span>${esc(pr.titleZh)}</span>
                  <span class="origin-tag">${esc(pr.shortSlug)}</span>
                </div>
                <div class="settings-card-sub">${esc(pr.summary)}</div>
                <div class="settings-item-path">${esc(pr.sourceFilePath || pr.relPath)}</div>
              </div>
              <div class="settings-item-actions">
                <button type="button" class="text-link" data-action="open-source" data-path="${esc(pr.relPath)}">查看原文</button>
                <button type="button" class="btn-danger-link" data-action="delete-user-item" data-kind="principle" data-id="${esc(pr.id)}">删除</button>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
      }
    </section>
  `;
}

function bindSettingsInputs() {
  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      state.settingsDraft[key] = e.target.value;
    });
    el.addEventListener('change', (e) => {
      state.settingsDraft[key] = e.target.value;
    });
  };
  bind('settings-playbook-idea', 'playbookIdea');
  bind('settings-skill-dir-path', 'skillPath');
  bind('settings-skill-dir-label', 'skillLabel');
  bind('settings-skill-idea', 'skillIdea');
  bind('settings-prin-title', 'prinTitleZh');
  bind('settings-prin-slug', 'prinSlug');
  bind('settings-prin-group', 'prinGroup');
  bind('settings-prin-summary', 'prinSummary');
}

function buildAgentAuthoringPrompt(kind) {
  const paths = state.catalog?.userPaths || {};
  const knownSkills = (state.catalog?.skills || []).slice(0, 18).map((s) => s.slash).join('、');

  if (kind === 'playbook') {
    const idea = (state.settingsDraft.playbookIdea || '').trim() || '<请先向我确认要装配的流程目标、触发条件和关键步骤>';
    return [
      `请在 pstack Studio 用户自定义流程目录中新建一条 Playbook（切勿修改插件内置的 \`skills/poteto-mode/playbooks/\` 文件，以保持上游更新无冲突）：`,
      ``,
      `- 目标目录：\`${paths.playbooksDir || '~/.gemini/config/pstack-studio/playbooks'}\``,
      `- 命名规范：\`<english-slug>.md\`（可选配对 \`<english-slug>.graph.json\` 定义分支/循环拓扑；若不写 \`.graph.json\`，插件会自动按编号步骤生成可点击流程图）。`,
      `- Frontmatter 字段：\`titleZh\`、\`titleEn\`、\`author\`（开发者代号）、\`authorName\`（署名）、\`pack\`（流派名）、\`quote\`（可选格言）、\`scenario\`（\`debug|build|understand|design|verify|autopilot\`）、\`whenToUse\`、\`deliverable\`、\`builtinSkills\`、\`builtinPrinciples\`。`,
      `- 正文规范：使用编号步骤 \`1. 标题：具体动作\`，可直接装配现有技能（如 ${knownSkills} 等），末尾附 \`**Reply:**\` 交付契约。`,
      ``,
      `流程需求：${idea}`,
      ``,
      `写完文件后告诉我文件路径，我在 pstack Studio 点击「刷新扫描」即可立即生效。`,
    ].join('\n');
  }

  if (kind === 'skill') {
    const idea = (state.settingsDraft.skillIdea || '').trim() || '<请先向我确认新技能的名称、触发场景和执行步骤>';
    return [
      `请在 pstack Studio 用户自定义技能目录中新建一个 Skill（切勿修改插件内置的 \`skills/\` 文件，以保持上游更新无冲突）：`,
      ``,
      `- 目标目录：\`${paths.skillsDir || '~/.gemini/config/pstack-studio/skills'}/<english-slug>/SKILL.md\``,
      `- Frontmatter 字段：\`name\`、\`titleZh\`、\`titleEn\`、\`scenario\`（\`debug|build|understand|design|verify|autopilot\`）、\`description\`、\`whenToUse\`。`,
      `- 如需导入已存在的外部技能文件夹，也可以告诉我文件夹路径，我直接在「设置 → 技能」里按路径挂载。`,
      ``,
      `技能需求：${idea}`,
      ``,
      `写完后告诉我文件路径，我在 pstack Studio 点击「刷新扫描」即可立即出现在技能列表与搭配区。`,
    ].join('\n');
  }

  const titleHint = (state.settingsDraft.prinTitleZh || '').trim();
  const sumHint = (state.settingsDraft.prinSummary || '').trim();
  const idea =
    titleHint || sumHint
      ? `名称：${titleHint || '待定'}；准则要点：${sumHint || '待补充'}`
      : '<请先向我确认原则名称、适用场景与核心约束>';
  return [
    `请在 pstack Studio 用户自定义原则目录中新建一条工程原则（切勿修改插件内置的 \`skills/principle-*\` 文件，以保持上游更新无冲突）：`,
    ``,
    `- 目标目录：\`${paths.principlesDir || '~/.gemini/config/pstack-studio/principles'}/<english-slug>.md\``,
    `- Frontmatter 字段：\`name: principle-<slug>\`、\`titleZh\`、\`titleEn\`、\`group\`（\`core|architecture|verification|delegation|meta\`）、\`summary\`、\`description\`。`,
    ``,
    `原则需求：${idea}`,
    ``,
    `写完后告诉我文件路径，我在 pstack Studio 点击「刷新扫描」即可立即生效。`,
  ].join('\n');
}

async function dispatchAuthoringPromptToChat(kind, copyOnly = false) {
  const prompt = buildAgentAuthoringPrompt(kind);
  if (copyOnly) {
    await copyTextRaw(prompt, '已复制规范提示词，可粘贴到主对话让 Agent 执行');
    return;
  }
  const convId = window.sidecar?.conversationId;
  if (!convId || !window.sidecar?.agent?.sendMessage) {
    await copyTextRaw(prompt, '未检测到关联对话，已复制规范提示词供粘贴');
    return;
  }
  try {
    await window.sidecar.agent.sendMessage(prompt, convId);
    showToast(
      window.sidecar.isStandalonePreview
        ? '预览模式：已模拟发送新建任务到主对话'
        : '已发送到主对话，Agent 写完文件后点击「刷新扫描」即可生效'
    );
  } catch (err) {
    await copyTextRaw(prompt, `发送失败已改复制到剪贴板：${err.message}`);
  }
}

async function persistUiSettings(patch) {
  Object.assign(state, patch);
  applyUiPreferences();
  saveLocalUiPrefs({
    themeMode: state.themeMode,
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
  });
  if (state.settingsOpen) renderSettingsRegion();
  try {
    const res = await apiFetch('/api/settings/ui', {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.catalog) state.catalog = data.catalog;
    }
  } catch {
    // Local fallback already applied
  }
}

async function refreshCatalogLive(showFeedback = true) {
  try {
    const res = await apiFetch('/api/catalog', {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.catalog = await res.json();
    if (state.catalog.usage) {
      state.usage = state.catalog.usage;
      saveLocalUsage(state.usage);
    }
    renderAll();
    if (showFeedback) {
      showToast(
        `已重新扫描：${state.catalog.counts.playbooks} 条流程 · ${state.catalog.counts.skills} 个技能 · ${state.catalog.counts.principles} 条原则`
      );
    }
  } catch (err) {
    showToast(`刷新失败：${err.message}`, 3400);
  }
}

async function handleAddSkillDir() {
  const pathVal = (state.settingsDraft.skillPath || '').trim();
  const labelVal = (state.settingsDraft.skillLabel || '').trim();
  if (!pathVal) {
    showToast('请先输入技能文件夹路径');
    return;
  }
  try {
    const res = await apiFetch('/api/settings/skill-dirs/add', {
      method: 'POST',
      body: JSON.stringify({ path: pathVal, label: labelVal }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '添加失败');
    if (data.catalog) state.catalog = data.catalog;
    state.settingsDraft.skillPath = '';
    state.settingsDraft.skillLabel = '';
    renderAll();
    showToast(`已挂载目录，扫描到 ${data.discoveredCount || 0} 个技能`);
  } catch (err) {
    showToast(err.message, 3600);
  }
}

async function handleRemoveSkillDir(dirPath) {
  try {
    const res = await apiFetch('/api/settings/skill-dirs/remove', {
      method: 'POST',
      body: JSON.stringify({ path: dirPath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '移除失败');
    if (data.catalog) state.catalog = data.catalog;
    renderAll();
    showToast('已移除外部技能目录');
  } catch (err) {
    showToast(err.message, 3400);
  }
}

async function handleCreatePrinciple() {
  const { prinTitleZh, prinSlug, prinGroup, prinSummary } = state.settingsDraft;
  if (!prinTitleZh.trim()) {
    showToast('请填写原则中文名称');
    return;
  }
  try {
    const res = await apiFetch('/api/settings/create-principle', {
      method: 'POST',
      body: JSON.stringify({
        titleZh: prinTitleZh,
        slug: prinSlug,
        group: prinGroup,
        summary: prinSummary,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '创建失败');
    if (data.catalog) state.catalog = data.catalog;
    state.settingsDraft.prinTitleZh = '';
    state.settingsDraft.prinSlug = '';
    state.settingsDraft.prinSummary = '';
    renderAll();
    showToast(`已新增自定义原则：${data.created?.id || prinTitleZh}`);
  } catch (err) {
    showToast(err.message, 3600);
  }
}

async function handleDeleteUserItem(kind, id) {
  try {
    const res = await apiFetch('/api/settings/delete-item', {
      method: 'POST',
      body: JSON.stringify({ kind, id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '删除失败');
    if (data.catalog) state.catalog = data.catalog;
    if (kind === 'playbook' && state.primary.type === 'playbook' && state.primary.id === id) {
      state.primary = { type: 'playbook', id: 'bug-fix' };
      resetMarkdownFromState();
    } else if (kind === 'skill' && state.primary.type === 'skill' && state.primary.id === id) {
      state.primary = { type: 'playbook', id: 'bug-fix' };
      resetMarkdownFromState();
    }
    renderAll();
    showToast('已删除自定义条目');
  } catch (err) {
    showToast(err.message, 3400);
  }
}

async function handleResetUsage() {
  state.usage = { presets: {}, playbooks: {}, skills: {}, principles: {} };
  saveLocalUsage(state.usage);
  try {
    await apiFetch('/api/usage/reset', { method: 'POST', body: '{}' });
  } catch {
    // Non-fatal
  }
  renderAll();
  showToast('已重置所有流程与技能使用计数');
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

function selectPlaybook(playbookId) {
  const pb = findPlaybook(playbookId);
  if (!pb) return;
  const matchedRecipe = (state.catalog?.recipes || []).find(
    (r) => r.primary?.type === 'playbook' && r.primary?.id === pb.id
  );
  state.selectedNavKey = `playbook:${pb.id}`;
  state.viewingPrincipleId = null;
  state.primary = { type: 'playbook', id: pb.id };
  state.activeNodeId = null;
  if (matchedRecipe) {
    state.addonSkills = [...matchedRecipe.addonSkills];
    state.principles = [...matchedRecipe.principles];
    state.constraints = [...matchedRecipe.constraints];
    state.nativeModifiers = [...matchedRecipe.nativeModifiers];
    state.goalPlaceholder = matchedRecipe.goalPlaceholder || `描述「${pb.titleZh}」的具体目标、问题现象或涉及模块…`;
    state.doneCheckPlaceholder = matchedRecipe.doneCheckPlaceholder || pb.deliverable;
  } else {
    state.addonSkills = [];
    state.principles = pb.builtinPrinciples.slice(0, 1);
    state.constraints = pb.intensity === 'light' && pb.id === 'investigation' ? ['read-only'] : [];
    state.nativeModifiers = [];
    state.goalPlaceholder = `描述「${pb.titleZh}」的具体目标、问题现象或涉及模块…`;
    state.doneCheckPlaceholder = pb.deliverable;
  }
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
  recordCurrentDispatchUsage();
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
    recordCurrentDispatchUsage();
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
    recordCurrentDispatchUsage();

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
  if (state.launchMenuOpen && !e.target.closest('#split-launch-wrap')) {
    state.launchMenuOpen = false;
    renderStageRegion();
  }

  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'toggle-settings': {
      state.settingsOpen = !state.settingsOpen;
      syncSettingsVisibility();
      if (state.settingsOpen) {
        renderSettingsRegion();
      } else {
        void refreshCatalogLive(false);
      }
      break;
    }
    case 'switch-settings-tab': {
      state.settingsTab = target.dataset.tab || 'general';
      renderSettingsRegion();
      break;
    }
    case 'set-theme-mode': {
      const val = target.dataset.value;
      if (['auto', 'light', 'dark'].includes(val)) {
        void persistUiSettings({ themeMode: val });
      }
      break;
    }
    case 'set-font-family': {
      const val = target.dataset.value;
      if (FONT_OPTIONS.some((f) => f.id === val)) {
        void persistUiSettings({ fontFamily: val });
      }
      break;
    }
    case 'set-font-size': {
      const val = Number(target.dataset.value);
      if (Number.isFinite(val)) {
        void persistUiSettings({ fontSize: val });
      }
      break;
    }
    case 'reset-usage': {
      void handleResetUsage();
      break;
    }
    case 'refresh-catalog': {
      void refreshCatalogLive(true);
      break;
    }
    case 'add-skill-dir': {
      void handleAddSkillDir();
      break;
    }
    case 'remove-skill-dir': {
      void handleRemoveSkillDir(target.dataset.path || '');
      break;
    }
    case 'create-principle': {
      void handleCreatePrinciple();
      break;
    }
    case 'delete-user-item': {
      void handleDeleteUserItem(target.dataset.kind, target.dataset.id);
      break;
    }
    case 'agent-create-playbook': {
      void dispatchAuthoringPromptToChat('playbook', false);
      break;
    }
    case 'copy-agent-create-playbook': {
      void dispatchAuthoringPromptToChat('playbook', true);
      break;
    }
    case 'agent-create-skill': {
      void dispatchAuthoringPromptToChat('skill', false);
      break;
    }
    case 'copy-agent-create-skill': {
      void dispatchAuthoringPromptToChat('skill', true);
      break;
    }
    case 'agent-create-principle': {
      void dispatchAuthoringPromptToChat('principle', false);
      break;
    }
    case 'copy-agent-create-principle': {
      void dispatchAuthoringPromptToChat('principle', true);
      break;
    }
    case 'copy-path': {
      void copyTextRaw(target.dataset.path || '', '已复制链接/路径');
      break;
    }
    case 'toggle-plaque': {
      if (e.target.closest('a')) break;
      state.plaqueCollapsed = !state.plaqueCollapsed;
      try {
        window.localStorage?.setItem('pstack_studio_plaque_collapsed', state.plaqueCollapsed ? '1' : '0');
      } catch {
        // Ignore restricted storage
      }
      renderStageRegion();
      break;
    }
    case 'open-item-from-settings': {
      const kind = target.dataset.kind;
      const id = target.dataset.id;
      state.settingsOpen = false;
      syncSettingsVisibility();
      if (kind === 'playbook') {
        selectPlaybook(id);
      } else if (kind === 'skill') {
        selectSkill(id);
      }
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
        selectPlaybook(tId);
      } else if (tType === 'skill') {
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
  if (e.key === 'Escape') {
    if (state.modal) {
      state.modal = null;
      renderModalRegion();
    } else if (state.settingsOpen) {
      state.settingsOpen = false;
      syncSettingsVisibility();
      void refreshCatalogLive(false);
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
  applyUiPreferences();

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

  // Hydrate persisted UI preferences & usage counters from user store
  if (state.catalog?.settings?.ui) {
    state.themeMode = state.catalog.settings.ui.themeMode || state.themeMode;
    state.fontFamily = state.catalog.settings.ui.fontFamily || state.fontFamily;
    state.fontSize = state.catalog.settings.ui.fontSize || state.fontSize;
    saveLocalUiPrefs({
      themeMode: state.themeMode,
      fontFamily: state.fontFamily,
      fontSize: state.fontSize,
    });
  }
  if (state.catalog?.usage) {
    state.usage = state.catalog.usage;
    saveLocalUsage(state.usage);
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
