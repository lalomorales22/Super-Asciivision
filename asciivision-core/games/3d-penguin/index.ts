import { createCliRenderer, FrameBufferRenderable, RGBA, type KeyEvent } from "@opentui/core"

/**
 * penguin fish collector – terminal game
 * waddle around an icy world collecting orange fish!
 */

type V3 = { x: number; y: number; z: number }

// ---------- config ------------------------------------------------------------

const CELL_W = 100
const CELL_H = 34
const PX_W = CELL_W
const PX_H = CELL_H * 2

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

// ---------- rgba cache --------------------------------------------------------

const rgbaCache = new Map<number, RGBA>()
function rgba(r: number, g: number, b: number): RGBA {
  const key = (r << 16) | (g << 8) | b
  let v = rgbaCache.get(key)
  if (!v) {
    v = RGBA.fromValues(r / 255, g / 255, b / 255, 1)
    rgbaCache.set(key, v)
  }
  return v
}

// ---------- pixel buffer + z buffer ------------------------------------------

const pix = new Uint8Array(PX_W * PX_H * 3)
const zbuf = new Float32Array(PX_W * PX_H)

function clearPixelBuffer() {
  zbuf.fill(1e9)
}

function setPixel(x: number, y: number, z: number, r: number, g: number, b: number) {
  x = x | 0; y = y | 0
  if (x < 0 || y < 0 || x >= PX_W || y >= PX_H) return
  const zi = y * PX_W + x
  if (z >= zbuf[zi]) return
  zbuf[zi] = z
  const i = zi * 3
  pix[i + 0] = r
  pix[i + 1] = g
  pix[i + 2] = b
}

function setPixelNoZ(x: number, y: number, r: number, g: number, b: number) {
  x = x | 0; y = y | 0
  if (x < 0 || y < 0 || x >= PX_W || y >= PX_H) return
  const i = (y * PX_W + x) * 3
  pix[i + 0] = r
  pix[i + 1] = g
  pix[i + 2] = b
}

// ---------- math --------------------------------------------------------------

function rotX(v: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c }
}
function rotY(v: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }
}
function rotZ(v: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }
}

function project(v: V3, zoom: number, camDist: number) {
  const z = v.z + camDist
  const px = (v.x / z) * zoom + PX_W / 2
  const py = (v.y / z) * zoom + PX_H / 2
  return { x: px, y: py, z }
}

// ---------- voxel penguin model -----------------------------------------------

type Mat = "black" | "white" | "orange" | "blue"
type Voxel = { p: V3; mat: Mat; baseB: number }

function addEllipsoid(list: Voxel[], cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, step: number, mat: Mat, baseB: number) {
  for (let x = cx - rx; x <= cx + rx; x += step) {
    for (let y = cy - ry; y <= cy + ry; y += step) {
      for (let z = cz - rz; z <= cz + rz; z += step) {
        const nx = (x - cx) / rx
        const ny = (y - cy) / ry
        const nz = (z - cz) / rz
        const d = nx * nx + ny * ny + nz * nz
        if (d <= 1.0) {
          const r = Math.sqrt(d)
          const bump = clamp((r - 0.6) / 0.4, 0, 1)
          list.push({ p: { x, y, z }, mat, baseB: clamp(baseB + bump * 0.25, 0, 1) })
        }
      }
    }
  }
}

function buildPenguin(): Voxel[] {
  const v: Voxel[] = []
  const step = 0.28

  // body + belly
  addEllipsoid(v, 0, -0.2, 0, 1.55, 2.0, 1.25, step, "black", 0.55)
  addEllipsoid(v, 0, 0.2, 0.75, 1.05, 1.35, 0.75, step, "white", 0.88)

  // head + face patch
  addEllipsoid(v, 0, -2.05, 0.15, 1.05, 1.0, 0.95, step, "black", 0.55)
  addEllipsoid(v, 0, -1.9, 0.9, 0.75, 0.55, 0.55, step, "white", 0.92)

  // eyes
  addEllipsoid(v, -0.35, -2.05, 1.08, 0.18, 0.18, 0.12, 0.22, "blue", 1.0)
  addEllipsoid(v, 0.35, -2.05, 1.08, 0.18, 0.18, 0.12, 0.22, "blue", 1.0)

  // beak
  addEllipsoid(v, 0, -1.65, 1.22, 0.34, 0.22, 0.26, 0.22, "orange", 0.95)

  // wings
  addEllipsoid(v, -1.55, -0.45, 0.2, 0.55, 1.25, 0.6, step, "black", 0.52)
  addEllipsoid(v, 1.55, -0.45, 0.2, 0.55, 1.25, 0.6, step, "black", 0.52)

  // feet
  addEllipsoid(v, -0.55, 1.95, 0.55, 0.55, 0.25, 0.75, 0.26, "orange", 0.85)
  addEllipsoid(v, 0.55, 1.95, 0.55, 0.55, 0.25, 0.75, 0.26, "orange", 0.85)

  return v
}

const penguinModel = buildPenguin()

function matRGB(mat: Mat) {
  if (mat === "white") return { r: 245, g: 250, b: 255 }
  if (mat === "orange") return { r: 251, g: 146, b: 60 }
  if (mat === "blue") return { r: 96, g: 165, b: 250 }
  return { r: 150, g: 162, b: 178 }
}

const lightDir = (() => {
  const l = { x: -0.5, y: -0.8, z: 1.0 }
  const d = Math.sqrt(l.x * l.x + l.y * l.y + l.z * l.z)
  return { x: l.x / d, y: l.y / d, z: l.z / d }
})()

function brightnessForPoint(p: V3, baseB: number) {
  const d = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) || 1
  const n = { x: p.x / d, y: p.y / d, z: p.z / d }
  const ndotl = clamp(n.x * lightDir.x + n.y * lightDir.y + n.z * lightDir.z, 0, 1)
  return clamp(baseB * 0.65 + ndotl * 0.75, 0, 1)
}

// ---------- game world --------------------------------------------------------

const WORLD_W = 400      // world size in "world pixels"
const WORLD_H = 300
const FISH_COUNT = 12     // fish on screen at a time
const COLLECT_DIST = 12   // pixel distance to collect a fish
const PENGUIN_SPEED = 55  // pixels per second

interface Fish {
  x: number
  y: number
  alive: boolean
  bobPhase: number  // for bobbing animation
}

// game state
let penguinX = WORLD_W / 2
let penguinY = WORLD_H / 2
let penguinFacing = 0       // radians, 0 = right
let score = 0
let totalCollected = 0
let level = 1
let time = 0
let waddle = 0              // waddle animation phase
let isMoving = false
let collectFlash = 0        // flash timer when collecting fish
let comboTimer = 0          // combo window
let combo = 0

// input state — terminal has no keyrelease, so we use timestamps
const keyTimes: Record<string, number> = {}
const KEY_HOLD_MS = 120  // treat key as held for this long after last press

// fish
const fishes: Fish[] = []

function spawnFish(): Fish {
  const margin = 30
  return {
    x: margin + Math.random() * (WORLD_W - margin * 2),
    y: margin + Math.random() * (WORLD_H - margin * 2),
    alive: true,
    bobPhase: Math.random() * Math.PI * 2,
  }
}

function initFishes() {
  fishes.length = 0
  for (let i = 0; i < FISH_COUNT; i++) {
    fishes.push(spawnFish())
  }
}

initFishes()

// decorations - snowflakes, rocks, ice patches (static world objects)
interface Decoration {
  x: number
  y: number
  type: "snow" | "rock" | "ice" | "bush"
  size: number
}

const decorations: Decoration[] = []
for (let i = 0; i < 60; i++) {
  decorations.push({
    x: Math.random() * WORLD_W,
    y: Math.random() * WORLD_H,
    type: ["snow", "rock", "ice", "bush"][Math.floor(Math.random() * 4)] as Decoration["type"],
    size: 1 + Math.random() * 3,
  })
}

// ---------- OpenTUI setup -----------------------------------------------------

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
})

const canvas = new FrameBufferRenderable(renderer, {
  id: "screen",
  width: CELL_W,
  height: CELL_H,
})

renderer.root.add(canvas)

function cleanupAndExit() {
  try { renderer.dropLive() } catch {}
  renderer.destroy()
}

renderer.keyInput.on("keypress", (key: KeyEvent) => {
  const k = key.name
  if (k === "escape") return cleanupAndExit()
  keyTimes[k] = Date.now()
})

// ---------- ground rendering --------------------------------------------------

// seeded random for consistent terrain
function hashXY(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = ((h ^ (h >> 13)) * 1274126177) | 0
  return ((h ^ (h >> 16)) >>> 0) / 4294967296
}

function drawGround(camX: number, camY: number) {
  for (let sy = 0; sy < PX_H; sy++) {
    for (let sx = 0; sx < PX_W; sx++) {
      const wx = (sx + camX) | 0
      const wy = (sy + camY) | 0

      // base icy blue-white ground
      const noise = hashXY(wx, wy)
      const noise2 = hashXY(wx >> 2, wy >> 2)  // larger scale variation

      // ice/snow color palette
      const baseR = 180 + (noise2 * 40) | 0
      const baseG = 210 + (noise2 * 30) | 0
      const baseB = 235 + (noise2 * 20) | 0

      // subtle texture
      const texR = clamp(baseR + ((noise - 0.5) * 20) | 0, 0, 255)
      const texG = clamp(baseG + ((noise - 0.5) * 15) | 0, 0, 255)
      const texB = clamp(baseB + ((noise - 0.5) * 10) | 0, 0, 255)

      // darken edges of world
      const edgeFade = Math.min(
        wx / 30, wy / 30,
        (WORLD_W - wx) / 30,
        (WORLD_H - wy) / 30,
      )
      const fade = clamp(edgeFade, 0.3, 1.0)

      setPixelNoZ(sx, sy,
        (texR * fade) | 0,
        (texG * fade) | 0,
        (texB * fade) | 0,
      )
    }
  }
}

// ---------- decoration rendering ----------------------------------------------

function drawDecorations(camX: number, camY: number) {
  for (const dec of decorations) {
    const sx = (dec.x - camX) | 0
    const sy = (dec.y - camY) | 0

    if (sx < -10 || sy < -10 || sx >= PX_W + 10 || sy >= PX_H + 10) continue

    const s = dec.size | 0
    if (dec.type === "snow") {
      // small white sparkle
      setPixelNoZ(sx, sy, 240, 248, 255)
      if (s > 1) {
        setPixelNoZ(sx + 1, sy, 230, 240, 250)
        setPixelNoZ(sx, sy + 1, 230, 240, 250)
      }
    } else if (dec.type === "rock") {
      // gray rock cluster
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const b = 90 + (hashXY(dec.x + dx, dec.y + dy) * 40) | 0
          setPixelNoZ(sx + dx, sy + dy, b, b + 5, b + 10)
        }
      }
    } else if (dec.type === "ice") {
      // blue ice patch
      for (let dy = -s; dy <= s; dy++) {
        for (let dx = -s; dx <= s; dx++) {
          if (dx * dx + dy * dy <= s * s) {
            setPixelNoZ(sx + dx, sy + dy, 160, 200, 240)
          }
        }
      }
    } else if (dec.type === "bush") {
      // dark green-ish snow bush
      for (let dy = -s; dy <= s; dy++) {
        for (let dx = -s; dx <= s; dx++) {
          if (Math.abs(dx) + Math.abs(dy) <= s) {
            const g = 100 + (hashXY(dec.x + dx, dec.y + dy) * 50) | 0
            setPixelNoZ(sx + dx, sy + dy, 50, g, 70)
          }
        }
      }
    }
  }
}

// ---------- fish rendering ----------------------------------------------------

function drawFish(fx: number, fy: number, phase: number) {
  // cute little orange fish shape, bobbing
  const bob = Math.sin(phase) * 1.5

  const cx = fx | 0
  const cy = (fy + bob) | 0

  // body (orange ellipse ~7x4)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const d = (dx * dx) / 9 + (dy * dy) / 4
      if (d <= 1.0) {
        const bright = 0.7 + (1 - d) * 0.3
        const r = clamp((255 * bright) | 0, 0, 255)
        const g = clamp((140 * bright) | 0, 0, 255)
        const b = clamp((30 * bright) | 0, 0, 255)
        setPixel(cx + dx, cy + dy, 5, r, g, b)
      }
    }
  }

  // tail (triangle)
  setPixel(cx + 4, cy - 1, 5, 230, 120, 20)
  setPixel(cx + 4, cy, 5, 240, 130, 25)
  setPixel(cx + 4, cy + 1, 5, 230, 120, 20)
  setPixel(cx + 5, cy - 2, 5, 210, 100, 15)
  setPixel(cx + 5, cy - 1, 5, 220, 110, 18)
  setPixel(cx + 5, cy + 1, 5, 220, 110, 18)
  setPixel(cx + 5, cy + 2, 5, 210, 100, 15)

  // eye
  setPixel(cx - 2, cy - 1, 4, 20, 20, 30)

  // sparkle (collectible indicator)
  const sparkle = (Math.sin(phase * 3) + 1) / 2
  if (sparkle > 0.7) {
    setPixel(cx, cy - 3, 4, 255, 255, 200)
    setPixel(cx - 1, cy - 4, 4, 255, 255, 180)
    setPixel(cx + 1, cy - 4, 4, 255, 255, 180)
  }
}

function drawFishes(camX: number, camY: number) {
  for (const fish of fishes) {
    if (!fish.alive) continue
    const sx = fish.x - camX
    const sy = fish.y - camY
    if (sx < -10 || sy < -10 || sx >= PX_W + 10 || sy >= PX_H + 10) continue
    drawFish(sx, sy, fish.bobPhase + time * 3)
  }
}

// ---------- penguin rendering -------------------------------------------------

function drawPenguinAt(screenX: number, screenY: number) {
  const zoom = 28
  const camDist = 8.0

  // waddle animation
  const waddleAngle = isMoving ? Math.sin(waddle * 8) * 0.15 : 0

  // facing direction → Y rotation
  const faceAngle = penguinFacing

  for (const vox of penguinModel) {
    let p = vox.p

    // waddle tilt
    p = rotZ(p, waddleAngle)

    // face direction
    p = rotY(p, faceAngle)

    // slight top-down tilt so we see from above
    p = rotX(p, 0.3)

    const b = brightnessForPoint(p, vox.baseB)
    const m = matRGB(vox.mat)
    const r = clamp((m.r * b) | 0, 0, 255)
    const g = clamp((m.g * b) | 0, 0, 255)
    const bb = clamp((m.b * b) | 0, 0, 255)

    const pr = project(p, zoom, camDist)
    const x = Math.round(pr.x - PX_W / 2 + screenX)
    const y = Math.round(pr.y - PX_H / 2 + screenY + 4) // offset down a bit

    setPixel(x, y, pr.z, r, g, bb)
  }

  // shadow underneath penguin
  for (let dx = -8; dx <= 8; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const d = (dx * dx) / 64 + (dy * dy) / 4
      if (d <= 1.0) {
        const sx = (screenX + dx) | 0
        const sy = (screenY + 14 + dy) | 0
        if (sx >= 0 && sx < PX_W && sy >= 0 && sy < PX_H) {
          const i = (sy * PX_W + sx) * 3
          // darken existing ground pixel
          pix[i + 0] = (pix[i + 0] * 0.7) | 0
          pix[i + 1] = (pix[i + 1] * 0.7) | 0
          pix[i + 2] = (pix[i + 2] * 0.7) | 0
        }
      }
    }
  }
}

// ---------- HUD ---------------------------------------------------------------

function drawHUD() {
  const fb = canvas.frameBuffer
  const white = rgba(255, 255, 255)
  const gold = rgba(255, 200, 50)
  const orange = rgba(255, 160, 50)
  const cyan = rgba(130, 220, 255)

  // score bar background (darken top rows)
  for (let x = 0; x < PX_W; x++) {
    for (let y = 0; y < 6; y++) {
      const i = (y * PX_W + x) * 3
      pix[i + 0] = (pix[i + 0] * 0.3) | 0
      pix[i + 1] = (pix[i + 1] * 0.3) | 0
      pix[i + 2] = (pix[i + 2] * 0.3) | 0
    }
  }

  // collect flash effect
  if (collectFlash > 0) {
    const intensity = collectFlash * 0.3
    for (let x = 0; x < PX_W; x++) {
      for (let y = 0; y < PX_H; y++) {
        const i = (y * PX_W + x) * 3
        pix[i + 0] = clamp(pix[i + 0] + (60 * intensity) | 0, 0, 255)
        pix[i + 1] = clamp(pix[i + 1] + (40 * intensity) | 0, 0, 255)
        pix[i + 2] = clamp(pix[i + 2] + (10 * intensity) | 0, 0, 255)
      }
    }
  }

  // text HUD (drawn after blit)
  fb.drawText(`SCORE: ${score}`, 2, 0, gold)

  const alive = fishes.filter(f => f.alive).length
  fb.drawText(`FISH: ${alive}/${FISH_COUNT}`, 18, 0, orange)

  fb.drawText(`LVL ${level}`, 36, 0, cyan)

  if (combo > 1) {
    fb.drawText(`x${combo} COMBO!`, 46, 0, rgba(255, 100, 100))
  }

  fb.drawText(`TOTAL: ${totalCollected}`, 60, 0, white)

  // controls help at bottom
  fb.drawText("WASD/arrows: move | esc: quit", 2, CELL_H - 1, rgba(160, 180, 200))
}

// ---------- game update -------------------------------------------------------

function update(dt: number) {
  time += dt

  // input → movement (timestamp-based since terminals have no keyrelease)
  const now = Date.now()
  const held = (k: string) => (now - (keyTimes[k] || 0)) < KEY_HOLD_MS
  let dx = 0, dy = 0
  if (held("w") || held("up")) dy -= 1
  if (held("s") || held("down")) dy += 1
  if (held("a") || held("left")) dx -= 1
  if (held("d") || held("right")) dx += 1

  isMoving = dx !== 0 || dy !== 0

  if (isMoving) {
    // normalize diagonal
    const len = Math.sqrt(dx * dx + dy * dy)
    dx /= len
    dy /= len

    penguinX += dx * PENGUIN_SPEED * dt
    penguinY += dy * PENGUIN_SPEED * dt

    // face direction: map screen movement to Y-rotation of 3D model
    // rotY=0: back to camera (up), π: face camera (down)
    // π/2: face right, -π/2: face left
    penguinFacing = Math.atan2(dx, -dy)

    // waddle
    waddle += dt

    // clamp to world
    const margin = 15
    penguinX = clamp(penguinX, margin, WORLD_W - margin)
    penguinY = clamp(penguinY, margin, WORLD_H - margin)
  }

  // combo timer
  if (comboTimer > 0) {
    comboTimer -= dt
    if (comboTimer <= 0) {
      combo = 0
    }
  }

  // collect flash decay
  if (collectFlash > 0) collectFlash -= dt * 4

  // fish collision
  for (const fish of fishes) {
    if (!fish.alive) continue
    const fdx = fish.x - penguinX
    const fdy = fish.y - penguinY
    const dist = Math.sqrt(fdx * fdx + fdy * fdy)
    if (dist < COLLECT_DIST) {
      fish.alive = false
      totalCollected++
      collectFlash = 1.0

      // combo system
      if (comboTimer > 0) {
        combo++
      } else {
        combo = 1
      }
      comboTimer = 2.0  // 2 second combo window

      // score: base 10 + combo bonus
      const points = 10 * combo
      score += points
    }
  }

  // check if all fish collected → next level
  if (fishes.every(f => !f.alive)) {
    level++
    initFishes()
  }
}

// ---------- render pipeline ---------------------------------------------------

function render() {
  clearPixelBuffer()

  // camera follows penguin (centered on screen)
  const camX = penguinX - PX_W / 2
  const camY = penguinY - PX_H / 2 + 10  // offset penguin slightly above center

  drawGround(camX, camY)
  drawDecorations(camX, camY)
  drawFishes(camX, camY)

  // penguin drawn at screen center
  const penguinScreenX = penguinX - camX
  const penguinScreenY = penguinY - camY
  drawPenguinAt(penguinScreenX, penguinScreenY)

  blitPixelsToTerminalCells()
  drawHUD()
}

function blitPixelsToTerminalCells() {
  const fb = canvas.frameBuffer

  for (let y = 0; y < CELL_H; y++) {
    const py0 = y * 2
    const py1 = py0 + 1
    for (let x = 0; x < CELL_W; x++) {
      const i0 = (py0 * PX_W + x) * 3
      const i1 = (py1 * PX_W + x) * 3

      const fr = pix[i0 + 0], fg = pix[i0 + 1], fbv = pix[i0 + 2]
      const br = pix[i1 + 0], bg = pix[i1 + 1], bb = pix[i1 + 2]

      fb.setCell(x, y, "▀", rgba(fr, fg, fbv), rgba(br, bg, bb))
    }
  }
}

// ---------- main loop ---------------------------------------------------------

renderer.requestLive()

let last = Date.now()
const tick = setInterval(() => {
  const now = Date.now()
  const dt = (now - last) / 1000
  last = now

  update(dt)
  render()
}, 1000 / 30)

renderer.on("destroy", () => clearInterval(tick))

// initial frame
update(0)
render()
