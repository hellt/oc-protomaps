import {
  estimatedMapNodeHeight,
  mapFieldRowHeight,
  mapNodeWidth,
  nodeBadgeHeight,
  nodeBodyPadding,
  nodeHeaderHeight,
  type ReadableLayout,
  type RoutePoint,
  type RoutedLayoutEdge,
  type TargetHandleLayout,
} from './mapLayout';
import type { MapDiffStatus, MapEdgeKind, MapField, MapNode, MapNodeKind } from './protoMapTypes';

export type MapExportInput = {
  layout: ReadableLayout;
  serviceLabel: string;
  serviceTitle: string;
  serviceChoiceLabel: string;
  serviceChoiceVersion?: string;
  rpcFilterLabel?: string | null;
  sourceRepository: string;
  sourceTag?: string | null;
  showDeprecated: boolean;
  showExtensions: boolean;
};

type Point = {
  x: number;
  y: number;
};

type DrawContext = {
  offset: Point;
  connectedHandles: Set<string>;
};

type EdgeStyle = {
  color: string;
  width: number;
  dash?: [number, number];
};

type PdfDocumentConstructor = new (options?: Record<string, unknown>) => PdfDocument;

type PdfDocument = {
  on(
    event: 'data' | 'end' | 'error',
    callback: ((chunk: BlobPart) => void) | (() => void) | ((error: unknown) => void),
  ): PdfDocument;
  addPage(options: { size: [number, number]; margin: number }): PdfDocument;
  save(): PdfDocument;
  restore(): PdfDocument;
  rect(x: number, y: number, width: number, height: number): PdfDocument;
  roundedRect(x: number, y: number, width: number, height: number, radius: number): PdfDocument;
  circle(x: number, y: number, radius: number): PdfDocument;
  moveTo(x: number, y: number): PdfDocument;
  lineTo(x: number, y: number): PdfDocument;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): PdfDocument;
  closePath(): PdfDocument;
  fill(color?: string): PdfDocument;
  stroke(): PdfDocument;
  fillColor(color: string): PdfDocument;
  strokeColor(color: string): PdfDocument;
  lineWidth(width: number): PdfDocument;
  lineCap(cap: string): PdfDocument;
  lineJoin(join: string): PdfDocument;
  opacity(opacity: number): PdfDocument;
  fillOpacity(opacity: number): PdfDocument;
  dash(length: number, options?: { space: number }): PdfDocument;
  undash(): PdfDocument;
  font(name: string): PdfDocument;
  fontSize(size: number): PdfDocument;
  text(text: string, x: number, y: number, options?: Record<string, unknown>): PdfDocument;
  widthOfString(text: string): number;
  link(x: number, y: number, width: number, height: number, url: string): PdfDocument;
  end(): void;
};

const svgMargin = 28;
const pdfMargin = 56;
const pdfTitleBandHeight = 84;
const pdfFooterBandHeight = 42;
const edgeBendRadius = 18;
const handleOffset = 5;
const handleRadius = 4;

const colors = {
  panel: '#ffffff',
  panelSoft: '#f8fafc',
  border: '#b8c5d3',
  text: '#172033',
  muted: '#677486',
  blue: '#0b4b8f',
  blueSoft: '#d9eaf9',
  rpc: '#1c62a0',
  teal: '#16736b',
  amber: '#a15c03',
  amberSoft: '#fbebd3',
  gray: '#4d5a6b',
  reserved: '#e7ebf0',
  deprecated: '#fee2df',
  deprecatedText: '#9b1c15',
  diffAdded: '#2f7d32',
  diffAddedSoft: '#e0f2df',
  diffChanged: '#a15c03',
  diffChangedSoft: '#fbebd3',
  diffRemoved: '#9b1c15',
  diffRemovedSoft: '#fee2df',
  handle: '#2d6f97',
  stream: '#209fb5',
};

const headerColors: Record<MapNodeKind, string> = {
  service: colors.blue,
  rpc: colors.rpc,
  enum: colors.amber,
  external: colors.gray,
  legend: colors.gray,
  message: colors.teal,
};

const edgeStyles: Record<MapEdgeKind, EdgeStyle> = {
  rpc: { color: '#0b4b8f', width: 2.2 },
  field: { color: '#5b708a', width: 1.6 },
  extension: { color: '#8a6a1f', width: 1.4, dash: [7, 6] },
  'extension-detail': { color: '#b47a18', width: 1.5 },
};

const diffEdgeColors: Record<MapDiffStatus, string> = {
  added: colors.diffAdded,
  changed: colors.diffChanged,
  removed: colors.diffRemoved,
};

const diffSoftColors: Record<MapDiffStatus, string> = {
  added: colors.diffAddedSoft,
  changed: colors.diffChangedSoft,
  removed: colors.diffRemovedSoft,
};

function edgeExportStyle(kind: MapEdgeKind, diffStatus?: MapDiffStatus): EdgeStyle {
  const style = edgeStyles[kind] ?? edgeStyles.field;
  if (!diffStatus) {
    return style;
  }

  return {
    ...style,
    color: diffEdgeColors[diffStatus],
    width: diffStatus === 'removed' ? style.width : style.width + 0.4,
    dash: diffStatus === 'removed' ? [5, 5] : style.dash,
  };
}

export function downloadMapSvg(input: MapExportInput): void {
  downloadBlob(
    new Blob([renderMapSvg(input)], { type: 'image/svg+xml;charset=utf-8' }),
    exportFileName(input, 'svg'),
  );
}

export async function downloadMapPdf(input: MapExportInput): Promise<void> {
  downloadBlob(await renderMapPdf(input), exportFileName(input, 'pdf'));
}

export function renderMapSvg(input: MapExportInput): string {
  const { layout } = input;
  const width = Math.max(1, Math.ceil(layout.bounds.width + svgMargin * 2));
  const height = Math.max(1, Math.ceil(layout.bounds.height + svgMargin * 2));
  const context: DrawContext = {
    offset: {
      x: svgMargin - layout.bounds.x,
      y: svgMargin - layout.bounds.y,
    },
    connectedHandles: connectedHandles(layout.edges),
  };
  const title = exportTitle(input);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    svgDefinitions(),
    `<g font-family="${escapeAttribute(svgFontFamily())}">`,
    ...layout.edges.map((edge) => drawSvgEdge(edge, context)),
    ...layout.nodes.map((node) => drawSvgNode(node, context)),
    `</g>`,
    `</svg>`,
  ].join('\n');
}

export async function renderMapPdf(input: MapExportInput): Promise<Blob> {
  const PDFDocument = await loadPdfDocument();
  const { layout } = input;
  const pageWidth = Math.max(640, Math.ceil(layout.bounds.width + pdfMargin * 2));
  const pageHeight = Math.max(
    320,
    Math.ceil(layout.bounds.height + pdfTitleBandHeight + pdfFooterBandHeight),
  );
  const context: DrawContext = {
    offset: {
      x: pdfMargin - layout.bounds.x,
      y: pdfTitleBandHeight - layout.bounds.y,
    },
    connectedHandles: connectedHandles(layout.edges),
  };
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: {
      Title: exportTitle(input),
      Author: 'gnmi-map',
      Subject: exportSubtitle(input),
      Keywords: 'OpenConfig, protobuf, service map',
    },
  });
  const blob = pdfBlobFromDocument(doc);

  doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });
  drawPdfTitle(doc, input, pageWidth);

  for (const edge of layout.edges) {
    drawPdfEdge(doc, edge, context);
  }

  for (const node of layout.nodes) {
    drawPdfNode(doc, node, context);
  }

  drawPdfFooter(doc, pageWidth, pageHeight);
  doc.end();

  return blob;
}

function connectedHandles(edges: RoutedLayoutEdge[]): Set<string> {
  return new Set(edges.map(({ edge }) => `${edge.source}:${edge.sourceHandle}`));
}

function toExportPoint(point: Point, context: DrawContext): Point {
  return {
    x: point.x + context.offset.x,
    y: point.y + context.offset.y,
  };
}

function nodeHeight(node: MapNode): number {
  return estimatedMapNodeHeight(node);
}

function fieldHandleKey(node: MapNode, field: MapField): string {
  return `${node.id}:${field.id}`;
}

function handleFill(node: MapNode): string {
  return node.data.kind === 'enum' ? colors.amber : colors.handle;
}

function targetHandlesFromData(node: MapNode): TargetHandleLayout[] {
  return Array.isArray(node.data.targetHandles)
    ? (node.data.targetHandles as TargetHandleLayout[])
    : [];
}

function svgDefinitions(): string {
  return [
    '<defs>',
    ...Object.entries(edgeStyles).map(([kind, style]) =>
      [
        `<marker id="${arrowMarkerId(kind as MapEdgeKind)}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">`,
        `<path d="M 0 0 L 10 5 L 0 10 z" fill="${style.color}" />`,
        '</marker>',
      ].join(''),
    ),
    ...Object.entries(diffEdgeColors).map(([status, color]) =>
      [
        `<marker id="${arrowMarkerId('field', status as MapDiffStatus)}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">`,
        `<path d="M 0 0 L 10 5 L 0 10 z" fill="${color}" />`,
        '</marker>',
      ].join(''),
    ),
    '</defs>',
  ].join('\n');
}

function drawSvgEdge(routedEdge: RoutedLayoutEdge, context: DrawContext): string {
  if (routedEdge.routePoints.length < 2) {
    return '';
  }

  const edge = routedEdge.edge;
  const style = edgeExportStyle(edge.kind, edge.diffStatus);
  const dash = style.dash ? ` stroke-dasharray="${style.dash.join(' ')}"` : '';
  const points = routedEdge.routePoints.map((point) => toExportPoint(point, context));

  return `<path d="${roundedRoutePath(points)}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linecap="round" stroke-linejoin="round"${dash} marker-end="url(#${arrowMarkerId(edge.kind, edge.diffStatus)})" />`;
}

function drawSvgNode(node: MapNode, context: DrawContext): string {
  const origin = toExportPoint(node.position, context);
  const x = origin.x;
  const y = origin.y;
  const width = mapNodeWidth(node);
  const height = nodeHeight(node);
  const fields = node.data.fields ?? [];
  const headerColor = headerColors[node.data.kind] ?? colors.teal;
  const nodeStroke = node.data.diffStatus ? diffEdgeColors[node.data.diffStatus] : colors.border;
  const parts = [
    `<g id="${escapeAttribute(`node-${node.id}`)}">`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" rx="8" fill="${colors.panel}" stroke="${nodeStroke}" stroke-width="${node.data.diffStatus ? 2 : 1}" />`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${nodeHeaderHeight}" rx="8" fill="${headerColor}" />`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y + nodeHeaderHeight - 8)}" width="${formatNumber(width)}" height="8" fill="${headerColor}" />`,
  ];

  const kindLabel = node.data.kind.toUpperCase();
  const kindPillWidth = Math.max(34, approximateTextWidth(kindLabel, 7, false, true) + 12);
  parts.push(
    `<rect x="${formatNumber(x + 10)}" y="${formatNumber(y + 10)}" width="${formatNumber(kindPillWidth)}" height="16" rx="8" fill="#ffffff" opacity="0.16" />`,
    svgText(kindLabel, x + 16, y + 21, {
      fill: '#ffffff',
      size: 7,
      weight: 800,
    }),
  );

  const titleX = x + 10 + kindPillWidth + 8;
  const titleWidth = width - (titleX - x) - 70;
  parts.push(
    svgText(trimSvgText(node.data.label, titleWidth, 13, false, true), titleX, y + 23, {
      fill: '#ffffff',
      size: 13,
      weight: 800,
    }),
    drawSvgHeaderLinks(node, x, y),
  );

  let rowY = y + nodeHeaderHeight + nodeBodyPadding;

  if (node.data.badges?.length) {
    let badgeX = x + 10;
    for (const badge of node.data.badges) {
      const badgeSvg = drawSvgBadge(badge, badgeX, rowY + 2, colors.deprecatedText, colors.deprecated);
      parts.push(badgeSvg.svg);
      badgeX += badgeSvg.width + 6;
    }
    rowY += nodeBadgeHeight;
  }

  if (!fields.length) {
    parts.push(
      svgText('empty message', x + 12, rowY + 21, {
        fill: colors.muted,
        size: 10,
        style: 'italic',
      }),
    );
  } else {
    fields.forEach((field, index) => {
      parts.push(drawSvgFieldRow(node, field, index, x, rowY, width, context));
      rowY += mapFieldRowHeight(field);
    });
  }

  const targetHandles = targetHandlesFromData(node);
  if (targetHandles.length) {
    for (const handle of targetHandles) {
      parts.push(drawSvgHandle(x - handleOffset, y + handle.y, handleFill(node)));
    }
  } else {
    parts.push(drawSvgHandle(x - handleOffset, y + height / 2, handleFill(node)));
  }

  parts.push('</g>');
  return parts.filter(Boolean).join('\n');
}

function drawSvgHeaderLinks(node: MapNode, x: number, y: number): string {
  let linkX = x + mapNodeWidth(node) - 54;
  const links: string[] = [];

  if (node.data.protoUrl) {
    links.push(drawSvgHeaderLink(linkX, y + 7, 'P', node.data.protoUrl, 'Proto definition'));
    linkX += 29;
  }

  if (node.data.specUrl) {
    links.push(drawSvgHeaderLink(linkX, y + 7, 'D', node.data.specUrl, 'Specification documentation'));
  }

  return links.join('\n');
}

function drawSvgHeaderLink(
  x: number,
  y: number,
  label: string,
  url: string,
  title: string,
): string {
  return [
    `<a href="${escapeAttribute(url)}" target="_blank">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="24" height="24" rx="6" fill="#ffffff" opacity="0.14" />`,
    svgText(label, x + 9, y + 16, {
      fill: '#ffffff',
      size: 8,
      weight: 800,
    }),
    '</a>',
  ].join('\n');
}

function drawSvgFieldRow(
  node: MapNode,
  field: MapField,
  rowIndex: number,
  x: number,
  y: number,
  width: number,
  context: DrawContext,
): string {
  const rowHeight = mapFieldRowHeight(field);
  const nameX = x + Math.floor(width * 0.46);
  const rowRightPadding =
    (context.connectedHandles.has(fieldHandleKey(node, field)) ? 30 : 18) +
    (field.diffStatus ? 72 : 0);
  const typeMaxWidth = nameX - x - 26;
  const nameMaxWidth = width - (nameX - x) - rowRightPadding;
  const parts: string[] = [];
  const rowFill = field.diffStatus ? diffSoftColors[field.diffStatus] : rowIndex % 2 === 0 ? colors.panelSoft : null;

  if (rowFill) {
    parts.push(
      `<rect x="${formatNumber(x + 8)}" y="${formatNumber(y)}" width="${formatNumber(width - 16)}" height="${formatNumber(rowHeight - 2)}" rx="6" fill="${rowFill}" />`,
    );
  }

  parts.push(
    drawSvgFieldType(field, x + 14, y + 18, typeMaxWidth),
    svgText(trimSvgText(field.name, nameMaxWidth, 8.5, true, true), nameX, y + 18, {
      fill: colors.text,
      size: 8.5,
      family: svgMonoFontFamily(),
      weight: 800,
    }),
  );

  if (field.badge === 'deprecated') {
    const lineWidth = Math.min(nameMaxWidth, approximateTextWidth(field.name, 8.5, true, true));
    parts.push(
      `<line x1="${formatNumber(x + 14)}" y1="${formatNumber(y + 15)}" x2="${formatNumber(nameX + lineWidth)}" y2="${formatNumber(y + 15)}" stroke="${colors.deprecatedText}" stroke-width="0.6" opacity="0.55" />`,
    );
  }

  if (field.diffStatus) {
    const badge = drawSvgBadge(field.diffStatus, x + width - 70, y + 7, diffEdgeColors[field.diffStatus], diffSoftColors[field.diffStatus]);
    parts.push(badge.svg);
  }

  const detailBadge = field.badge === 'stream' ? null : field.badge;

  if (field.group || detailBadge) {
    const detailY = y + 28;
    let badgeX = x + 14;
    if (field.group) {
      const badgeSvg = drawSvgBadge(field.group, badgeX, detailY, '#164675', colors.blueSoft);
      parts.push(badgeSvg.svg);
      badgeX += badgeSvg.width + 6;
    }

    if (detailBadge) {
      const fill = detailBadge === 'reserved' ? colors.reserved : colors.deprecated;
      const textColor = detailBadge === 'reserved' ? colors.gray : colors.deprecatedText;
      parts.push(drawSvgBadge(detailBadge, badgeX, detailY, textColor, fill).svg);
    }
  }

  if (context.connectedHandles.has(fieldHandleKey(node, field))) {
    parts.push(drawSvgHandle(x + width + handleOffset, y + rowHeight / 2, handleFill(node)));
  }

  return parts.join('\n');
}

function drawSvgFieldType(field: MapField, x: number, y: number, maxWidth: number): string {
  const typeLabel = trimSvgText(inlineFieldType(field), maxWidth, 8.5, false, true);
  let cursor = x;

  return fieldTypeParts(typeLabel)
    .map((part) => {
      const isStream = part.toLowerCase() === 'stream';
      const text = svgText(part, cursor, y, {
        fill: isStream ? colors.stream : '#526071',
        size: 8.5,
        weight: 800,
      });
      cursor += approximateTextWidth(part, 8.5, false, true);
      return text;
    })
    .join('\n');
}

function drawSvgBadge(
  text: string,
  x: number,
  y: number,
  color: string,
  fill: string,
): { svg: string; width: number } {
  const value = text.toUpperCase();
  const width = Math.max(46, approximateTextWidth(value, 6.8, false, true) + 12);

  return {
    width,
    svg: [
      `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="18" rx="9" fill="${fill}" />`,
      svgText(value, x + 6, y + 13, {
        fill: color,
        size: 6.8,
        weight: 800,
      }),
    ].join('\n'),
  };
}

function drawSvgHandle(x: number, y: number, fill: string): string {
  return `<circle cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="${handleRadius}" fill="${fill}" stroke="#ffffff" stroke-width="2" />`;
}

function svgText(
  text: string,
  x: number,
  y: number,
  options: {
    fill: string;
    size: number;
    family?: string;
    weight?: number;
    style?: string;
  },
): string {
  const family = options.family ?? svgFontFamily();
  const weight = options.weight ? ` font-weight="${options.weight}"` : '';
  const style = options.style ? ` font-style="${escapeAttribute(options.style)}"` : '';

  return `<text x="${formatNumber(x)}" y="${formatNumber(y)}" fill="${options.fill}" font-size="${options.size}" font-family="${escapeAttribute(family)}"${weight}${style}>${escapeXml(text)}</text>`;
}

function drawPdfEdge(
  doc: PdfDocument,
  routedEdge: RoutedLayoutEdge,
  context: DrawContext,
): void {
  if (routedEdge.routePoints.length < 2) {
    return;
  }

  const edge = routedEdge.edge;
  const style = edgeExportStyle(edge.kind, edge.diffStatus);
  const points = routedEdge.routePoints;
  const end = toExportPoint(points[points.length - 1], context);
  const beforeEnd = toExportPoint(points[points.length - 2], context);

  doc
    .save()
    .lineCap('round')
    .lineJoin('round')
    .lineWidth(style.width)
    .strokeColor(style.color);

  if (style.dash) {
    doc.dash(style.dash[0], { space: style.dash[1] });
  }

  drawPdfRoundedPath(doc, points, context);
  doc.stroke().undash().restore();
  drawPdfArrow(doc, end.x, end.y, Math.atan2(end.y - beforeEnd.y, end.x - beforeEnd.x), style.color);
}

function drawPdfNode(doc: PdfDocument, node: MapNode, context: DrawContext): void {
  const origin = toExportPoint(node.position, context);
  const x = origin.x;
  const y = origin.y;
  const width = mapNodeWidth(node);
  const height = nodeHeight(node);
  const fields = node.data.fields ?? [];
  const headerColor = headerColors[node.data.kind] ?? colors.teal;
  const nodeStroke = node.data.diffStatus ? diffEdgeColors[node.data.diffStatus] : colors.border;

  doc
    .save()
    .fillColor(colors.panel)
    .roundedRect(x, y, width, height, 8)
    .fill()
    .lineWidth(node.data.diffStatus ? 2 : 1)
    .strokeColor(nodeStroke)
    .roundedRect(x, y, width, height, 8)
    .stroke()
    .restore();

  doc
    .save()
    .fillColor(headerColor)
    .roundedRect(x, y, width, nodeHeaderHeight, 8)
    .fill()
    .rect(x, y + nodeHeaderHeight - 8, width, 8)
    .fill()
    .restore();

  const kindLabel = node.data.kind.toUpperCase();
  doc.font('Helvetica-Bold').fontSize(6.8);
  const kindPillWidth = Math.max(34, doc.widthOfString(kindLabel) + 12);
  doc
    .save()
    .fillOpacity(0.16)
    .fillColor('#ffffff')
    .roundedRect(x + 10, y + 10, kindPillWidth, 16, 8)
    .fill()
    .fillOpacity(1)
    .fillColor('#ffffff')
    .text(kindLabel, x + 16, y + 15, { lineBreak: false })
    .restore();

  const titleX = x + 10 + kindPillWidth + 8;
  const titleWidth = width - (titleX - x) - 70;
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#ffffff')
    .text(trimPdfText(doc, node.data.label, titleWidth), titleX, y + 11, {
      width: titleWidth,
      lineBreak: false,
    });

  drawPdfHeaderLinks(doc, node, x, y);

  let rowY = y + nodeHeaderHeight + nodeBodyPadding;

  if (node.data.badges?.length) {
    let badgeX = x + 10;
    for (const badge of node.data.badges) {
      badgeX += drawPdfBadge(doc, badge, badgeX, rowY + 2, colors.deprecatedText, colors.deprecated) + 6;
    }
    rowY += nodeBadgeHeight;
  }

  if (!fields.length) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .fillColor(colors.muted)
      .text('empty message', x + 12, rowY + 8, { lineBreak: false });
  } else {
    fields.forEach((field, index) => {
      drawPdfFieldRow(doc, node, field, index, x, rowY, width, context);
      rowY += mapFieldRowHeight(field);
    });
  }

  const targetHandles = targetHandlesFromData(node);
  if (targetHandles.length) {
    for (const handle of targetHandles) {
      drawPdfHandle(doc, x - handleOffset, y + handle.y, handleFill(node));
    }
  } else {
    drawPdfHandle(doc, x - handleOffset, y + height / 2, handleFill(node));
  }
}

function drawPdfFieldRow(
  doc: PdfDocument,
  node: MapNode,
  field: MapField,
  rowIndex: number,
  x: number,
  y: number,
  width: number,
  context: DrawContext,
): void {
  const rowHeight = mapFieldRowHeight(field);
  const nameX = x + Math.floor(width * 0.46);
  const rowRightPadding =
    (context.connectedHandles.has(fieldHandleKey(node, field)) ? 30 : 18) +
    (field.diffStatus ? 72 : 0);
  const typeMaxWidth = nameX - x - 26;
  const nameMaxWidth = width - (nameX - x) - rowRightPadding;
  const rowFill = field.diffStatus ? diffSoftColors[field.diffStatus] : rowIndex % 2 === 0 ? colors.panelSoft : null;

  if (rowFill) {
    doc
      .save()
      .fillColor(rowFill)
      .roundedRect(x + 8, y, width - 16, rowHeight - 2, 6)
      .fill()
      .restore();
  }

  drawPdfFieldType(doc, field, x + 14, y + 8, typeMaxWidth);

  doc
    .font('Courier-Bold')
    .fontSize(8.5)
    .fillColor(colors.text)
    .text(trimPdfText(doc, field.name, nameMaxWidth), nameX, y + 8, {
      width: nameMaxWidth,
      lineBreak: false,
    });

  if (field.badge === 'deprecated') {
    doc
      .save()
      .moveTo(x + 14, y + 15)
      .lineTo(nameX + Math.min(nameMaxWidth, doc.widthOfString(field.name)), y + 15)
      .lineWidth(0.6)
      .strokeColor(colors.deprecatedText)
      .opacity(0.55)
      .stroke()
      .restore();
  }

  if (field.diffStatus) {
    drawPdfBadge(
      doc,
      field.diffStatus,
      x + width - 70,
      y + 7,
      diffEdgeColors[field.diffStatus],
      diffSoftColors[field.diffStatus],
    );
  }

  const detailBadge = field.badge === 'stream' ? null : field.badge;

  if (field.group || detailBadge) {
    const detailY = y + 28;
    let badgeX = x + 14;
    if (field.group) {
      badgeX += drawPdfBadge(doc, field.group, badgeX, detailY, '#164675', colors.blueSoft) + 6;
    }

    if (detailBadge) {
      const fill = detailBadge === 'reserved' ? colors.reserved : colors.deprecated;
      const textColor = detailBadge === 'reserved' ? colors.gray : colors.deprecatedText;
      drawPdfBadge(doc, detailBadge, badgeX, detailY, textColor, fill);
    }
  }

  if (context.connectedHandles.has(fieldHandleKey(node, field))) {
    drawPdfHandle(doc, x + width + handleOffset, y + rowHeight / 2, handleFill(node));
  }
}

function drawPdfFieldType(
  doc: PdfDocument,
  field: MapField,
  x: number,
  y: number,
  maxWidth: number,
): void {
  doc.font('Helvetica-Bold').fontSize(8.5);
  const typeLabel = trimPdfText(doc, inlineFieldType(field), maxWidth);
  let cursor = x;

  for (const part of fieldTypeParts(typeLabel)) {
    doc.fillColor(part.toLowerCase() === 'stream' ? colors.stream : '#526071').text(part, cursor, y, {
      lineBreak: false,
    });
    cursor += doc.widthOfString(part);
  }
}

function drawPdfRoundedPath(doc: PdfDocument, points: Point[], context: DrawContext): void {
  const pdfPoints = points.map((point) => toExportPoint(point, context));
  const [start] = pdfPoints;
  doc.moveTo(start.x, start.y);

  for (let index = 1; index < pdfPoints.length; index += 1) {
    const previous = pdfPoints[index - 1];
    const current = pdfPoints[index];
    const next = pdfPoints[index + 1];

    if (!next) {
      doc.lineTo(current.x, current.y);
      continue;
    }

    const incomingDistance = distance(previous, current);
    const outgoingDistance = distance(current, next);
    if (incomingDistance === 0 || outgoingDistance === 0) {
      doc.lineTo(current.x, current.y);
      continue;
    }

    const radius = Math.min(edgeBendRadius, incomingDistance / 2, outgoingDistance / 2);
    const incomingUnit = {
      x: (current.x - previous.x) / incomingDistance,
      y: (current.y - previous.y) / incomingDistance,
    };
    const outgoingUnit = {
      x: (next.x - current.x) / outgoingDistance,
      y: (next.y - current.y) / outgoingDistance,
    };
    const beforeCorner = {
      x: current.x - incomingUnit.x * radius,
      y: current.y - incomingUnit.y * radius,
    };
    const afterCorner = {
      x: current.x + outgoingUnit.x * radius,
      y: current.y + outgoingUnit.y * radius,
    };

    doc
      .lineTo(beforeCorner.x, beforeCorner.y)
      .quadraticCurveTo(current.x, current.y, afterCorner.x, afterCorner.y);
  }
}

function drawPdfArrow(
  doc: PdfDocument,
  x: number,
  y: number,
  angle: number,
  color: string,
): void {
  const size = 8;
  doc
    .save()
    .fillColor(color)
    .moveTo(x, y)
    .lineTo(
      x - size * Math.cos(angle - Math.PI / 6),
      y - size * Math.sin(angle - Math.PI / 6),
    )
    .lineTo(
      x - size * Math.cos(angle + Math.PI / 6),
      y - size * Math.sin(angle + Math.PI / 6),
    )
    .closePath()
    .fill()
    .restore();
}

function drawPdfBadge(
  doc: PdfDocument,
  text: string,
  x: number,
  y: number,
  color: string,
  fill: string,
): number {
  doc.font('Helvetica-Bold').fontSize(6.8);
  const width = Math.max(46, doc.widthOfString(text.toUpperCase()) + 12);
  doc
    .save()
    .fillColor(fill)
    .roundedRect(x, y, width, 18, 9)
    .fill()
    .fillColor(color)
    .text(text.toUpperCase(), x + 6, y + 6, { lineBreak: false })
    .restore();

  return width;
}

function drawPdfHandle(doc: PdfDocument, x: number, y: number, fill: string): void {
  doc
    .save()
    .circle(x, y, handleRadius)
    .fillColor(fill)
    .fill()
    .circle(x, y, handleRadius)
    .lineWidth(2)
    .strokeColor('#ffffff')
    .stroke()
    .restore();
}

function drawPdfHeaderLinks(doc: PdfDocument, node: MapNode, x: number, y: number): void {
  let linkX = x + mapNodeWidth(node) - 54;

  if (node.data.protoUrl) {
    drawPdfHeaderLink(doc, linkX, y + 7, 'P', node.data.protoUrl);
    linkX += 29;
  }

  if (node.data.specUrl) {
    drawPdfHeaderLink(doc, linkX, y + 7, 'D', node.data.specUrl);
  }
}

function drawPdfHeaderLink(
  doc: PdfDocument,
  x: number,
  y: number,
  label: string,
  url: string,
): void {
  doc
    .save()
    .fillOpacity(0.14)
    .fillColor('#ffffff')
    .roundedRect(x, y, 24, 24, 6)
    .fill()
    .fillOpacity(1)
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor('#ffffff')
    .text(label, x + 9, y + 8, { lineBreak: false })
    .restore();
  doc.link(x, y, 24, 24, url);
}

function drawPdfTitle(doc: PdfDocument, input: MapExportInput, pageWidth: number): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(25)
    .fillColor(colors.text)
    .text(trimPdfText(doc, exportTitle(input), pageWidth - pdfMargin * 2), pdfMargin, 18, {
      width: pageWidth - pdfMargin * 2,
      lineBreak: false,
    });
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(colors.muted)
    .text(trimPdfText(doc, exportSubtitle(input), pageWidth - pdfMargin * 2), pdfMargin, 50, {
      width: pageWidth - pdfMargin * 2,
      lineBreak: false,
    });
}

function drawPdfFooter(doc: PdfDocument, pageWidth: number, pageHeight: number): void {
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(colors.muted)
    .text('P = proto definition, D = specification documentation', pdfMargin, pageHeight - 28, {
      width: pageWidth - pdfMargin * 2,
      lineBreak: false,
    });
}

function roundedRoutePath(points: Point[], radius = edgeBendRadius): string {
  if (!points.length) {
    return '';
  }

  const [start] = points;
  const commands = [`M ${formatNumber(start.x)} ${formatNumber(start.y)}`];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    if (!next) {
      commands.push(`L ${formatNumber(current.x)} ${formatNumber(current.y)}`);
      continue;
    }

    const incomingDistance = distance(previous, current);
    const outgoingDistance = distance(current, next);
    if (incomingDistance === 0 || outgoingDistance === 0) {
      commands.push(`L ${formatNumber(current.x)} ${formatNumber(current.y)}`);
      continue;
    }

    const cornerRadius = Math.min(radius, incomingDistance / 2, outgoingDistance / 2);
    const incomingUnit = {
      x: (current.x - previous.x) / incomingDistance,
      y: (current.y - previous.y) / incomingDistance,
    };
    const outgoingUnit = {
      x: (next.x - current.x) / outgoingDistance,
      y: (next.y - current.y) / outgoingDistance,
    };
    const beforeCorner = {
      x: current.x - incomingUnit.x * cornerRadius,
      y: current.y - incomingUnit.y * cornerRadius,
    };
    const afterCorner = {
      x: current.x + outgoingUnit.x * cornerRadius,
      y: current.y + outgoingUnit.y * cornerRadius,
    };

    commands.push(
      `L ${formatNumber(beforeCorner.x)} ${formatNumber(beforeCorner.y)}`,
      `Q ${formatNumber(current.x)} ${formatNumber(current.y)} ${formatNumber(afterCorner.x)} ${formatNumber(afterCorner.y)}`,
    );
  }

  return commands.join(' ');
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function inlineFieldType(field: MapField): string {
  if (field.badge === 'stream' && !fieldTypeIncludesStream(field.type)) {
    return `${field.type} stream`;
  }

  return field.type;
}

function fieldTypeIncludesStream(value: string): boolean {
  return /\bstream\b/i.test(value);
}

function fieldTypeParts(value: string): string[] {
  return value.split(/(\bstream\b)/i).filter(Boolean);
}

function trimPdfText(doc: PdfDocument, value: string, maxWidth: number): string {
  if (doc.widthOfString(value) <= maxWidth) {
    return value;
  }

  const suffix = '...';
  let trimmed = value;
  while (trimmed.length > 0 && doc.widthOfString(`${trimmed}${suffix}`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed ? `${trimmed}${suffix}` : suffix;
}

function trimSvgText(
  value: string,
  maxWidth: number,
  fontSize: number,
  mono: boolean,
  bold: boolean,
): string {
  if (approximateTextWidth(value, fontSize, mono, bold) <= maxWidth) {
    return value;
  }

  const suffix = '...';
  let trimmed = value;
  while (
    trimmed.length > 0 &&
    approximateTextWidth(`${trimmed}${suffix}`, fontSize, mono, bold) > maxWidth
  ) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed ? `${trimmed}${suffix}` : suffix;
}

function approximateTextWidth(
  value: string,
  fontSize: number,
  mono: boolean,
  bold: boolean,
): number {
  const ratio = mono ? 0.62 : bold ? 0.58 : 0.54;
  return value.length * fontSize * ratio;
}

function exportTitle(input: MapExportInput): string {
  const choiceMatchesService =
    input.serviceChoiceLabel.toLowerCase() === input.serviceLabel.toLowerCase();
  const serviceName = choiceMatchesService
    ? input.serviceLabel
    : `${input.serviceLabel} ${input.serviceChoiceLabel}`;
  const version = input.serviceChoiceVersion ? ` ${input.serviceChoiceVersion}` : '';
  const rpc = input.rpcFilterLabel ? ` - ${input.rpcFilterLabel}` : '';

  return `${serviceName}${version} map${rpc}`;
}

function exportSubtitle(input: MapExportInput): string {
  const source = [input.sourceRepository, input.sourceTag].filter(Boolean).join(' ');
  const filters = [
    input.showExtensions ? 'extensions shown' : 'extensions hidden',
    input.showDeprecated ? 'deprecated shown' : 'deprecated hidden',
  ].join(', ');

  return [source, filters].filter(Boolean).join(' | ');
}

function exportFileName(input: MapExportInput, extension: 'pdf' | 'svg'): string {
  const parts = [
    input.serviceLabel,
    input.serviceChoiceLabel,
    input.serviceChoiceVersion,
    input.rpcFilterLabel,
    input.showExtensions ? 'extensions' : 'no-extensions',
    input.showDeprecated ? 'deprecated' : 'no-deprecated',
  ]
    .filter(Boolean)
    .map((part) => sanitizeFilePart(String(part)));

  return `${parts.join('-') || 'service-map'}.${extension}`;
}

function sanitizeFilePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function arrowMarkerId(kind: MapEdgeKind, diffStatus?: MapDiffStatus): string {
  if (diffStatus) {
    return `arrow-diff-${diffStatus}`;
  }

  return `arrow-${kind}`;
}

function formatNumber(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeAttribute(value: string): string {
  return escapeXml(value);
}

function svgFontFamily(): string {
  return 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
}

function svgMonoFontFamily(): string {
  return 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace';
}

async function loadPdfDocument(): Promise<PdfDocumentConstructor> {
  const pdfkitModule = await import('pdfkit/js/pdfkit.standalone.js');
  return (pdfkitModule.default ?? pdfkitModule) as PdfDocumentConstructor;
}

function pdfBlobFromDocument(doc: PdfDocument): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const chunks: BlobPart[] = [];

    doc.on('data', (chunk: BlobPart) => chunks.push(chunk));
    doc.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    doc.on('error', reject);
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
