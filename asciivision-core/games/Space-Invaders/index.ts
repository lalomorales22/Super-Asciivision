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

// ---------- TYPES & MATH ------------------------------------------------------

type V3 = { x: number; y: number; z: number }
type Color = { r: number; g: number; b: number }

// Simple Vector Math
const add = (a: V3, b: V3) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

function rotZ(v: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z }
}

// Perspective Projection
function project(v: V3) {
  // Simple perspective projection
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
  // Deep space gradient (black to dark purple)
  for (let i = 0; i < PX_W * PX_H; i++) {
    const idx = i * 3
    const y = (i / PX_W) | 0
    const intensity = (y / PX_H) * 20
    pix[idx] = 5
    pix[idx + 1] = 5
    pix[idx + 2] = 10 + intensity
  }
}

function setPixel(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || x >= PX_W || y < 0 || y >= PX_H) return
  const idx = (y * PX_W + x) * 3
  pix[idx] = r
  pix[idx + 1] = g
  pix[idx + 2] = b
}

function drawLine(x0: number, y0: number, x1: number, y1: number, c: Color) {
  let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
  let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  while (true) {
    setPixel(x0, y0, c.r, c.g, c.b)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}

// Fast sphere rendering (Billboarding)
function drawPlanet(cx: number, cy: number, radius: number, baseColor: Color, lightDir: V3) {
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
        // Calculate "z" of the sphere surface at this pixel for shading
        const z = Math.sqrt(rSq - dSq)
        // Normal vector (normalized)
        const nx = dx / radius
        const ny = dy / radius
        const nz = z / radius

        // Dot product for lighting
        const light = clamp(nx * lightDir.x + ny * lightDir.y + nz * lightDir.z, 0.1, 1.0)
        
        // Rim lighting effect
        const rim = 1.0 - nz
        
        const r = clamp(baseColor.r * light + (rim * 40), 0, 255)
        const g = clamp(baseColor.g * light + (rim * 40), 0, 255)
        const b = clamp(baseColor.b * light + (rim * 60), 0, 255)

        setPixel(x, y, r, g, b)
      }
    }
  }
}

// ---------- GAME ENTITIES -----------------------------------------------------

class Star {
  x: number; y: number; z: number;
  constructor() {
    this.x = (Math.random() - 0.5) * 400
    this.y = (Math.random() - 0.5) * 400
    this.z = Math.random() * 200
  }
  update(speed: number) {
    this.z -= speed
    if (this.z <= 0) {
      this.z = 200
      this.x = (Math.random() - 0.5) * 400
      this.y = (Math.random() - 0.5) * 400
    }
  }
}

class Planet {
  pos: V3
  radius: number
  color: Color
  type: 'gas' | 'rock' | 'water'
  dead: boolean = false

  constructor(zStart: number) {
    this.pos = {
      x: (Math.random() - 0.5) * 150,
      y: (Math.random() - 0.5) * 100,
      z: zStart
    }
    this.radius = 5 + Math.random() * 15
    const typeRnd = Math.random()
    if (typeRnd > 0.6) {
      this.type = 'gas'
      this.color = { r: 200, g: 100, b: 50 } // Orange
    } else if (typeRnd > 0.3) {
      this.type = 'water'
      this.color = { r: 50, g: 100, b: 200 } // Blue
    } else {
      this.type = 'rock'
      this.color = { r: 120, g: 120, b: 120 } // Grey
    }
  }

  update(speed: number) {
    this.pos.z -= speed
  }
}

class Particle {
  pos: V3
  vel: V3
  life: number
  color: Color
  constructor(pos: V3, color: Color) {
    this.pos = { ...pos }
    this.vel = {
      x: (Math.random() - 0.5) * 5,
      y: (Math.random() - 0.5) * 5,
      z: (Math.random() - 0.5) * 5
    }
    this.life = 1.0
    this.color = color
  }
  update() {
    this.pos.x += this.vel.x
    this.pos.y += this.vel.y
    this.pos.z += this.vel.z
    this.life -= 0.08
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

const stars = Array.from({ length: 150 }, () => new Star())
const planets: Planet[] = []
const particles: Particle[] = []
const player = new Player()
let score = 0
let gameOver = false
let speed = GALAXY_SPEED_BASE

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

// Rough polling for smooth movement
renderer.keyInput.on("data", (str) => {
  // Reset input state (simple polling approach)
  // In a real TUI engine we'd handle up/down events, but terminals send repeated chars
  // We'll rely on a decay or toggle, but here we just check raw buffer occasionally
})

// Alternative: specific key handling
// Since node TUI keyup events don't exist, we toggle based on last press
// and decay if not pressed. For this demo, we assume "sticky" or repeated keys.
// To make it robust without 'keyup', we set state true and clear it at end of frame
// if no new event came in (which is hard).
// SIMPLIFIED INPUT: We will use the event listener to set flags, 
// but we need a way to clear them.
// We'll use a set of active keys with a timeout.

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
  // Space is handled via event to avoid rapid fire machine gun
}

function fireLaser() {
  player.lasers.push({ l: true, t: 5 }) // Left gun
  player.lasers.push({ l: false, t: 5 }) // Right gun

  // Raycast logic
  // We shoot roughly towards center of screen (0,0) in world space + parallax
  // Simplified: Check if any planet is close to center screen
  // Since we move the WORLD relative to player, "center screen" means
  // planet x/y is close to player x/y
  
  for (const p of planets) {
    if (p.pos.z > 0 && p.pos.z < 150) {
      // Hitbox check
      const dx = p.pos.x - player.x
      const dy = p.pos.y - player.y
      const dist = Math.sqrt(dx*dx + dy*dy)
      
      if (dist < p.radius * 1.5) {
        explodePlanet(p)
        break // One shot one kill
      }
    }
  }
}

function explodePlanet(p: Planet) {
  p.dead = true
  score += 100
  // Spawn particles
  for(let i=0; i<20; i++) {
    particles.push(new Particle(p.pos, p.color))
  }
}

// ---------- RENDER PIPELINE ---------------------------------------------------

function drawFrame(dt: number) {
  clearBuffer()

  // 1. Stars (Simple points)
  for (const s of stars) {
    // Parallax: shift stars opposite to player movement
    const viewX = s.x - player.x * 0.5
    const viewY = s.y - player.y * 0.5
    
    // Rotate world around Z for roll effect
    const r = rotZ({x: viewX, y: viewY, z: s.z}, player.tilt)
    const p = project(r)

    if (p) {
      // Speed stretch (simple)
      const tailLen = (speed / 10) | 0
      setPixel(p.x | 0, p.y | 0, 200, 200, 255)
      if (speed > 30) {
        setPixel((p.x - 1) | 0, p.y | 0, 100, 100, 150)
      }
    }
  }

  // 2. Planets (Painter's Algorithm: Sort Far -> Near)
  planets.sort((a, b) => b.pos.z - a.pos.z)

  const light = { x: -0.5, y: -0.8, z: 0.5 } // Sunlight direction

  for (const p of planets) {
    if (p.pos.z < 1) continue
    
    // World space relative to player
    const relX = p.pos.x - player.x
    const relY = p.pos.y - player.y
    
    // Apply Roll
    const rPos = rotZ({x: relX, y: relY, z: p.pos.z}, player.tilt)
    
    const proj = project(rPos)
    if (proj) {
      const screenR = p.radius * proj.scale
      if (screenR > 0.5) {
        drawPlanet(proj.x, proj.y, screenR, p.color, light)
      }
    }
  }

  // 3. Particles (Explosions)
  for (const part of particles) {
    const relX = part.pos.x - player.x
    const relY = part.pos.y - player.y
    const rPos = rotZ({x: relX, y: relY, z: part.pos.z}, player.tilt)
    const proj = project(rPos)
    if (proj) {
        const c = Math.floor(255 * part.life)
        setPixel(proj.x | 0, proj.y | 0, c, c * 0.5, 0)
        setPixel((proj.x+1) | 0, proj.y | 0, c, c * 0.5, 0)
    }
  }

  // 4. Cockpit / HUD / Reticle
  const cx = PX_W / 2
  const cy = PX_H / 2
  
  // Crosshair
  setPixel(cx, cy, 0, 255, 0)
  setPixel(cx-1, cy, 0, 255, 0)
  setPixel(cx+1, cy, 0, 255, 0)
  setPixel(cx, cy-1, 0, 255, 0)
  setPixel(cx, cy+1, 0, 255, 0)

  // Lasers
  player.lasers.forEach(laser => {
    // Draw lines from bottom corners to center
    const startX = laser.l ? 10 : PX_W - 10
    const startY = PX_H
    drawLine(startX, startY, cx, cy, {r: 255, g: 50, b: 50})
  })

  // Simple Wireframe Cockpit
  const hudColor = {r: 50, g: 150, b: 200}
  drawLine(0, PX_H, 20, PX_H - 10, hudColor)
  drawLine(PX_W, PX_H, PX_W - 20, PX_H - 10, hudColor)
  drawLine(20, PX_H - 10, PX_W - 20, PX_H - 10, hudColor)
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
      
      const fg = getRgba(pix[i0], pix[i0+1], pix[i0+2])
      const bg = getRgba(pix[i1], pix[i1+1], pix[i1+2])
      
      fb.setCell(x, y, "▀", fg, bg)
    }
  }

  // Text HUD
  const white = getRgba(255, 255, 255)
  fb.drawText(`SCORE: ${score}`, 2, 1, white)
  fb.drawText(`SPEED: ${speed.toFixed(1)}`, 2, 2, white)
  fb.drawText(`[WASD] Move [Space] Fire [Shift] Boost`, 2, CELL_H - 1, white)
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

  // Manage Planets
  if (Math.random() < SPAWN_RATE) {
    planets.push(new Planet(200)) // Spawn far away
  }

  for (let i = planets.length - 1; i >= 0; i--) {
    const p = planets[i]
    p.update(speed * dt)
    // Remove if behind camera or dead
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