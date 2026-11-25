/**
 * @fileoverview Studio-grade Mermaid-standard SVG Flowchart Engine & Exporter.
 *
 * Key geometric guarantees:
 * - Wide, airy coordinate space (~860–900px) with generous branch & row spacing
 * - Mathematically exact chord sizing for softly rounded decision diamonds so
 *   text never touches or crosses slanted edges
 * - Greedy multi-row chip wrapping inside process nodes so long mount tokens
 *   never overflow node rectangles
 * - Clean dot-grid-ready vector styling + standard `flowchart TD` export
 */

function escXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function estimateTextWidth(text, fontSize = 13) {
  let units = 0;
  for (const ch of String(text || '')) {
    units += ch.charCodeAt(0) > 127 ? 1.02 : 0.6;
  }
  return Math.ceil(units * fontSize);
}

function wrapLabel(text, maxUnits = 18) {
  const s = String(text || '').trim();
  if (!s) return [''];
  let total = 0;
  for (const ch of s) total += ch.charCodeAt(0) > 127 ? 1 : 0.58;
  if (total <= maxUnits) return [s];

  const mid = Math.floor(s.length / 2);
  let splitIdx = -1;
  let bestDist = Infinity;
  for (let i = 2; i < s.length - 2; i++) {
    if (' /、·，,：:？?'.includes(s[i])) {
      const d = Math.abs(i - mid);
      if (d < bestDist) {
        bestDist = d;
        splitIdx = i + (s[i] === ' ' ? 0 : 1);
      }
    }
  }
  if (splitIdx === -1) splitIdx = mid;
  const l1 = s.slice(0, splitIdx).trim();
  const l2 = s.slice(splitIdx).trim();
  return l2 ? [l1, l2] : [l1];
}

function packChipsIntoRows(mounts, maxRowWidth, chipGap = 6) {
  if (!Array.isArray(mounts) || mounts.length === 0) return [];
  const specs = mounts.map((tok) => ({
    tok,
    w: Math.min(maxRowWidth, estimateTextWidth(tok, 10.5) + 18),
  }));
  const rows = [];
  let cur = [];
  let curW = 0;

  for (const spec of specs) {
    const nextW = cur.length === 0 ? spec.w : curW + chipGap + spec.w;
    if (cur.length > 0 && nextW > maxRowWidth) {
      rows.push({ items: cur, totalW: curW });
      cur = [spec];
      curW = spec.w;
    } else {
      cur.push(spec);
      curW = nextW;
    }
  }
  if (cur.length > 0) {
    rows.push({ items: cur, totalW: curW });
  }
  return rows;
}

/**
 * Generates an SVG path for a diamond with softly rounded corners.
 */
function roundedDiamondPath(cx, cy, w, h, fillet = 6) {
  const hw = w / 2;
  const hh = h / 2;
  const len = Math.hypot(hw, hh);
  const t = Math.min(0.14, fillet / len);

  const top = [cx, cy - hh];
  const right = [cx + hw, cy];
  const bottom = [cx, cy + hh];
  const left = [cx - hw, cy];

  const lerp = (a, b, f) => [
    +(a[0] + (b[0] - a[0]) * f).toFixed(1),
    +(a[1] + (b[1] - a[1]) * f).toFixed(1),
  ];

  const t1 = lerp(top, left, t);
  const t2 = lerp(top, right, t);
  const r1 = lerp(right, top, t);
  const r2 = lerp(right, bottom, t);
  const b1 = lerp(bottom, right, t);
  const b2 = lerp(bottom, left, t);
  const l1 = lerp(left, bottom, t);
  const l2 = lerp(left, top, t);

  return (
    `M ${t2[0]} ${t2[1]} L ${r1[0]} ${r1[1]} Q ${right[0]} ${right[1]} ${r2[0]} ${r2[1]} ` +
    `L ${b1[0]} ${b1[1]} Q ${bottom[0]} ${bottom[1]} ${b2[0]} ${b2[1]} ` +
    `L ${l1[0]} ${l1[1]} Q ${left[0]} ${left[1]} ${l2[0]} ${l2[1]} ` +
    `L ${t1[0]} ${t1[1]} Q ${top[0]} ${top[1]} ${t2[0]} ${t2[1]} Z`
  );
}

/**
 * Computes spacious deterministic layout for a Playbook graph spec.
 */
export function layoutFlowchart(graph, options = {}) {
  const rows = Array.isArray(graph?.rows) ? graph.rows : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const subgraphs = Array.isArray(graph?.subgraphs) ? graph.subgraphs : [];

  const hasLoopEdges = edges.some((e) => e.style === 'loop');
  const hasSubgraphs = subgraphs.length > 0;

  const canvasWidth = options.width || (hasLoopEdges ? 900 : 860);
  const padLeft = hasSubgraphs ? 44 : 28;
  const padRight = hasLoopEdges ? 168 : (hasSubgraphs ? 44 : 28);
  const usableWidth = canvasWidth - padLeft - padRight;
  const centerX = padLeft + usableWidth / 2;

  const subgraphPadTop = 34;
  const subgraphPadBottom = 22;

  const sgStartRows = new Map();
  const sgEndRows = new Map();
  for (const sg of subgraphs) {
    sgStartRows.set(sg.fromRow, sg);
    sgEndRows.set(sg.toRow, sg);
  }

  const nodeMap = new Map();
  const rowBounds = [];

  let cursorY = 26;

  for (let r = 0; r < rows.length; r++) {
    if (sgStartRows.has(r)) {
      cursorY += subgraphPadTop;
    }

    const rowItems = rows[r];
    const count = rowItems.length;
    const colGap = count >= 3 ? 26 : 48;
    const maxNodeW =
      count === 1
        ? Math.min(480, usableWidth - 36)
        : Math.floor((usableWidth - colGap * (count - 1) - 24) / count);

    const measured = rowItems.map((item) => {
      const type = item.type || 'step';
      const mounts = Array.isArray(item.mounts) ? item.mounts : [];

      if (type === 'decision') {
        const lines = wrapLabel(item.label, count > 1 ? 11 : 15);
        const h = lines.length > 1 ? 92 : 70;
        const lineH = 16;
        // Compute exact horizontal chord required so text never touches diamond sides
        let reqW = 200;
        lines.forEach((line, idx) => {
          const textW = estimateTextWidth(line, 12);
          const dy = lines.length > 1 ? (idx === 0 ? -8 : 8) : 0;
          const yEdge = Math.abs(dy) + lineH / 2 + 2;
          const chordRatio = Math.max(0.42, 1 - (2 * yEdge) / h);
          const needed = Math.ceil((textW + 34) / chordRatio);
          if (needed > reqW) reqW = needed;
        });
        const w = Math.min(maxNodeW, reqW);
        return { item, type, lines, mounts, chipRows: [], w, h };
      }

      const lines = wrapLabel(item.label, count === 1 ? 26 : count === 2 ? 17 : 12);
      const labelW = Math.max(...lines.map((l) => estimateTextWidth(l, 13)));
      const subW = item.sub ? estimateTextWidth(item.sub, 11) : 0;

      const innerMaxW = maxNodeW - (type === 'subroutine' ? 48 : 34);
      const chipRows = packChipsIntoRows(mounts, innerMaxW, 6);
      const chipsMaxW = chipRows.length > 0 ? Math.max(...chipRows.map((cr) => cr.totalW)) : 0;

      const contentW = Math.max(labelW, subW, chipsMaxW);
      const minW = type === 'subroutine' ? 280 : count === 1 ? 250 : 196;
      const w = Math.min(maxNodeW, Math.max(minW, contentW + (type === 'subroutine' ? 52 : 38)));

      let h = lines.length > 1 ? 54 : 44;
      if (item.sub) h += 18;
      if (chipRows.length > 0) h += chipRows.length * 25 + 6;
      return { item, type, lines, mounts, chipRows, w, h };
    });

    const rowHeight = Math.max(...measured.map((m) => m.h));
    const totalRowW =
      measured.reduce((acc, m) => acc + m.w, 0) + colGap * Math.max(0, count - 1);
    let startX = centerX - totalRowW / 2;

    for (let c = 0; c < measured.length; c++) {
      const m = measured[c];
      const x = Math.round(startX);
      const y = Math.round(cursorY + (rowHeight - m.h) / 2);
      nodeMap.set(m.item.id, {
        ...m.item,
        type: m.type,
        lines: m.lines,
        mounts: m.mounts,
        chipRows: m.chipRows,
        row: r,
        col: c,
        rowCount: count,
        x,
        y,
        w: Math.round(m.w),
        h: Math.round(m.h),
        cx: Math.round(x + m.w / 2),
        cy: Math.round(y + m.h / 2),
      });
      startX += m.w + colGap;
    }

    rowBounds.push({ top: cursorY, bottom: cursorY + rowHeight });
    cursorY += rowHeight;

    if (sgEndRows.has(r)) {
      cursorY += subgraphPadBottom;
    }
    if (r < rows.length - 1) {
      const nextCount = rows[r + 1].length;
      const hasDecision = rowItems.some((it) => it.type === 'decision');
      const gap = hasDecision || nextCount > count ? 62 : 48;
      cursorY += gap;
    }
  }

  const totalHeight = Math.round(cursorY + 26);

  const layoutSubgraphs = subgraphs.map((sg) => {
    const startBound = rowBounds[sg.fromRow] || { top: 26 };
    const endBound = rowBounds[sg.toRow] || { bottom: totalHeight - 26 };
    return {
      ...sg,
      x: padLeft - 14,
      y: Math.round(startBound.top - subgraphPadTop + 6),
      w: Math.round(usableWidth + 28),
      h: Math.round(endBound.bottom - startBound.top + subgraphPadTop + subgraphPadBottom - 6),
    };
  });

  return {
    width: canvasWidth,
    height: totalHeight,
    usableRight: padLeft + usableWidth,
    nodeMap,
    nodes: [...nodeMap.values()],
    subgraphs: layoutSubgraphs,
    edges,
  };
}

/**
 * Renders the Playbook control-flow graph to crisp interactive SVG.
 */
export function renderFlowchartSvg(graph, opts = {}) {
  const activeTokens = opts.activeTokens instanceof Set ? opts.activeTokens : new Set();
  const activeNodeId = opts.activeNodeId || '';
  const layout = layoutFlowchart(graph, { width: opts.width });
  const { width, height, usableRight, nodeMap, nodes, subgraphs, edges } = layout;

  const parts = [];
  parts.push(
    `<svg class="fc-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escXml(graph?.topologyLabel || 'Playbook 流程图')}">`
  );

  parts.push(`
    <defs>
      <filter id="fc-shadow" x="-8%" y="-8%" width="116%" height="122%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.06"></feDropShadow>
      </filter>
      <marker id="fc-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
        <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" class="fc-arrow-head"></path>
      </marker>
      <marker id="fc-arrow-accent" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
        <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" class="fc-arrow-head-accent"></path>
      </marker>
    </defs>
  `);

  // 1. Subgraph dashed containers (behind edges)
  for (const sg of subgraphs) {
    parts.push(`
      <g class="fc-subgraph">
        <rect x="${sg.x}" y="${sg.y}" width="${sg.w}" height="${sg.h}" rx="12" class="fc-subgraph-box"></rect>
      </g>
    `);
  }

  // 2. Edges
  let loopLaneIdx = 0;
  for (const edge of edges) {
    const src = nodeMap.get(edge.from);
    const dst = nodeMap.get(edge.to);
    if (!src || !dst) continue;

    const isLoop = edge.style === 'loop' || dst.row <= src.row;
    const isDashed = edge.style === 'dashed';

    let d = '';
    let labelX = 0;
    let labelY = 0;

    if (isLoop) {
      const gutterX = Math.min(width - 20, usableRight + 40 + loopLaneIdx * 34);
      loopLaneIdx += 1;
      const sx = src.x + src.w;
      const sy = src.cy;
      const tx = dst.x + dst.w;
      const ty = dst.cy;
      const r = 12;
      d = `M ${sx} ${sy} L ${gutterX - r} ${sy} Q ${gutterX} ${sy} ${gutterX} ${sy - r} L ${gutterX} ${ty + r} Q ${gutterX} ${ty} ${gutterX - r} ${ty} L ${tx + 2} ${ty}`;
      labelX = gutterX;
      labelY = Math.round((sy + ty) / 2);
    } else if (src.cx === dst.cx && dst.row === src.row + 1) {
      const sy = src.y + src.h;
      const ty = dst.y - 2;
      d = `M ${src.cx} ${sy} L ${dst.cx} ${ty}`;
      labelX = src.cx;
      labelY = Math.round((sy + ty) / 2);
    } else if (dst.row > src.row + 1 && Math.abs(src.cx - dst.cx) < 12) {
      const bypassX = Math.max(src.x + src.w, dst.x + dst.w) + 28;
      const sy = src.cy;
      const ty = dst.cy;
      d = `M ${src.x + src.w} ${sy} L ${bypassX - 8} ${sy} Q ${bypassX} ${sy} ${bypassX} ${sy + 8} L ${bypassX} ${ty - 8} Q ${bypassX} ${ty} ${bypassX - 8} ${ty} L ${dst.x + dst.w + 2} ${ty}`;
      labelX = bypassX;
      labelY = Math.round((sy + ty) / 2);
    } else {
      const sy = src.y + src.h;
      const ty = dst.y - 2;
      const isForking = src.rowCount < dst.rowCount;
      // Place horizontal elbow slightly higher on forks so branch labels sit cleanly in the vertical drop
      const midY = isForking
        ? Math.round(sy + (ty - sy) * 0.36)
        : Math.round(sy + (ty - sy) * 0.62);
      const dx = dst.cx - src.cx;
      const dir = dx >= 0 ? 1 : -1;
      const r = Math.min(11, Math.abs(dx) / 2, Math.abs(midY - sy) / 2, Math.abs(ty - midY) / 2);

      if (Math.abs(dx) < 4) {
        d = `M ${src.cx} ${sy} L ${dst.cx} ${ty}`;
      } else {
        d =
          `M ${src.cx} ${sy} ` +
          `L ${src.cx} ${midY - r} ` +
          `Q ${src.cx} ${midY} ${src.cx + dir * r} ${midY} ` +
          `L ${dst.cx - dir * r} ${midY} ` +
          `Q ${dst.cx} ${midY} ${dst.cx} ${midY + r} ` +
          `L ${dst.cx} ${ty}`;
      }
      labelX = isForking ? dst.cx : Math.round((src.cx + dst.cx) / 2);
      labelY = isForking ? Math.round((midY + ty) / 2) : midY;
    }

    const edgeClass = isLoop
      ? 'fc-edge fc-edge-loop'
      : isDashed
        ? 'fc-edge fc-edge-dashed'
        : 'fc-edge';
    const marker = isLoop ? 'url(#fc-arrow-accent)' : 'url(#fc-arrow)';
    parts.push(`<path d="${d}" class="${edgeClass}" marker-end="${marker}"></path>`);

    if (edge.label) {
      const lw = estimateTextWidth(edge.label, 11) + 16;
      const lh = 20;
      const clampedLx = isLoop
        ? Math.min(width - lw / 2 - 6, Math.max(usableRight + lw / 2 - 6, labelX))
        : labelX;
      parts.push(`
        <g class="fc-edge-label-group">
          <rect x="${Math.round(clampedLx - lw / 2)}" y="${Math.round(labelY - lh / 2)}" width="${lw}" height="${lh}" rx="5" class="fc-edge-pill ${isLoop ? 'fc-edge-pill-loop' : ''}"></rect>
          <text x="${Math.round(clampedLx)}" y="${Math.round(labelY + 4)}" text-anchor="middle" class="fc-edge-text ${isLoop ? 'fc-edge-text-loop' : ''}">${escXml(edge.label)}</text>
        </g>
      `);
    }
  }

  // 2.5. Subgraph floating title pills on top border (never crossed by entry arrows)
  for (const sg of subgraphs) {
    const labelW = estimateTextWidth(sg.label, 11) + 18;
    const lx = sg.x + 14;
    const ly = sg.y - 10;
    parts.push(`
      <g class="fc-subgraph-title-group">
        <rect x="${lx}" y="${ly}" width="${labelW}" height="20" rx="5" class="fc-edge-pill"></rect>
        <text x="${lx + 9}" y="${ly + 13.5}" class="fc-subgraph-label">${escXml(sg.label)}</text>
      </g>
    `);
  }

  // 3. Nodes
  for (const n of nodes) {
    const isFocused = Boolean(activeNodeId && n.id === activeNodeId);

    if (n.type === 'decision') {
      const diamondD = roundedDiamondPath(n.cx, n.cy, n.w, n.h, 7);
      parts.push(
        `<g class="fc-node fc-node-decision ${isFocused ? 'fc-node-active' : ''}" data-action="select-graph-node" data-node-id="${escXml(n.id)}" style="cursor:pointer;" filter="url(#fc-shadow)">`
      );
      parts.push(`<path d="${diamondD}" class="fc-shape fc-shape-decision"></path>`);
      const baseY = n.lines.length > 1 ? n.cy - 4 : n.cy + 4.5;
      n.lines.forEach((line, idx) => {
        parts.push(
          `<text x="${n.cx}" y="${baseY + idx * 17}" text-anchor="middle" class="fc-label fc-label-decision">${escXml(line)}</text>`
        );
      });
      parts.push(`</g>`);
      continue;
    }

    const isSubroutine = n.type === 'subroutine';
    const nodeActionAttrs =
      isSubroutine && n.targetPlaybook
        ? ` data-action="select-playbook" data-id="${escXml(n.targetPlaybook)}" style="cursor:pointer;"`
        : !isSubroutine
          ? ` data-action="select-graph-node" data-node-id="${escXml(n.id)}" style="cursor:pointer;"`
          : '';

    parts.push(
      `<g class="fc-node ${isSubroutine ? 'fc-node-subroutine' : 'fc-node-step'} ${isFocused ? 'fc-node-active' : ''}" filter="url(#fc-shadow)"${nodeActionAttrs}>`
    );
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${isSubroutine ? 8 : 10}" class="fc-shape ${isSubroutine ? 'fc-shape-subroutine' : 'fc-shape-step'}"></rect>`
    );

    if (isSubroutine) {
      parts.push(`<line x1="${n.x + 10}" y1="${n.y}" x2="${n.x + 10}" y2="${n.y + n.h}" class="fc-subroutine-bar"></line>`);
      parts.push(`<line x1="${n.x + n.w - 10}" y1="${n.y}" x2="${n.x + n.w - 10}" y2="${n.y + n.h}" class="fc-subroutine-bar"></line>`);
    }

    const hasBottomContent = Boolean(n.sub) || n.chipRows.length > 0;
    let textY = hasBottomContent
      ? n.y + (n.lines.length > 1 ? 21 : 25)
      : (n.lines.length > 1 ? n.cy - 4 : n.cy + 5);

    n.lines.forEach((line, idx) => {
      parts.push(
        `<text x="${n.cx}" y="${textY + idx * 17}" text-anchor="middle" class="fc-label ${isSubroutine ? 'fc-label-subroutine' : ''}">${escXml(line)}</text>`
      );
    });

    let nextY = textY + (n.lines.length - 1) * 17;

    if (n.sub) {
      nextY += 17;
      parts.push(`<text x="${n.cx}" y="${nextY}" text-anchor="middle" class="fc-sub">${escXml(n.sub)}</text>`);
    }

    // Multi-row wrapped interactive mount chips (guaranteed inside node box)
    if (n.chipRows.length > 0) {
      const chipH = 20;
      const chipGap = 6;
      const totalChipsBlockH = n.chipRows.length * chipH + (n.chipRows.length - 1) * 5;
      let cy = n.y + n.h - totalChipsBlockH - 8;

      for (const row of n.chipRows) {
        let cx = Math.round(n.cx - row.totalW / 2);
        for (const cs of row.items) {
          const isActive = activeTokens.has(cs.tok);
          const toggleAttrs = ` data-action="toggle-graph-mount" data-token="${escXml(cs.tok)}"`;
          parts.push(`
            <g class="fc-mount ${isActive ? 'fc-mount-active' : ''}"${toggleAttrs} style="cursor:pointer;">
              <rect x="${cx}" y="${cy}" width="${cs.w}" height="${chipH}" rx="5" class="fc-mount-box"></rect>
              <text x="${Math.round(cx + cs.w / 2)}" y="${cy + 13.5}" text-anchor="middle" class="fc-mount-text">${escXml(cs.tok)}</text>
            </g>
          `);
          cx += cs.w + chipGap;
        }
        cy += chipH + 5;
      }
    }

    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join('');
}

/**
 * Exports the graph spec as standard copyable Mermaid `flowchart TD` syntax.
 */
export function toMermaidCode(graph) {
  const rows = Array.isArray(graph?.rows) ? graph.rows : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const subgraphs = Array.isArray(graph?.subgraphs) ? graph.subgraphs : [];

  const sgStart = new Map(subgraphs.map((s) => [s.fromRow, s]));
  const sgEnd = new Map(subgraphs.map((s) => [s.toRow, s]));

  const lines = ['flowchart TD'];
  const cleanLabel = (txt) => String(txt || '').replace(/"/g, "'");

  rows.forEach((rowItems, rIdx) => {
    const startSg = sgStart.get(rIdx);
    if (startSg) {
      lines.push(`  subgraph ${startSg.id}["${cleanLabel(startSg.label)}"]`);
    }
    const indent = startSg || subgraphs.some((s) => rIdx >= s.fromRow && rIdx <= s.toRow) ? '    ' : '  ';
    for (const n of rowItems) {
      const mountSuffix =
        Array.isArray(n.mounts) && n.mounts.length > 0 ? ` (${n.mounts.join(', ')})` : '';
      const fullText = cleanLabel(`${n.label}${mountSuffix}`);
      if (n.type === 'decision') {
        lines.push(`${indent}${n.id}{"${fullText}"}`);
      } else if (n.type === 'subroutine') {
        lines.push(`${indent}${n.id}[["${fullText}"]]`);
      } else {
        lines.push(`${indent}${n.id}("${fullText}")`);
      }
    }
    if (sgEnd.has(rIdx)) {
      lines.push('  end');
    }
  });

  for (const e of edges) {
    const arrow = e.style === 'dashed' || e.style === 'loop' ? '-.->' : '-->';
    if (e.label) {
      lines.push(`  ${e.from} ${arrow}|"${cleanLabel(e.label)}"| ${e.to}`);
    } else {
      lines.push(`  ${e.from} ${arrow} ${e.to}`);
    }
  }

  return lines.join('\n');
}
