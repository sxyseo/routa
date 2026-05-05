import {
  asNumber,
  asRecord,
  type RecordValue,
} from "../shared/office-preview-utils";
import type {
  PresentationRect,
  PresentationShapeKind,
} from "./presentation-layout";

export function elementPath(
  kind: PresentationShapeKind,
  rect: PresentationRect,
): Path2D {
  const path = new Path2D();
  if (kind === "ellipse") {
    path.ellipse(
      rect.width / 2,
      rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    return path;
  }

  if (kind === "roundRect") {
    const radius = Math.min(rect.width, rect.height) * 0.08;
    roundedRect(path, 0, 0, rect.width, rect.height, radius);
    return path;
  }

  if (kind === "triangle") {
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "rtTriangle") {
    polygon(path, [
      [0, 0],
      [rect.width, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "diamond") {
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, rect.height / 2],
      [rect.width / 2, rect.height],
      [0, rect.height / 2],
    ]);
    return path;
  }

  if (kind === "pentagon") {
    polygon(path, [
      [0, 0],
      [rect.width, 0],
      [rect.width, rect.height * 0.72],
      [rect.width / 2, rect.height],
      [0, rect.height * 0.72],
    ]);
    return path;
  }

  if (kind === "chevron") {
    const inset = Math.min(rect.width * 0.38, rect.height * 0.5);
    polygon(path, [
      [0, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height / 2],
      [rect.width - inset, rect.height],
      [0, rect.height],
      [inset, rect.height / 2],
    ]);
    return path;
  }

  if (
    kind === "star5" ||
    kind === "star6" ||
    kind === "star8" ||
    kind === "star32"
  ) {
    const points =
      kind === "star32" ? 32 : kind === "star8" ? 8 : kind === "star6" ? 6 : 5;
    starPath(
      path,
      rect.width / 2,
      rect.height / 2,
      Math.min(rect.width, rect.height) / 2,
      Math.min(rect.width, rect.height) * 0.2,
      points,
    );
    return path;
  }

  if (kind === "donut") {
    const radius = Math.min(rect.width, rect.height) / 2;
    const innerRadius = radius * 0.45;
    path.ellipse(
      rect.width / 2,
      rect.height / 2,
      radius,
      radius,
      0,
      0,
      Math.PI * 2,
    );
    path.ellipse(
      rect.width / 2,
      rect.height / 2,
      innerRadius,
      innerRadius,
      0,
      0,
      Math.PI * 2,
      true,
    );
    return path;
  }

  if (kind === "frame") {
    const inset = Math.min(rect.width, rect.height) * 0.16;
    path.rect(0, 0, rect.width, rect.height);
    const innerWidth = Math.max(0, rect.width - inset * 2);
    const innerHeight = Math.max(0, rect.height - inset * 2);
    path.moveTo(inset, inset);
    path.lineTo(inset, inset + innerHeight);
    path.lineTo(inset + innerWidth, inset + innerHeight);
    path.lineTo(inset + innerWidth, inset);
    path.closePath();
    return path;
  }

  if (kind === "document") {
    const wave = Math.min(rect.height * 0.18, rect.width * 0.08);
    path.moveTo(0, 0);
    path.lineTo(rect.width, 0);
    path.lineTo(rect.width, rect.height - wave);
    path.bezierCurveTo(
      rect.width * 0.66,
      rect.height + wave,
      rect.width * 0.34,
      rect.height - wave * 2,
      0,
      rect.height,
    );
    path.closePath();
    return path;
  }

  if (kind === "extract") {
    polygon(path, [
      [0, 0],
      [rect.width, 0],
      [rect.width / 2, rect.height],
    ]);
    return path;
  }

  if (kind === "parallelogram") {
    const skew = Math.min(rect.width / 3, rect.width * 0.18);
    polygon(path, [
      [skew, 0],
      [rect.width, 0],
      [rect.width - skew, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "diagStripe") {
    const skew = Math.min(rect.width * 0.45, rect.height * 0.55);
    polygon(path, [
      [skew, 0],
      [rect.width, 0],
      [rect.width - skew, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "snipRect") {
    const snip = Math.min(rect.width, rect.height) * 0.18;
    polygon(path, [
      [snip, 0],
      [rect.width, 0],
      [rect.width, rect.height - snip],
      [rect.width - snip, rect.height],
      [0, rect.height],
      [0, snip],
    ]);
    return path;
  }

  if (kind === "leftArrow") {
    const head = Math.min(rect.width * 0.42, rect.height * 0.5);
    const shaftTop = rect.height * 0.28;
    const shaftBottom = rect.height * 0.72;
    polygon(path, [
      [0, rect.height / 2],
      [head, 0],
      [head, shaftTop],
      [rect.width, shaftTop],
      [rect.width, shaftBottom],
      [head, shaftBottom],
      [head, rect.height],
    ]);
    return path;
  }

  if (kind === "upDownArrow") {
    const head = Math.min(rect.width * 0.42, rect.height * 0.28);
    const shaftLeft = rect.width * 0.32;
    const shaftRight = rect.width * 0.68;
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, head],
      [shaftRight, head],
      [shaftRight, rect.height - head],
      [rect.width, rect.height - head],
      [rect.width / 2, rect.height],
      [0, rect.height - head],
      [shaftLeft, rect.height - head],
      [shaftLeft, head],
      [0, head],
    ]);
    return path;
  }

  if (kind === "lightningBolt") {
    polygon(path, [
      [rect.width * 0.58, 0],
      [rect.width * 0.18, rect.height * 0.55],
      [rect.width * 0.46, rect.height * 0.55],
      [rect.width * 0.32, rect.height],
      [rect.width * 0.82, rect.height * 0.38],
      [rect.width * 0.54, rect.height * 0.38],
    ]);
    return path;
  }

  if (kind === "bentUpArrow" || kind === "bentArrow") {
    const head = Math.min(rect.width * 0.36, rect.height * 0.32);
    const shaft = Math.min(rect.width, rect.height) * 0.28;
    const verticalX =
      kind === "bentArrow" ? rect.width - shaft : rect.width - head;
    polygon(path, [
      [verticalX, 0],
      [rect.width, head],
      [verticalX + shaft / 2, head],
      [verticalX + shaft / 2, rect.height],
      [0, rect.height],
      [0, rect.height - shaft],
      [verticalX - shaft / 2, rect.height - shaft],
      [verticalX - shaft / 2, head],
      [verticalX - head, head],
    ]);
    return path;
  }

  if (kind === "trapezoid") {
    const inset = Math.min(rect.width / 3, rect.width * 0.18);
    polygon(path, [
      [inset, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "hexagon") {
    const inset = Math.min(rect.width / 3, rect.width * 0.24);
    polygon(path, [
      [inset, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height / 2],
      [rect.width - inset, rect.height],
      [inset, rect.height],
      [0, rect.height / 2],
    ]);
    return path;
  }

  if (kind === "bracePair" || kind === "bracketPair") {
    drawBracketLikePath(path, rect, kind);
    return path;
  }

  path.rect(0, 0, rect.width, rect.height);
  return path;
}

export function customGeometryPath(
  shape: RecordValue | null,
  rect: PresentationRect,
): Path2D | null {
  const paths = Array.isArray(shape?.customPaths) ? shape.customPaths : [];
  if (paths.length === 0) return null;

  const result = new Path2D();
  let hasCommands = false;
  for (const rawPath of paths) {
    const customPath = asRecord(rawPath);
    const width = asNumber(customPath?.widthEmu, rect.width);
    const height = asNumber(customPath?.heightEmu, rect.height);
    const scaleX = width === 0 ? 1 : rect.width / width;
    const scaleY = height === 0 ? 1 : rect.height / height;
    const commands = Array.isArray(customPath?.commands)
      ? customPath.commands
      : [];
    for (const rawCommand of commands) {
      const command = asRecord(rawCommand);
      if (!command) continue;
      const moveTo = asRecord(command.moveTo);
      const lineTo = asRecord(command.lineTo);
      const close = asRecord(command.close);
      const quadBezTo = asRecord(command.quadBezTo);
      const cubicBezTo = asRecord(command.cubicBezTo);
      if (moveTo) {
        result.moveTo(asNumber(moveTo.x) * scaleX, asNumber(moveTo.y) * scaleY);
        hasCommands = true;
      } else if (lineTo) {
        result.lineTo(asNumber(lineTo.x) * scaleX, asNumber(lineTo.y) * scaleY);
        hasCommands = true;
      } else if (quadBezTo) {
        result.quadraticCurveTo(
          asNumber(quadBezTo.x1) * scaleX,
          asNumber(quadBezTo.y1) * scaleY,
          asNumber(quadBezTo.x) * scaleX,
          asNumber(quadBezTo.y) * scaleY,
        );
        hasCommands = true;
      } else if (cubicBezTo) {
        result.bezierCurveTo(
          asNumber(cubicBezTo.x1) * scaleX,
          asNumber(cubicBezTo.y1) * scaleY,
          asNumber(cubicBezTo.x2) * scaleX,
          asNumber(cubicBezTo.y2) * scaleY,
          asNumber(cubicBezTo.x) * scaleX,
          asNumber(cubicBezTo.y) * scaleY,
        );
        hasCommands = true;
      } else if (close) {
        result.closePath();
      }
    }
  }

  return hasCommands ? result : null;
}

function polygon(path: Path2D, points: Array<[number, number]>): void {
  const [first, ...rest] = points;
  if (!first) return;
  path.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    path.lineTo(x, y);
  }
  path.closePath();
}

function starPath(
  path: Path2D,
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
): void {
  const steps = points * 2;
  for (let index = 0; index < steps; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index / steps) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) {
      path.moveTo(x, y);
    } else {
      path.lineTo(x, y);
    }
  }
  path.closePath();
}

function drawBracketLikePath(
  path: Path2D,
  rect: PresentationRect,
  kind: "bracePair" | "bracketPair",
): void {
  const strokeWidth = Math.max(1, Math.min(rect.width, rect.height) * 0.08);
  const inset = Math.min(rect.width * 0.2, strokeWidth * 2);
  if (kind === "bracketPair") {
    roundedRect(path, 0, 0, inset, rect.height, strokeWidth);
    roundedRect(path, rect.width - inset, 0, inset, rect.height, strokeWidth);
    return;
  }

  path.moveTo(inset, 0);
  path.quadraticCurveTo(0, rect.height * 0.25, inset, rect.height * 0.5);
  path.quadraticCurveTo(0, rect.height * 0.75, inset, rect.height);
  path.lineTo(inset + strokeWidth, rect.height);
  path.quadraticCurveTo(
    strokeWidth,
    rect.height * 0.75,
    inset + strokeWidth,
    rect.height * 0.5,
  );
  path.quadraticCurveTo(
    strokeWidth,
    rect.height * 0.25,
    inset + strokeWidth,
    0,
  );
  path.closePath();
  path.moveTo(rect.width - inset, 0);
  path.quadraticCurveTo(
    rect.width,
    rect.height * 0.25,
    rect.width - inset,
    rect.height * 0.5,
  );
  path.quadraticCurveTo(
    rect.width,
    rect.height * 0.75,
    rect.width - inset,
    rect.height,
  );
  path.lineTo(rect.width - inset - strokeWidth, rect.height);
  path.quadraticCurveTo(
    rect.width - strokeWidth,
    rect.height * 0.75,
    rect.width - inset - strokeWidth,
    rect.height * 0.5,
  );
  path.quadraticCurveTo(
    rect.width - strokeWidth,
    rect.height * 0.25,
    rect.width - inset - strokeWidth,
    0,
  );
  path.closePath();
}

function roundedRect(
  path: Path2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}
