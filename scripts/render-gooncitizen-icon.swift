#!/usr/bin/env swift
import AppKit
import CoreText
import Foundation

func argValue (_ flag: String) -> String? {
  guard let idx = CommandLine.arguments.firstIndex(of: flag) else { return nil }
  let next = idx + 1
  guard next < CommandLine.arguments.count else { return nil }
  return CommandLine.arguments[next]
}

func parseHexColor (_ hex: String) -> NSColor {
  var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
  if h.hasPrefix("#") { h.removeFirst() }
  var value: UInt64 = 0
  Scanner(string: h).scanHexInt64(&value)
  let r = CGFloat((value >> 16) & 0xff) / 255.0
  let g = CGFloat((value >> 8) & 0xff) / 255.0
  let b = CGFloat(value & 0xff) / 255.0
  return NSColor(srgbRed: r, green: g, blue: b, alpha: 1)
}

func svgEscape (_ s: String) -> String {
  return s
    .replacingOccurrences(of: "&", with: "&amp;")
    .replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;")
    .replacingOccurrences(of: "\"", with: "&quot;")
}

func pathToSvgD (_ path: CGPath) -> String {
  var d = ""
  path.applyWithBlock { element in
    let pts = element.pointee.points
    switch element.pointee.type {
    case .moveToPoint:
      d += String(format: "M%.3f %.3f", pts[0].x, pts[0].y)
    case .addLineToPoint:
      d += String(format: "L%.3f %.3f", pts[0].x, pts[0].y)
    case .addQuadCurveToPoint:
      d += String(format: "Q%.3f %.3f %.3f %.3f", pts[0].x, pts[0].y, pts[1].x, pts[1].y)
    case .addCurveToPoint:
      d += String(format: "C%.3f %.3f %.3f %.3f %.3f %.3f", pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y)
    case .closeSubpath:
      d += "Z"
    @unknown default:
      break
    }
  }
  return d
}

/// Build a single CGPath for one or more glyphs, laid out on the baseline with advances.
func lettermarkPath (ctFont: CTFont, letter: String, tracking: CGFloat) -> CGPath? {
  var unichars = Array(letter.utf16)
  guard !unichars.isEmpty else { return nil }
  var glyphs = [CGGlyph](repeating: 0, count: unichars.count)
  let ok = CTFontGetGlyphsForCharacters(ctFont, &unichars, &glyphs, unichars.count)
  guard ok else { return nil }

  var advances = [CGSize](repeating: .zero, count: glyphs.count)
  CTFontGetAdvancesForGlyphs(ctFont, .default, glyphs, &advances, glyphs.count)

  let combined = CGMutablePath()
  var x: CGFloat = 0
  for i in 0..<glyphs.count {
    let glyph = glyphs[i]
    guard glyph != 0, let glyphPath = CTFontCreatePathForGlyph(ctFont, glyph, nil) else {
      return nil
    }
    var place = CGAffineTransform(translationX: x, y: 0)
    combined.addPath(glyphPath, transform: place)
    x += advances[i].width
    if i + 1 < glyphs.count {
      x += tracking
    }
  }
  return combined
}

let fontPath = argValue("--font") ?? ""
let purpleHex = argValue("--purple") ?? "#4C1D95"
let whiteHex = argValue("--white") ?? "#FFFFFF"
let pngPath = argValue("--png")
let svgPath = argValue("--svg")
let size = Int(argValue("--size") ?? "1024") ?? 1024
let letter = argValue("--letter") ?? "gc"
let title = argValue("--title") ?? "GoonCitizen"
let trackingEm = CGFloat(Double(argValue("--tracking") ?? "0") ?? 0)
let transparent = CommandLine.arguments.contains("--transparent")

guard !fontPath.isEmpty, FileManager.default.fileExists(atPath: fontPath) else {
  fputs("render-gooncitizen-icon.swift: --font PATH is required\n", stderr)
  exit(1)
}

let fontURL = URL(fileURLWithPath: fontPath) as CFURL
var registerErr: Unmanaged<CFError>?
if !CTFontManagerRegisterFontsForURL(fontURL, .process, &registerErr) {
  // Already registered is fine.
}

guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(fontURL) as? [CTFontDescriptor],
      let desc = descriptors.first else {
  fputs("render-gooncitizen-icon.swift: could not read font descriptors\n", stderr)
  exit(1)
}

let ctFont = CTFontCreateWithFontDescriptor(desc, 1000, nil)
let tracking = trackingEm * 1000
guard let rawPath = lettermarkPath(ctFont: ctFont, letter: letter, tracking: tracking) else {
  fputs("render-gooncitizen-icon.swift: no glyph path for letter\n", stderr)
  exit(1)
}

let rawBox = rawPath.boundingBoxOfPath
guard rawBox.width > 0, rawBox.height > 0 else {
  fputs("render-gooncitizen-icon.swift: empty glyph bounds\n", stderr)
  exit(1)
}

let canvas = CGFloat(size)
let multi = letter.count > 1
// Single-letter marks fill more of the square; digraphs need width headroom.
let targetHeight = canvas * (multi ? 0.52 : 0.68)
let scaleByHeight = targetHeight / rawBox.height
let maxWidth = canvas * (multi ? 0.82 : 0.72)
let scaleByWidth = maxWidth / rawBox.width
let scale = min(scaleByHeight, scaleByWidth)
// Shift slightly down for the tall f ascender; digraphs stay optically centered.
let opticalY = multi ? canvas * 0.0 : canvas * -0.035
let tx = (canvas - rawBox.width * scale) / 2.0 - rawBox.minX * scale
let ty = (canvas - rawBox.height * scale) / 2.0 - rawBox.minY * scale + opticalY

var drawTransform = CGAffineTransform(translationX: tx, y: ty)
drawTransform = drawTransform.scaledBy(x: scale, y: scale)
guard let drawPath = rawPath.copy(using: &drawTransform) else {
  fputs("render-gooncitizen-icon.swift: transform failed\n", stderr)
  exit(1)
}

let purple = parseHexColor(purpleHex)
let ink = parseHexColor(whiteHex)

if let pngPath {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    fputs("render-gooncitizen-icon.swift: CGContext failed\n", stderr)
    exit(1)
  }
  if !transparent {
    ctx.setFillColor(purple.cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: canvas, height: canvas))
  }
  ctx.setFillColor(ink.cgColor)
  ctx.addPath(drawPath)
  ctx.fillPath()
  guard let image = ctx.makeImage() else {
    fputs("render-gooncitizen-icon.swift: makeImage failed\n", stderr)
    exit(1)
  }
  let rep = NSBitmapImageRep(cgImage: image)
  guard let png = rep.representation(using: .png, properties: [:]) else {
    fputs("render-gooncitizen-icon.swift: png encode failed\n", stderr)
    exit(1)
  }
  do {
    try png.write(to: URL(fileURLWithPath: pngPath))
  } catch {
    fputs("render-gooncitizen-icon.swift: write png: \(error)\n", stderr)
    exit(1)
  }
}

if let svgPath {
  // SVG y-down: flip the already-positioned path around the canvas midline.
  var svgTransform = CGAffineTransform(translationX: 0, y: canvas)
  svgTransform = svgTransform.scaledBy(x: 1, y: -1)
  guard let svgPathRef = drawPath.copy(using: &svgTransform) else {
    fputs("render-gooncitizen-icon.swift: svg transform failed\n", stderr)
    exit(1)
  }
  let d = pathToSvgD(svgPathRef)
  let safeTitle = svgEscape(title)
  let svg = """
  <?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(size) \(size)" role="img" aria-label="\(safeTitle)">
    <title>\(safeTitle)</title>
    \(transparent ? "" : "<rect width=\"\(size)\" height=\"\(size)\" fill=\"\(svgEscape(purpleHex))\"/>\n    ")<path fill="\(svgEscape(whiteHex))" d="\(d)"/>
  </svg>

  """
  do {
    try svg.write(to: URL(fileURLWithPath: svgPath), atomically: true, encoding: .utf8)
  } catch {
    fputs("render-gooncitizen-icon.swift: write svg: \(error)\n", stderr)
    exit(1)
  }
}
