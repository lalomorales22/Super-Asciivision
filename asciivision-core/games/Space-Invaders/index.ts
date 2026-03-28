import { createCliRenderer, FrameBufferRenderable, RGBA, type KeyEvent } from "@opentui/core"

// ---------- CONFIGURATION -----------------------------------------------------

const CELL_W = 100
const CELL_H = 35
const PX_W = CELL_W
const PX_H = CELL_H * 2
const FOV = 60

// Game Settings
const GALAXY_SPEED_BASE = 15.0
const GALAXY_SPEED_BOOST = 40.0
const SPAWN_RATE = 0.02 // Chance per frame to spawn a planet
const DEBRIS_SPAWN_RATE = 0.08 // Chance per frame to spawn asteroid debris

// ---------- TYPES & MATH ------------------------------------------------------

type V3 = { x: number; y: number; z: number }
type Color = { r: number; g: number; b: number }

// Simple Vector Math
const add = (a: V3, b: V3) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function rotZ(v: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }
}

// Perspective Projection
function project(v: V3) {
  if (v.z <= 0.1) return null // Behind camera
  const scale = FOV / v.z
  return {
    x: v.x * scale + PX_W / 2,
    y: v.y * scale + PX_H / 2,
    scale: scale,
    z: v.z
  }
}

// ---------- RENDERER (BUFFER & CACHE) -----------------------------------------

const rgbaCache = new Map<number, RGBA>()
function getRgba(r: number, g: number, b: number): RGBA {
  const key = (r << 16) | (g << 8) | b
  let v = rgbaCache.get(key)
  if (!v) {
    v = RGBA.fromValues(r / 255, g / 255, b / 255, 1)
    rgbaCache.set(key, v)
  }
  return v
}

const pix = new Uint8Array(PX_W * PX_H * 3) // RGB Buffer

function clearBuffer() {
  // Deep space gradient (black to dark purple/blue)
  for (let i = 0; i < PX_W * PX_H; i++) {
    const idx = i * 3
    const y = (i / PX_W) | 0
    const intensity = (y / PX_H) * 20
    pix[idx] = 3
    pix[idx + 1] = 3
    pix[idx + 2] = 8 + intensity
  }
}

function setPixel(x: number, y: number, r: number, g: number, b: number) {
  const ix = x | 0
  const iy = y | 0
  if (ix < 0 || ix >= PX_W || iy < 0 || iy >= PX_H) return
  const idx = (iy * PX_W + ix) * 3
  pix[idx] = r
  pix[idx + 1] = g
  pix[idx + 2] = b
}

// Additive blend pixel (for glow effects)
function addPixel(x: number, y: number, r: number, g: number, b: number) {
  const ix = x | 0
  const iy = y | 0
  if (ix < 0 || ix >= PX_W || iy < 0 || iy >= PX_H) return
  const idx = (iy * PX_W + ix) * 3
  pix[idx] = Math.min(255, pix[idx] + r)
  pix[idx + 1] = Math.min(255, pix[idx + 1] + g)
  pix[idx + 2] = Math.min(255, pix[idx + 2] + b)
}

function drawLine(x0: number, y0: number, x1: number, y1: number, c: Color) {
  x0 = x0 | 0; y0 = y0 | 0; x1 = x1 | 0; y1 = y1 | 0
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let steps = 0
  const maxSteps = PX_W + PX_H // safety limit
  while (steps++ < maxSteps) {
    setPixel(x0, y0, c.r, c.g, c.b)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}

// Fast sphere rendering (Billboarding) with planet type texturing
function drawPlanet(cx: number, cy: number, radius: number, baseColor: Color, lightDir: V3, pType: PlanetType, hasRings: boolean, seed: number) {
  const rSq = radius * radius
  const startX = Math.max(0, Math.floor(cx - radius))
  const endX = Math.min(PX_W, Math.ceil(cx + radius))
  const startY = Math.max(0, Math.floor(cy - radius))
  const endY = Math.min(PX_H, Math.ceil(cy + radius))

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const dx = x - cx
      const dy = y - cy
      const dSq = dx * dx + dy * dy

      if (dSq <= rSq) {
        const z = Math.sqrt(rSq - dSq)
        const nx = dx / radius
        const ny = dy / radius
        const nz = z / radius

        // Dot product for lighting
        const light = clamp(nx * lightDir.x + ny * lightDir.y + nz * lightDir.z, 0.1, 1.0)

        // Rim lighting
        const rim = 1.0 - nz

        let cr = baseColor.r
        let cg = baseColor.g
        let cb = baseColor.b

        // Planet type-specific texturing
        if (pType === 'gas') {
          // Horizontal bands
          const band = Math.sin(ny * 8 + seed) * 0.3
          cr = clamp(cr + band * 60, 0, 255)
          cg = clamp(cg + band * 30, 0, 255)
        } else if (pType === 'water') {
          // Ice caps at poles
          if (Math.abs(ny) > 0.7) {
            cr = lerp(cr, 230, (Math.abs(ny) - 0.7) * 3)
            cg = lerp(cg, 240, (Math.abs(ny) - 0.7) * 3)
            cb = lerp(cb, 255, (Math.abs(ny) - 0.7) * 3)
          }
          // Subtle cloud wisps
          const cloud = Math.sin(nx * 6 + seed) * Math.cos(ny * 4) * 0.15
          cr = clamp(cr + cloud * 80, 0, 255)
          cg = clamp(cg + cloud * 80, 0, 255)
          cb = clamp(cb + cloud * 40, 0, 255)
        } else if (pType === 'rock') {
          // Craters - pseudo-random based on position + seed
          const craterHash = Math.sin(nx * 13.7 + seed) * Math.cos(ny * 11.3 + seed * 0.7)
          if (craterHash > 0.6) {
            cr = clamp(cr - 30, 0, 255)
            cg = clamp(cg - 30, 0, 255)
            cb = clamp(cb - 25, 0, 255)
          }
        } else if (pType === 'lava') {
          // Glowing cracks / hot spots
          const crack = Math.sin(nx * 10 + seed * 2) * Math.cos(ny * 8 + seed)
          if (crack > 0.5) {
            cr = clamp(cr + 80, 0, 255)
            cg = clamp(cg + 40, 0, 255)
            cb = 20
          }
          // Extra glow on dark side
          if (light < 0.3) {
            cr = clamp(cr + 30, 0, 255)
            cg = clamp(cg + 10, 0, 255)
          }
        } else if (pType === 'ice') {
          // Sparkle effect on ice
          const sparkle = Math.sin(nx * 20 + seed) * Math.cos(ny * 20 + seed * 1.5)
          if (sparkle > 0.7) {
            cr = Math.min(255, cr + 40)
            cg = Math.min(255, cg + 40)
            cb = Math.min(255, cb + 50)
          }
        }

        const r = clamp(cr * light + (rim * 40), 0, 255)
        const g = clamp(cg * light + (rim * 40), 0, 255)
        const b = clamp(cb * light + (rim * 60), 0, 255)

        setPixel(x, y, r, g, b)
      }
    }
  }

  // Draw rings for ringed planets
  if (hasRings && radius > 2) {
    const ringInner = radius * 1.4
    const ringOuter = radius * 2.2
    const ringTilt = 0.3 // Tilt angle so rings appear elliptical

    for (let x = Math.max(0, Math.floor(cx - ringOuter)); x < Math.min(PX_W, Math.ceil(cx + ringOuter)); x++) {
      for (let yOff = -1; yOff <= 1; yOff++) {
        const ry = cy + yOff
        if (ry < 0 || ry >= PX_H) continue
        const rdx = x - cx
        const rdy = (ry - cy) / ringTilt // un-tilt to get distance
        const ringDist = Math.sqrt(rdx * rdx + rdy * rdy)

        if (ringDist >= ringInner && ringDist <= ringOuter) {
          // Skip pixels that overlap the planet body
          const bodyDx = x - cx
          const bodyDy = ry - cy
          if (bodyDx * bodyDx + bodyDy * bodyDy < rSq) continue

          // Ring brightness varies with distance
          const ringT = (ringDist - ringInner) / (ringOuter - ringInner)
          const ringBright = 0.4 + Math.sin(ringT * 6) * 0.3
          const rr = clamp(baseColor.r * 0.6 * ringBright + 60, 0, 255)
          const rg = clamp(baseColor.g * 0.5 * ringBright + 50, 0, 255)
          const rb = clamp(baseColor.b * 0.4 * ringBright + 40, 0, 255)
          setPixel(x, ry, rr, rg, rb)
        }
      }
    }
  }
}

// ---------- GAME ENTITIES -----------------------------------------------------

type StarColor = { r: number; g: number; b: number }

const STAR_COLORS: StarColor[] = [
  { r: 255, g: 255, b: 255 },   // White
  { r: 200, g: 210, b: 255 },   // Blue-white
  { r: 255, g: 240, b: 200 },   // Yellow-white
  { r: 180, g: 200, b: 255 },   // Cool blue
  { r: 255, g: 220, b: 180 },   // Warm
]

class Star {
  x: number; y: number; z: number
  brightness: number // 0.3 = dim, 0.6 = medium, 1.0 = bright
  color: StarColor

  constructor() {
    this.x = (Math.random() - 0.5) * 400
    this.y = (Math.random() - 0.5) * 400
    this.z = Math.random() * 200
    this.brightness = Math.random() < 0.5 ? 0.3 : Math.random() < 0.7 ? 0.6 : 1.0
    this.color = STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0]
  }

  update(speed: number) {
    this.z -= speed
    if (this.z <= 0) {
      this.z = 200
      this.x = (Math.random() - 0.5) * 400
      this.y = (Math.random() - 0.5) * 400
      this.brightness = Math.random() < 0.5 ? 0.3 : Math.random() < 0.7 ? 0.6 : 1.0
      this.color = STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0]
    }
  }
}

type PlanetType = 'gas' | 'rock' | 'water' | 'lava' | 'ice'

class Planet {
  pos: V3
  radius: number
  color: Color
  type: PlanetType
  dead: boolean = false
  hasRings: boolean = false
  seed: number

  constructor(zStart: number) {
    this.pos = {
      x: (Math.random() - 0.5) * 150,
      y: (Math.random() - 0.5) * 100,
      z: zStart
    }
    this.radius = 5 + Math.random() * 15
    this.seed = Math.random() * 100

    const typeRnd = Math.random()
    if (typeRnd > 0.8) {
      this.type = 'gas'
      // Varied gas colors: orange/red with bands
      const variant = Math.random()
      if (variant > 0.5) {
        this.color = { r: 200, g: 120, b: 50 }  // Orange gas
      } else {
        this.color = { r: 180, g: 80, b: 60 }   // Red gas
      }
      // Gas giants can have rings (Saturn-like)
      if (this.radius > 10 && Math.random() > 0.4) {
        this.hasRings = true
      }
    } else if (typeRnd > 0.6) {
      this.type = 'water'
      this.color = { r: 40, g: 90, b: 200 }  // Deep blue
    } else if (typeRnd > 0.4) {
      this.type = 'rock'
      // Gray/brown variants
      const variant = Math.random()
      if (variant > 0.5) {
        this.color = { r: 130, g: 120, b: 100 }  // Brown rock
      } else {
        this.color = { r: 110, g: 110, b: 115 }  // Gray rock
      }
    } else if (typeRnd > 0.2) {
      this.type = 'lava'
      this.color = { r: 200, g: 60, b: 30 }  // Red/orange lava
    } else {
      this.type = 'ice'
      this.color = { r: 180, g: 210, b: 240 }  // Light blue ice
    }
  }

  update(speed: number) {
    this.pos.z -= speed
  }
}

// Explosion particle with color fade: white -> yellow -> orange -> red -> dark
class Particle {
  pos: V3
  vel: V3
  life: number
  maxLife: number
  baseColor: Color
  size: number

  constructor(pos: V3, color: Color, spread: number = 5) {
    this.pos = { ...pos }
    this.vel = {
      x: (Math.random() - 0.5) * spread,
      y: (Math.random() - 0.5) * spread,
      z: (Math.random() - 0.5) * spread
    }
    this.maxLife = 0.8 + Math.random() * 0.5
    this.life = this.maxLife
    this.baseColor = color
    this.size = Math.random() > 0.6 ? 2 : 1
  }

  update() {
    this.pos.x += this.vel.x
    this.pos.y += this.vel.y
    this.pos.z += this.vel.z
    // Slow down over time
    this.vel.x *= 0.96
    this.vel.y *= 0.96
    this.vel.z *= 0.96
    this.life -= 0.06
  }

  // Get current color based on life remaining (fading through hot colors)
  getColor(): Color {
    const t = this.life / this.maxLife // 1 = fresh, 0 = dead
    if (t > 0.7) {
      // White-hot
      return { r: 255, g: 255, b: lerp(100, 255, (t - 0.7) / 0.3) }
    } else if (t > 0.4) {
      // Yellow -> orange
      return { r: 255, g: lerp(120, 255, (t - 0.4) / 0.3), b: 0 }
    } else {
      // Orange -> dark red
      return { r: lerp(60, 255, t / 0.4), g: lerp(0, 120, t / 0.4), b: 0 }
    }
  }
}

// Asteroid debris - small gray dots flying past
class Debris {
  x: number; y: number; z: number
  brightness: number

  constructor() {
    this.x = (Math.random() - 0.5) * 300
    this.y = (Math.random() - 0.5) * 300
    this.z = Math.random() * 200
    this.brightness = 40 + Math.random() * 60
  }

  update(speed: number) {
    this.z -= speed
    if (this.z <= 0) {
      this.z = 200
      this.x = (Math.random() - 0.5) * 300
      this.y = (Math.random() - 0.5) * 300
      this.brightness = 40 + Math.random() * 60
    }
  }
}

class Player {
  x = 0
  y = 0
  tilt = 0
  targetTilt = 0
  lasers: { l: boolean, t: number }[] = [] // Active lasers frame timer

  update(dt: number, input: any) {
    const speed = 60 * dt
    if (input.w) this.y -= speed
    if (input.s) this.y += speed
    if (input.a) { this.x -= speed; this.targetTilt = 0.4 }
    else if (input.d) { this.x += speed; this.targetTilt = -0.4 }
    else { this.targetTilt = 0 }

    if (input.q) this.targetTilt += 0.5
    if (input.e) this.targetTilt -= 0.5

    // Smooth tilt
    this.tilt += (this.targetTilt - this.tilt) * 0.1

    // Update laser visuals
    if (this.lasers.length > 0) {
      this.lasers.forEach(l => l.t--)
      this.lasers = this.lasers.filter(l => l.t > 0)
    }
  }
}

// ---------- MAIN GAME STATE ---------------------------------------------------

const stars = Array.from({ length: 200 }, () => new Star())
const debris: Debris[] = Array.from({ length: 40 }, () => new Debris())
const planets: Planet[] = []
const particles: Particle[] = []
const player = new Player()
let score = 0
let destroyedCount = 0
let gameOver = false
let speed = GALAXY_SPEED_BASE

// Screen shake state
let shakeFrames = 0
let shakeOffsetX = 0
let shakeOffsetY = 0

const input = {
  w: false, a: false, s: false, d: false,
  q: false, e: false, shift: false, space: false
}

// ---------- OPENTUI SETUP -----------------------------------------------------

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
const canvas = new FrameBufferRenderable(renderer, { id: "screen", width: CELL_W, height: CELL_H })
renderer.root.add(canvas)

renderer.keyInput.on("keypress", (k: KeyEvent) => {
  const name = k.name
  if (name === "escape") { renderer.destroy(); process.exit(0); }
  if (name === "space") fireLaser()
})

renderer.keyInput.on("data", (str) => {
  // Raw data listener kept for compatibility
})

const keysDown = new Set<string>()
renderer.keyInput.on("keypress", (k) => {
  keysDown.add(k.name)
  // Auto-clear after a split second to simulate keyup
  setTimeout(() => keysDown.delete(k.name), 100)
})

function updateInput() {
  input.w = keysDown.has("w") || keysDown.has("up")
  input.s = keysDown.has("s") || keysDown.has("down")
  input.a = keysDown.has("a") || keysDown.has("left")
  input.d = keysDown.has("d") || keysDown.has("right")
  input.q = keysDown.has("q")
  input.e = keysDown.has("e")
  input.shift = keysDown.has("shift")
}

function fireLaser() {
  player.lasers.push({ l: true, t: 5 })  // Left gun
  player.lasers.push({ l: false, t: 5 }) // Right gun

  for (const p of planets) {
    if (p.pos.z > 0 && p.pos.z < 150) {
      const dx = p.pos.x - player.x
      const dy = p.pos.y - player.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < p.radius * 1.5) {
        explodePlanet(p)
        break
      }
    }
  }
}

function explodePlanet(p: Planet) {
  p.dead = true
  score += 100
  destroyedCount++

  // Trigger screen shake
  shakeFrames = 6

  // Spawn many particles with varied spread
  const count = 30 + (p.radius | 0)
  for (let i = 0; i < count; i++) {
    const spread = 3 + Math.random() * 6
    particles.push(new Particle(p.pos, p.color, spread))
  }
  // Extra bright core burst
  for (let i = 0; i < 8; i++) {
    const core = new Particle(p.pos, { r: 255, g: 255, b: 200 }, 2)
    core.size = 2
    particles.push(core)
  }
}

// ---------- RENDER PIPELINE ---------------------------------------------------

function drawFrame(dt: number) {
  clearBuffer()

  // Screen shake offset
  if (shakeFrames > 0) {
    shakeOffsetX = ((Math.random() * 4 - 2) | 0)
    shakeOffsetY = ((Math.random() * 4 - 2) | 0)
    shakeFrames--
  } else {
    shakeOffsetX = 0
    shakeOffsetY = 0
  }

  // 1. Stars with brightness & color variation
  for (const s of stars) {
    const viewX = s.x - player.x * 0.5
    const viewY = s.y - player.y * 0.5
    const r = rotZ({ x: viewX, y: viewY, z: s.z }, player.tilt)
    const p = project(r)

    if (p) {
      // Distance-based dimming: closer stars appear brighter
      const distFactor = clamp(1.0 - s.z / 200, 0.2, 1.0)
      const bright = s.brightness * distFactor

      const sr = clamp(s.color.r * bright, 0, 255) | 0
      const sg = clamp(s.color.g * bright, 0, 255) | 0
      const sb = clamp(s.color.b * bright, 0, 255) | 0

      const px = (p.x + shakeOffsetX) | 0
      const py = (p.y + shakeOffsetY) | 0
      setPixel(px, py, sr, sg, sb)

      // Speed lines: longer and brighter at higher speed
      if (speed > 20) {
        const tailLen = Math.min(((speed - 15) / 5) | 0, 5)
        for (let t = 1; t <= tailLen; t++) {
          const fade = 1.0 - (t / (tailLen + 1))
          setPixel(px, py + t, (sr * fade * 0.5) | 0, (sg * fade * 0.5) | 0, (sb * fade * 0.5) | 0)
        }
      }
    }
  }

  // 2. Asteroid debris (small gray dots for visual density)
  for (const d of debris) {
    const viewX = d.x - player.x * 0.3
    const viewY = d.y - player.y * 0.3
    const r = rotZ({ x: viewX, y: viewY, z: d.z }, player.tilt)
    const p = project(r)
    if (p) {
      const distFade = clamp(1.0 - d.z / 200, 0.3, 1.0)
      const b = (d.brightness * distFade) | 0
      setPixel((p.x + shakeOffsetX) | 0, (p.y + shakeOffsetY) | 0, b, b - 10, b - 15)
    }
  }

  // 3. Speed indicator lines (edge streaks during boost)
  if (speed > 25) {
    const intensity = clamp((speed - 25) / 15, 0, 1)
    const lineCount = (intensity * 12) | 0
    // Deterministic-ish speed lines along edges
    for (let i = 0; i < lineCount; i++) {
      const side = i % 2 === 0 // alternate left/right
      const sx = side ? 2 + (i * 3) % 15 : PX_W - 3 - (i * 3) % 15
      const lineLen = (4 + intensity * 8) | 0
      const yBase = (i * 7 + (Date.now() / 50)) % PX_H
      for (let ly = 0; ly < lineLen; ly++) {
        const fade = 1.0 - ly / lineLen
        const bright = (100 * intensity * fade) | 0
        setPixel(sx + shakeOffsetX, ((yBase + ly) % PX_H) + shakeOffsetY, bright, bright, bright + 30)
      }
    }
  }

  // 4. Planets (Painter's Algorithm: Sort Far -> Near)
  planets.sort((a, b) => b.pos.z - a.pos.z)

  const light = { x: -0.5, y: -0.8, z: 0.5 }

  for (const p of planets) {
    if (p.pos.z < 1) continue

    const relX = p.pos.x - player.x
    const relY = p.pos.y - player.y
    const rPos = rotZ({ x: relX, y: relY, z: p.pos.z }, player.tilt)

    const proj = project(rPos)
    if (proj) {
      const screenR = p.radius * proj.scale
      if (screenR > 0.5) {
        drawPlanet(
          proj.x + shakeOffsetX,
          proj.y + shakeOffsetY,
          screenR,
          p.color,
          light,
          p.type,
          p.hasRings,
          p.seed
        )
      }
    }
  }

  // 5. Particles (Explosions with color fading)
  for (const part of particles) {
    const relX = part.pos.x - player.x
    const relY = part.pos.y - player.y
    const rPos = rotZ({ x: relX, y: relY, z: part.pos.z }, player.tilt)
    const proj = project(rPos)
    if (proj) {
      const c = part.getColor()
      const px = (proj.x + shakeOffsetX) | 0
      const py = (proj.y + shakeOffsetY) | 0
      setPixel(px, py, c.r, c.g, c.b)
      if (part.size > 1) {
        setPixel(px + 1, py, c.r, c.g, c.b)
        setPixel(px, py + 1, (c.r * 0.7) | 0, (c.g * 0.7) | 0, (c.b * 0.7) | 0)
        setPixel(px - 1, py, (c.r * 0.5) | 0, (c.g * 0.5) | 0, (c.b * 0.5) | 0)
      }
    }
  }

  // 6. Cockpit / HUD / Reticle
  const cx = (PX_W / 2 + shakeOffsetX) | 0
  const cy = (PX_H / 2 + shakeOffsetY) | 0

  // Crosshair (green with outer brackets)
  const chColor = { r: 0, g: 220, b: 80 }
  setPixel(cx, cy, chColor.r, chColor.g, chColor.b)
  setPixel(cx - 1, cy, chColor.r, chColor.g, chColor.b)
  setPixel(cx + 1, cy, chColor.r, chColor.g, chColor.b)
  setPixel(cx, cy - 1, chColor.r, chColor.g, chColor.b)
  setPixel(cx, cy + 1, chColor.r, chColor.g, chColor.b)
  // Outer brackets
  const bDist = 4
  setPixel(cx - bDist, cy - bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx - bDist + 1, cy - bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx - bDist, cy - bDist + 1, chColor.r, chColor.g, chColor.b)
  setPixel(cx + bDist, cy - bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx + bDist - 1, cy - bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx + bDist, cy - bDist + 1, chColor.r, chColor.g, chColor.b)
  setPixel(cx - bDist, cy + bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx - bDist + 1, cy + bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx - bDist, cy + bDist - 1, chColor.r, chColor.g, chColor.b)
  setPixel(cx + bDist, cy + bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx + bDist - 1, cy + bDist, chColor.r, chColor.g, chColor.b)
  setPixel(cx + bDist, cy + bDist - 1, chColor.r, chColor.g, chColor.b)

  // Lasers
  player.lasers.forEach(laser => {
    const startX = laser.l ? 15 : PX_W - 15
    const startY = PX_H
    // Main beam
    drawLine(startX, startY, cx, cy, { r: 255, g: 50, b: 50 })
    // Glow line offset
    drawLine(startX + (laser.l ? 1 : -1), startY, cx, cy, { r: 180, g: 30, b: 30 })
  })

  // Detailed Wireframe Cockpit
  const hudC = { r: 40, g: 130, b: 180 }
  const hudBright = { r: 60, g: 170, b: 220 }
  const bH = PX_H // bottom height

  // Main cockpit frame - lower trapezoid
  drawLine(0, bH, 25, bH - 12, hudC)
  drawLine(PX_W - 1, bH, PX_W - 25, bH - 12, hudC)
  drawLine(25, bH - 12, PX_W - 25, bH - 12, hudC)

  // Inner cockpit detail lines
  drawLine(25, bH - 12, 35, bH - 8, hudC)
  drawLine(PX_W - 25, bH - 12, PX_W - 35, bH - 8, hudC)
  drawLine(35, bH - 8, PX_W - 35, bH - 8, hudC)

  // Angled struts on the sides
  drawLine(8, bH - 3, 20, bH - 10, hudC)
  drawLine(PX_W - 8, bH - 3, PX_W - 20, bH - 10, hudC)

  // Center console notch
  const notchW = 8
  const notchCx = PX_W / 2
  drawLine(notchCx - notchW, bH - 8, notchCx - 3, bH - 6, hudC)
  drawLine(notchCx + notchW, bH - 8, notchCx + 3, bH - 6, hudC)
  drawLine(notchCx - 3, bH - 6, notchCx + 3, bH - 6, hudC)

  // Top canopy frame (subtle)
  drawLine(0, 0, 10, 5, { r: 25, g: 70, b: 100 })
  drawLine(PX_W - 1, 0, PX_W - 10, 5, { r: 25, g: 70, b: 100 })

  // Mini-radar in bottom-left corner of cockpit
  drawMiniRadar()
}

function drawMiniRadar() {
  // Radar box position
  const rx = 5
  const ry = PX_H - 18
  const rw = 16
  const rh = 10
  const radarColor = { r: 0, g: 80, b: 60 }
  const dotColor = { r: 0, g: 200, b: 100 }

  // Radar border
  drawLine(rx, ry, rx + rw, ry, radarColor)
  drawLine(rx, ry + rh, rx + rw, ry + rh, radarColor)
  drawLine(rx, ry, rx, ry + rh, radarColor)
  drawLine(rx + rw, ry, rx + rw, ry + rh, radarColor)

  // Fill radar background (very dark)
  for (let y = ry + 1; y < ry + rh; y++) {
    for (let x = rx + 1; x < rx + rw; x++) {
      setPixel(x, y, 5, 15, 10)
    }
  }

  // Center dot (player)
  const pcx = rx + (rw / 2) | 0
  const pcy = ry + (rh / 2) | 0
  setPixel(pcx, pcy, 0, 255, 0)

  // Planet dots on radar
  for (const p of planets) {
    if (p.dead) continue
    const relX = p.pos.x - player.x
    const relY = p.pos.y - player.y
    // Map world coords to radar space
    const mapX = pcx + clamp((relX / 100) * (rw / 2), -(rw / 2) + 1, (rw / 2) - 1) | 0
    const mapY = pcy + clamp((p.pos.z / 200) * (rh / 2), -(rh / 2) + 1, (rh / 2) - 1) | 0
    if (mapX > rx && mapX < rx + rw && mapY > ry && mapY < ry + rh) {
      setPixel(mapX, mapY, dotColor.r, dotColor.g, dotColor.b)
    }
  }
}

function blit() {
  const fb = canvas.frameBuffer
  // Double pixel packing
  for (let y = 0; y < CELL_H; y++) {
    const py0 = y * 2
    const py1 = py0 + 1
    for (let x = 0; x < CELL_W; x++) {
      const i0 = (py0 * PX_W + x) * 3
      const i1 = (py1 * PX_W + x) * 3

      const fg = getRgba(pix[i0], pix[i0 + 1], pix[i0 + 2])
      const bg = getRgba(pix[i1], pix[i1 + 1], pix[i1 + 2])

      fb.setCell(x, y, "▀", fg, bg)
    }
  }

  // Text HUD - color coded
  const white = getRgba(255, 255, 255)
  const cyan = getRgba(0, 200, 220)
  const yellow = getRgba(255, 220, 50)
  const red = getRgba(255, 80, 60)
  const green = getRgba(80, 255, 120)
  const dimWhite = getRgba(150, 150, 160)

  // Top-left: Score & Destroyed
  fb.drawText(`SCORE`, 2, 1, dimWhite)
  fb.drawText(`${score}`, 8, 1, yellow)
  fb.drawText(`DESTROYED`, 2, 2, dimWhite)
  fb.drawText(`${destroyedCount}`, 12, 2, red)

  // Top-right: Speed
  const speedLabel = `SPD`
  const speedVal = `${speed.toFixed(0)}`
  const boostTag = speed > 25 ? ` BOOST` : ``
  fb.drawText(speedLabel, CELL_W - 16, 1, dimWhite)
  fb.drawText(speedVal, CELL_W - 12, 1, speed > 25 ? red : cyan)
  if (boostTag) fb.drawText(boostTag, CELL_W - 9, 1, red)

  // Planet count
  const pCount = `OBJ:${planets.length}`
  fb.drawText(pCount, CELL_W - 16, 2, dimWhite)

  // Bottom bar
  fb.drawText(`[WASD]Move [QE]Roll [Space]Fire [Shift]Boost [Esc]Quit`, 2, CELL_H - 1, dimWhite)
}

// ---------- GAME LOOP ---------------------------------------------------------

let lastTime = Date.now()

renderer.requestLive()

const tick = setInterval(() => {
  const now = Date.now()
  const dt = (now - lastTime) / 1000
  lastTime = now

  updateInput()

  // Logic
  speed = input.shift ? GALAXY_SPEED_BOOST : GALAXY_SPEED_BASE
  player.update(dt, input)

  // Update Stars
  stars.forEach(s => s.update(speed * dt * 4))

  // Update Debris
  debris.forEach(d => d.update(speed * dt * 3))

  // Spawn new debris
  if (Math.random() < DEBRIS_SPAWN_RATE) {
    if (debris.length < 80) {
      debris.push(new Debris())
    }
  }

  // Manage Planets
  if (Math.random() < SPAWN_RATE) {
    planets.push(new Planet(200))
  }

  for (let i = planets.length - 1; i >= 0; i--) {
    const p = planets[i]
    p.update(speed * dt)
    if (p.pos.z < -5 || p.dead) {
      planets.splice(i, 1)
    }
  }

  // Update Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update()
    if (particles[i].life <= 0) particles.splice(i, 1)
  }

  drawFrame(dt)
  blit()

}, 1000 / 30)

renderer.on("destroy", () => clearInterval(tick))
