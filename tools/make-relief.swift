// make-relief — turns an ordinary portrait photo into a plaster bas-relief stand-in.
//
// 1. Vision cuts the person out of the photo and finds the face.
// 2. The face is framed the way the wall frames every portrait (head and shoulders,
//    face a quarter of the square, bust trimmed to a rounded edge).
// 3. The cut-out becomes a height map: a raised slab, a gentle dome, and the photo's
//    own light and dark as shallow carving.
// 4. The height map is lit from the upper left, as the wall is, and cast onto plaster.
//
// usage: make-relief <photo> <out.png> [--size 1024] [--zoom 1] [--dx 0] [--dy 0] [--cut-bottom 0] [--debug]
//   --zoom  >1 brings the face closer, <1 steps back
//   --dx/--dy  nudge the framing, in fractions of the square (0.05 = 5%)
//   --cut-bottom  ignore the lowest part of the photo (0.25 = bottom quarter),
//                 for photos with a caption or name banner printed across the chest
//   --width  half-width of the bust (default 0.27); narrower trims a bystander's shoulder

import Foundation
import Vision
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// ── arguments ───────────────────────────────────────────
var args = Array(CommandLine.arguments.dropFirst())
func opt(_ name: String, _ def: Double) -> Double {
  if let i = args.firstIndex(of: name), i + 1 < args.count, let v = Double(args[i + 1]) {
    args.removeSubrange(i...(i + 1)); return v
  }
  return def
}
let S = Int(opt("--size", 1024))
let zoom = opt("--zoom", 1)
let nudgeX = opt("--dx", 0), nudgeY = opt("--dy", 0)
let cutBottom = opt("--cut-bottom", 0)
let bustWidth = opt("--width", 0.27)   // half-width of the bust, as a fraction of the square
let debug = args.contains("--debug"); args.removeAll { $0 == "--debug" }
guard args.count == 2 else {
  FileHandle.standardError.write("usage: make-relief <photo> <out.png> [--size N] [--zoom Z] [--dx X] [--dy Y]\n".data(using: .utf8)!)
  exit(2)
}
let inPath = args[0], outPath = args[1]

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write("make-relief: \(msg)\n".data(using: .utf8)!); exit(1)
}

// ── load ────────────────────────────────────────────────
guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: inPath) as CFURL, nil),
      let photo = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("cannot read \(inPath)") }
let W = photo.width, H = photo.height

/* luminance of the photo, 0…1 */
var lum = [Float](repeating: 0, count: W * H)
do {
  var rgba = [UInt8](repeating: 0, count: W * H * 4)
  let ctx = CGContext(data: &rgba, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(photo, in: CGRect(x: 0, y: 0, width: W, height: H))
  for i in 0..<(W * H) {
    lum[i] = (0.299 * Float(rgba[i*4]) + 0.587 * Float(rgba[i*4+1]) + 0.114 * Float(rgba[i*4+2])) / 255
  }
}

// ── who is in the photo ─────────────────────────────────
let handler = VNImageRequestHandler(cgImage: photo, options: [:])
let fgReq = VNGenerateForegroundInstanceMaskRequest()
let faceReq = VNDetectFaceRectanglesRequest()
let personReq = VNGeneratePersonSegmentationRequest()
personReq.qualityLevel = .accurate
personReq.outputPixelFormat = kCVPixelFormatType_OneComponent8
do { try handler.perform([fgReq, faceReq, personReq]) } catch { fail("vision: \(error)") }

/* the face, in photo pixels with the origin top-left */
var face: CGRect? = nil
if let f = faceReq.results?.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) {
  let b = f.boundingBox
  face = CGRect(x: b.minX * CGFloat(W), y: (1 - b.maxY) * CGFloat(H), width: b.width * CGFloat(W), height: b.height * CGFloat(H))
}

func readMask(_ pb: CVPixelBuffer) -> [Float] {
  CVPixelBufferLockBaseAddress(pb, .readOnly); defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
  let mw = CVPixelBufferGetWidth(pb), mh = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
  let base = CVPixelBufferGetBaseAddress(pb)!
  let isFloat = CVPixelBufferGetPixelFormatType(pb) == kCVPixelFormatType_OneComponent32Float
  var out = [Float](repeating: 0, count: W * H)
  for y in 0..<H {
    let sy = min(mh - 1, Int(Double(y) * Double(mh) / Double(H)))
    let row = base.advanced(by: sy * bpr)
    for x in 0..<W {
      let sx = min(mw - 1, Int(Double(x) * Double(mw) / Double(W)))
      out[y * W + x] = isFloat ? row.assumingMemoryBound(to: Float.self)[sx]
                               : Float(row.assumingMemoryBound(to: UInt8.self)[sx]) / 255
    }
  }
  return out
}

/* Keep only the cut-out pieces that hold the face: name banners, badges and
   frames printed on the photo are separate pieces and stay behind. */
var mask = [Float](repeating: 0, count: W * H)
var gotMask = false
if let obs = fgReq.results?.first {
  var pieces: [[Float]] = []
  for inst in obs.allInstances {
    if let pb = try? obs.generateScaledMaskForImage(forInstances: IndexSet(integer: inst), from: handler) {
      pieces.append(readMask(pb))
    }
  }
  func coverage(_ m: [Float], _ r: CGRect) -> Float {
    var s: Float = 0, n: Float = 0
    for y in max(0, Int(r.minY))..<min(H, Int(r.maxY)) {
      for x in max(0, Int(r.minX))..<min(W, Int(r.maxX)) { s += m[y * W + x]; n += 1 }
    }
    return n > 0 ? s / n : 0
  }
  let keep = face.map { f in pieces.filter { coverage($0, f) > 0.25 } } ?? []
  let chosen = !keep.isEmpty ? keep : (pieces.max { $0.reduce(0, +) < $1.reduce(0, +) }.map { [$0] } ?? [])
  for p in chosen { for i in 0..<(W * H) { mask[i] = max(mask[i], p[i]) } }
  gotMask = !chosen.isEmpty
}
/* the cut-out found nothing: fall back to a person-shaped matte. It is never merged
   with the cut-out, since it takes in everyone in the photo, bystanders too. */
if !gotMask, let pb = personReq.results?.first?.pixelBuffer {
  mask = readMask(pb)
  gotMask = true
}
if !gotMask { fail("no person found in \(inPath)") }

/* no face found: frame on the top of the silhouette instead */
if face == nil {
  var minY = H, minX = W, maxX = 0
  for y in 0..<H { for x in 0..<W where mask[y * W + x] > 0.5 { minY = min(minY, y); minX = min(minX, x); maxX = max(maxX, x) } }
  let mw = CGFloat(max(1, maxX - minX))
  face = CGRect(x: CGFloat(minX) + mw * 0.3, y: CGFloat(minY) + mw * 0.12, width: mw * 0.4, height: mw * 0.45)
}
let f = face!

// ── frame into the square ───────────────────────────────
let Sf = Float(S)
/* every face is carved the same size and set at the same height, so the wall reads as one series */
let k = Float(0.21 * Double(S) * zoom) / Float(f.height)          // output px per photo px
let fcx = Float(f.midX), fcy = Float(f.midY)
let cx = Sf * Float(0.5 + nudgeX), cy = Sf * Float(0.42 + nudgeY)

func sample(_ a: [Float], _ x: Float, _ y: Float) -> Float {
  let x0 = Int(floor(x)), y0 = Int(floor(y))
  let tx = x - Float(x0), ty = y - Float(y0)
  func at(_ xx: Int, _ yy: Int) -> Float { a[min(H - 1, max(0, yy)) * W + min(W - 1, max(0, xx))] }
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
}
func smooth(_ e0: Float, _ e1: Float, _ x: Float) -> Float {
  let t = max(0, min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)
}

/* where the usable photo stops: its own lower edge, or the top of a printed caption */
let floorY = Float(H - 1) * Float(1 - cutBottom)

let N = S * S
var m = [Float](repeating: 0, count: N)
var L = [Float](repeating: 0.5, count: N)
var seen = [Float](repeating: 0, count: N)   /* 1 where the photo itself shows, 0 where the figure is carried on past it */
for v in 0..<S {
  for u in 0..<S {
    var x = fcx + (Float(u) - cx) / k, y = fcy + (Float(v) - cy) / k
    /* above the photo there is nothing: never grow a column over the head */
    if y < 0 { continue }
    /* past the bottom or the sides the figure carries on as it was at the edge, so a
       photo cropped at the chest still becomes a full bust, the same as every other */
    let past = max(0, y - floorY, -x, x - Float(W - 1)) * k
    x = min(Float(W - 1), max(0, x)); y = min(floorY, y)
    /* the bust, trimmed the way a sculptor trims one: a curved lower edge, lowest under
       the chin and sweeping up to the shoulder tips, which are cut off at the sides */
    let dx = abs(Float(u) - Sf * 0.5)
    let du = dx / (Sf * Float(bustWidth))
    let bottom = Sf * (0.86 - 0.13 * du * du)
    var trim = (1 - smooth(-Sf * 0.012, Sf * 0.012, Float(v) - bottom)) * (1 - smooth(0.93, 1.0, du))
    /* where the figure is carried on past a cropped photo its shoulders are invented,
       and they fall more steeply, as a sculpted bust's do */
    let chin = cy + Sf * 0.105
    let invented = smooth(0, Sf * 0.03, past)
    /* and every bust's shoulders fall a little away from the neck, outside the head's width,
       so square-shouldered photos don't carve as blocks */
    let below = smooth(chin, chin + Sf * 0.05, Float(v))
    let fall = chin + Sf * 0.02 + (0.30 + 0.30 * invented) * max(0, dx - Sf * 0.12)
    trim *= 1 - below * (1 - smooth(-Sf * 0.012, Sf * 0.012, Float(v) - fall))
    let i = v * S + u
    m[i] = sample(mask, x, y) * trim
    L[i] = sample(lum, x, y)
    seen[i] = 1 - smooth(0, Sf * 0.05, past)
  }
}

// ── blur: three box passes, close to a gaussian ─────────
func boxPass(_ a: inout [Float], _ r: Int, horizontal: Bool) {
  if r < 1 { return }
  var line = [Float](repeating: 0, count: S)
  for o in 0..<S {
    var acc: Float = 0
    func get(_ t: Int) -> Float { let c = min(S - 1, max(0, t)); return horizontal ? a[o * S + c] : a[c * S + o] }
    for t in -r...r { acc += get(t) }
    let inv = 1 / Float(2 * r + 1)
    for t in 0..<S {
      line[t] = acc * inv
      acc += get(t + r + 1) - get(t - r)
    }
    for t in 0..<S { if horizontal { a[o * S + t] = line[t] } else { a[t * S + o] = line[t] } }
  }
}
func blur(_ a: [Float], _ radius: Float) -> [Float] {
  var b = a
  let r = max(1, Int((radius / 1.73).rounded()))
  for _ in 0..<3 { boxPass(&b, r, horizontal: true); boxPass(&b, r, horizontal: false) }
  /* a running-sum blur can drift a hair below zero; pow() of that would be NaN */
  for i in 0..<b.count where b[i] < 0 { b[i] = 0 }
  return b
}
/* an edge-keeping smoothing (a guided filter): broad planes go clean like modelled
   plaster, while the lines of eyes, brows and mouth stay sharp */
func guided(_ I: [Float], _ r: Float, _ eps: Float) -> [Float] {
  let mI = blur(I, r), mII = blur(I.map { $0 * $0 }, r)
  var a = [Float](repeating: 0, count: N), b = a
  for i in 0..<N {
    let v = max(0, mII[i] - mI[i] * mI[i])
    a[i] = v / (v + eps); b[i] = mI[i] - a[i] * mI[i]
  }
  let ma = blur(a, r), mb = blur(b, r)
  var q = I
  for i in 0..<N { q[i] = ma[i] * I[i] + mb[i] }
  return q
}

// ── the height of the carving ───────────────────────────
/* a small photo is blown up many times over; soften it in proportion, or its
   JPEG blocks get carved into the plaster */
let upscale = max(1, k)
/* the outline: crisp enough to throw a clean shadow */
let m1 = blur(m, max(Sf * 0.003, upscale * 0.7))
/* the body rising from the wall: zero at the outline, full deep inside, so the
   edges round over like worked plaster and nothing swells on the wall around it */
let rise = { (r: Float) -> [Float] in blur(m, r).map { max(0, min(1, 2 * $0 - 1)) } }
let v2 = rise(Sf * 0.02), v3 = rise(Sf * 0.055), v4 = rise(Sf * 0.12)

/* the photo's tones, stretched within the figure so dark and pale photos carve alike */
var inside: [Float] = []
for i in 0..<N where m[i] > 0.6 && seen[i] > 0.5 { inside.append(L[i]) }
inside.sort()
let lo = inside.isEmpty ? 0 : inside[Int(Float(inside.count) * 0.03)]
let hi = inside.isEmpty ? 1 : inside[Int(Float(inside.count) * 0.97)]
var Ln = L.map { max(0, min(1, ($0 - lo) / max(0.05, hi - lo))) }
Ln = blur(Ln, max(Sf * 0.0012, upscale * 0.6))
let G = guided(Ln, Sf * 0.006, 0.0016)
let Gbig = blur(G, Sf * 0.03)

/* the face: an oval around it, where the carving is deepest and the light of the
   photo is read as form (a lit cheek stands forward, a shadowed eye sinks) */
let fw = Float(f.width) * k, fh = Float(f.height) * k
var faceZone = [Float](repeating: 0, count: N)
var faceSum: Float = 0, faceN: Float = 0
for v in 0..<S {
  for u in 0..<S {
    let ex = (Float(u) - cx) / (fw * 0.72), ey = (Float(v) - cy - fh * 0.05) / (fh * 0.9)
    let z = 1 - smooth(0.55, 1.15, sqrt(ex * ex + ey * ey))
    let i = v * S + u
    faceZone[i] = z * m1[i] * seen[i]
    if z > 0.5 { faceSum += G[i]; faceN += 1 }
  }
}
let faceMean = faceN > 0 ? faceSum / faceN : 0.5

var Hm = [Float](repeating: 0, count: N)
for i in 0..<N {
  let rounded: Float = 9 * pow(v2[i], 0.6)
  let form: Float = 2.5 * m1[i] + rounded + 10 * v3[i] + 7 * v4[i]
  let zone: Float = faceZone[i]
  let lines: Float = (G[i] - Gbig[i]) * 9 * (0.45 + 0.55 * zone) * seen[i] * m1[i]
  let light: Float = (G[i] - faceMean) * 8 * zone
  Hm[i] = form + lines + light
}
let Hsoft = blur(Hm, Sf * 0.012)
let shadowSrc: [Float] = {
  var s = [Float](repeating: 0, count: N)
  let ox = Int(Sf * 0.012), oy = Int(Sf * 0.018)
  for v in 0..<S { for u in 0..<S { let su = u - ox, sv = v - oy
    if su >= 0, sv >= 0 { s[v * S + u] = m1[sv * S + su] } } }
  return blur(s, Sf * 0.02)
}()
let contact = blur(m1, Sf * 0.004)

// ── light it from the upper left ────────────────────────
/* a low, raking light: forms read more strongly than under a light from straight ahead */
let lx: Float = -0.55, ly: Float = -0.70, lz: Float = 0.62
let ll = sqrt(lx * lx + ly * ly + lz * lz)
let flat = lz / ll
var shade = [Float](repeating: 1, count: N)
for v in 0..<S {
  for u in 0..<S {
    let i = v * S + u
    let xl = max(0, u - 1), xr = min(S - 1, u + 1), yu = max(0, v - 1), yd = min(S - 1, v + 1)
    let gx = (Hm[v * S + xr] - Hm[v * S + xl]) / 2
    let gy = (Hm[yd * S + u] - Hm[yu * S + u]) / 2
    let nl = sqrt(gx * gx + gy * gy + 1)
    let nx = -gx / nl, ny = -gy / nl, nz = 1 / nl
    let ndl = (nx * lx + ny * ly + nz * lz) / ll
    var s = 0.30 + 0.70 * max(0, ndl) / flat
    /* a faint sheen where the plaster faces the light squarely */
    let hx = lx / ll, hy = ly / ll, hz = lz / ll + 1
    let hn = sqrt(hx * hx + hy * hy + hz * hz)
    s += 0.05 * pow(max(0, (nx * hx + ny * hy + nz * hz) / hn), 24) * m1[i]
    /* hollows hold shadow: under the brow, beside the nose, in the folds of cloth */
    s *= 1 - 0.035 * max(0, min(6, Hsoft[i] - Hm[i]))
    /* the raised figure shades the wall below and to its right */
    let wall = 1 - m1[i]
    s *= 1 - 0.22 * shadowSrc[i] * wall - 0.12 * contact[i] * wall
    shade[i] = s
  }
}
/* a little sharpening, so a small photo still reads as a crisp carving */
let shadeSoft = blur(shade, 1.6)
var rgb = [UInt8](repeating: 0, count: N * 4)
for v in 0..<S {
  for u in 0..<S {
    let i = v * S + u
    let s = shade[i] + 0.55 * (shade[i] - shadeSoft[i]) * m1[i]
    /* plaster: the figure a breath paler than the wall, the wall a touch lighter at its heart */
    let du = Float(u) / Sf - 0.5, dv = Float(v) / Sf - 0.5
    let heart = 1 + 0.02 * (1 - min(1, (du * du + dv * dv) * 4))
    let t = s * (1 + 0.06 * m1[i]) * heart
    let base: (Float, Float, Float) = (221, 219.5, 215)
    rgb[i*4]   = UInt8(max(0, min(249, base.0 * t)))
    rgb[i*4+1] = UInt8(max(0, min(248, base.1 * t)))
    rgb[i*4+2] = UInt8(max(0, min(245, base.2 * t)))
    rgb[i*4+3] = 255
    if debug { let d = UInt8(max(0, min(255, Hm[i] * 7))); rgb[i*4] = d; rgb[i*4+1] = d; rgb[i*4+2] = d }
  }
}

// ── write ───────────────────────────────────────────────
let ctx = CGContext(data: &rgb, width: S, height: S, bitsPerComponent: 8, bytesPerRow: S * 4,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
guard let out = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: outPath) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fail("cannot write \(outPath)") }
CGImageDestinationAddImage(dest, out, nil)
if !CGImageDestinationFinalize(dest) { fail("cannot write \(outPath)") }
print("relief: \(inPath) → \(outPath)  face=\(Int(f.width))×\(Int(f.height))")
