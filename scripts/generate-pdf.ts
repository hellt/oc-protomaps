import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import {
  getVisibleMap,
  mapSource,
  type MapEdgeKind,
  type MapField,
  type MapNode,
  type MapNodeKind,
} from '../src/gnmiMap';
import {
  computeReadableNodeLayout,
  estimatedMapNodeHeight,
  mapFieldRowHeight,
  mapNodeWidth,
  nodeBadgeHeight,
  nodeBodyPadding,
  nodeHeaderHeight,
  routeReadableLayout,
  type RoutedLayoutEdge,
  type TargetHandleLayout,
} from '../src/mapLayout';

const outputPath = path.resolve('public/gnmi_0.10.0_map.pdf');
const pageMargin = 56;
const titleBandHeight = 84;
const footerBandHeight = 44;
const gridGap = 34;
const edgeBendRadius = 18;
const handleOffset = 5;
const handleRadius = 4;

const colors = {
  background: '#f4f6f8',
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
  focus: '#2474c9',
  reserved: '#e7ebf0',
  deprecated: '#fee2df',
  deprecatedText: '#9b1c15',
  handle: '#2d6f97',
  grid: '#c4ced9',
};

type Point = {
  x: number;
  y: number;
};

type PdfContext = {
  offset: Point;
  connectedHandles: Set<string>;
};

type EdgeStyle = {
  color: string;
  width: number;
  dash?: [number, number];
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

function nodeHeight(node: MapNode): number {
  return estimatedMapNodeHeight(node);
}

function toPdfPoint(point: Point, context: PdfContext): Point {
  return {
    x: point.x + context.offset.x,
    y: point.y + context.offset.y,
  };
}

function trimTextToWidth(doc: PDFKit.PDFDocument, value: string, maxWidth: number): string {
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

function fieldHandleKey(node: MapNode, field: MapField): string {
  return `${node.id}:${field.id}`;
}

function handleFill(node: MapNode): string {
  return node.data.kind === 'enum' ? colors.amber : colors.handle;
}

function drawArrow(
  doc: PDFKit.PDFDocument,
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

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function drawRoundedPath(
  doc: PDFKit.PDFDocument,
  points: Point[],
  context: PdfContext,
): void {
  const pdfPoints = points.map((point) => toPdfPoint(point, context));
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

function drawEdge(
  doc: PDFKit.PDFDocument,
  routedEdge: RoutedLayoutEdge,
  context: PdfContext,
): void {
  if (routedEdge.routePoints.length < 2) {
    return;
  }

  const edge = routedEdge.edge;
  const style = edgeStyles[edge.kind] ?? edgeStyles.field;
  const points = routedEdge.routePoints;
  const end = toPdfPoint(points[points.length - 1], context);
  const beforeEnd = toPdfPoint(points[points.length - 2], context);

  doc
    .save()
    .lineCap('round')
    .lineJoin('round')
    .lineWidth(style.width + 3)
    .strokeColor('#ffffff')
    .opacity(0.72);
  drawRoundedPath(doc, points, context);
  doc.stroke().restore();

  doc
    .save()
    .lineCap('round')
    .lineJoin('round')
    .lineWidth(style.width)
    .strokeColor(style.color);
  if (style.dash) {
    doc.dash(style.dash[0], { space: style.dash[1] });
  }
  drawRoundedPath(doc, points, context);
  doc.stroke().undash().restore();

  drawArrow(doc, end.x, end.y, Math.atan2(end.y - beforeEnd.y, end.x - beforeEnd.x), style.color);
}

function drawBadge(
  doc: PDFKit.PDFDocument,
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

function drawHandle(doc: PDFKit.PDFDocument, x: number, y: number, fill: string): void {
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

function drawHeaderLinks(doc: PDFKit.PDFDocument, node: MapNode, x: number, y: number): void {
  let linkX = x + mapNodeWidth(node) - 54;

  if (node.data.protoUrl) {
    doc
      .save()
      .fillOpacity(0.14)
      .fillColor('#ffffff')
      .roundedRect(linkX, y + 7, 24, 24, 6)
      .fill()
      .fillOpacity(1)
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#ffffff')
      .text('P', linkX + 9, y + 15, { lineBreak: false })
      .restore();
    doc.link(linkX, y + 7, 24, 24, node.data.protoUrl);
    linkX += 29;
  }

  if (node.data.specUrl) {
    doc
      .save()
      .fillOpacity(0.14)
      .fillColor('#ffffff')
      .roundedRect(linkX, y + 7, 24, 24, 6)
      .fill()
      .fillOpacity(1)
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#ffffff')
      .text('D', linkX + 9, y + 15, { lineBreak: false })
      .restore();
    doc.link(linkX, y + 7, 24, 24, node.data.specUrl);
  }
}

function drawFieldRow(
  doc: PDFKit.PDFDocument,
  node: MapNode,
  field: MapField,
  rowIndex: number,
  x: number,
  y: number,
  width: number,
  context: PdfContext,
): void {
  const rowHeight = mapFieldRowHeight(field);
  const rowRadius = 6;
  const nameX = x + Math.floor(width * 0.46);
  const rowRightPadding = context.connectedHandles.has(fieldHandleKey(node, field)) ? 30 : 18;
  const typeMaxWidth = nameX - x - 26;
  const nameMaxWidth = width - (nameX - x) - rowRightPadding;

  if (rowIndex % 2 === 0) {
    doc
      .save()
      .fillColor(colors.panelSoft)
      .roundedRect(x + 8, y, width - 16, rowHeight - 2, rowRadius)
      .fill()
      .restore();
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#526071')
    .text(trimTextToWidth(doc, field.type, typeMaxWidth), x + 14, y + 8, {
      width: typeMaxWidth,
      lineBreak: false,
    });

  doc
    .font('Courier-Bold')
    .fontSize(8.5)
    .fillColor(colors.text)
    .text(trimTextToWidth(doc, field.name, nameMaxWidth), nameX, y + 8, {
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

  if (field.group || field.badge) {
    const detailY = y + 28;
    let badgeX = x + 14;
    if (field.group) {
      badgeX += drawBadge(doc, field.group, badgeX, detailY, '#164675', colors.blueSoft) + 6;
    }

    if (field.badge) {
      const fill = field.badge === 'reserved' ? colors.reserved : colors.deprecated;
      const textColor = field.badge === 'reserved' ? colors.gray : colors.deprecatedText;
      drawBadge(doc, field.badge, badgeX, detailY, textColor, fill);
    }
  }

  if (context.connectedHandles.has(fieldHandleKey(node, field))) {
    drawHandle(doc, x + width + handleOffset, y + rowHeight / 2, handleFill(node));
  }
}

function drawNode(doc: PDFKit.PDFDocument, node: MapNode, context: PdfContext): void {
  const origin = toPdfPoint(node.position, context);
  const x = origin.x;
  const y = origin.y;
  const width = mapNodeWidth(node);
  const height = nodeHeight(node);
  const fields = node.data.fields ?? [];
  const headerColor = headerColors[node.data.kind] ?? colors.teal;

  doc
    .save()
    .fillOpacity(0.09)
    .fillColor('#1f2937')
    .roundedRect(x, y + 8, width, height, 8)
    .fill()
    .restore();

  doc
    .save()
    .fillColor(colors.panel)
    .roundedRect(x, y, width, height, 8)
    .fill()
    .lineWidth(1)
    .strokeColor(colors.border)
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
    .text(trimTextToWidth(doc, node.data.label, titleWidth), titleX, y + 11, {
      width: titleWidth,
      lineBreak: false,
    });

  drawHeaderLinks(doc, node, x, y);

  let rowY = y + nodeHeaderHeight + nodeBodyPadding;

  if (node.data.badges?.length) {
    let badgeX = x + 10;
    for (const badge of node.data.badges) {
      badgeX += drawBadge(doc, badge, badgeX, rowY + 2, colors.deprecatedText, colors.deprecated) + 6;
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
      drawFieldRow(doc, node, field, index, x, rowY, width, context);
      rowY += mapFieldRowHeight(field);
    });
  }

  const targetHandles = targetHandlesFromData(node);
  if (targetHandles.length) {
    for (const handle of targetHandles) {
      drawHandle(doc, x - handleOffset, y + handle.y, handleFill(node));
    }
  } else {
    drawHandle(doc, x - handleOffset, y + height / 2, handleFill(node));
  }
}

function targetHandlesFromData(node: MapNode): TargetHandleLayout[] {
  return Array.isArray(node.data.targetHandles)
    ? (node.data.targetHandles as TargetHandleLayout[])
    : [];
}

function drawCanvasBackground(doc: PDFKit.PDFDocument, pageWidth: number, pageHeight: number): void {
  doc.rect(0, 0, pageWidth, pageHeight).fill(colors.background);

  doc
    .save()
    .fillOpacity(0.04)
    .fillColor(colors.blue)
    .rect(0, 0, pageWidth * 0.36, pageHeight)
    .fill()
    .fillColor(colors.teal)
    .rect(0, pageHeight * 0.58, pageWidth, pageHeight * 0.42)
    .fill()
    .restore();

  doc.save().fillColor(colors.grid).fillOpacity(0.62);
  for (let x = gridGap; x < pageWidth; x += gridGap) {
    for (let y = gridGap; y < pageHeight; y += gridGap) {
      doc.circle(x, y, 0.55).fill();
    }
  }
  doc.restore();
}

function drawTitle(doc: PDFKit.PDFDocument, pageWidth: number): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(26)
    .fillColor(colors.text)
    .text(`gNMI service ${mapSource.gnmiServiceVersion} map`, pageMargin, 18, {
      width: pageWidth - pageMargin * 2,
      lineBreak: false,
    });
  doc
    .font('Helvetica')
    .fontSize(12)
    .fillColor(colors.muted)
    .text(`Generated from openconfig/gnmi ${mapSource.gnmiTag} protobuf IDL`, pageMargin, 48, {
      width: pageWidth - pageMargin * 2,
      lineBreak: false,
    });
}

async function main() {
  const { nodes, edges: pdfEdges } = getVisibleMap({
    showDeprecated: false,
    showExtensions: true,
  });
  const layoutNodes = await computeReadableNodeLayout(nodes, pdfEdges);
  const layout = routeReadableLayout(layoutNodes, pdfEdges);
  const pdfNodes = layout.nodes;
  const bounds = layout.bounds;
  const pageWidth = bounds.width + pageMargin * 2;
  const pageHeight = bounds.height + titleBandHeight + footerBandHeight;
  const context: PdfContext = {
    offset: {
      x: pageMargin - bounds.x,
      y: titleBandHeight - bounds.y,
    },
    connectedHandles: new Set(pdfEdges.map((edge) => `${edge.source}:${edge.sourceHandle}`)),
  };
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: {
      Title: `gNMI service ${mapSource.gnmiServiceVersion} React Flow Map`,
      Author: 'gnmi-map',
      Subject: `Generated from openconfig/gnmi ${mapSource.gnmiTag} protobuf IDL`,
      Keywords: 'gNMI, OpenConfig, React Flow, protobuf',
    },
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);
  doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });

  drawCanvasBackground(doc, pageWidth, pageHeight);
  drawTitle(doc, pageWidth);

  for (const edge of layout.edges) {
    drawEdge(doc, edge, context);
  }

  for (const node of pdfNodes) {
    drawNode(doc, node, context);
  }

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(colors.muted)
    .text('P = proto definition, D = specification documentation', pageMargin, pageHeight - 30, {
      lineBreak: false,
    });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
