import { createCliRenderer, FrameBufferRenderable, RGBA, type KeyEvent } from "@opentui/core"

// PAC-MAN — classic arcade game
// Controls: arrows or WASD to move, R to restart, ESC to quit

const W = 31
const H = 21

// render scale — each tile becomes 2x1 cells for nicer aspect ratio
const TILE_W = 2
const TILE_H = 1

const CELL_W = W * TILE_W + 2
const CELL_H = H * TILE_H + 5

type Dir = 0 | 1 | 2 | 3 // up right down left
const DIRS: Record<Dir, { dx: number; dy: number }> = {
  0: { dx: 0, dy: -1 },
  1: { dx: 1, dy: 0 },
  2: { dx: 0, dy: 1 },
  3: { dx: -1, dy: 0 },
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// --- maze --------------------------------------------------------------------
// # = wall, . = pellet, o = power pellet, - = ghost door, ' ' = empty
// Every row is EXACTLY 31 characters. The maze is perfectly symmetric.
const MAZE: string[] = [
  "###############################", // 0
  "#..............#..............#", // 1
  "#.####.######.###.######.####.#", // 2
  "#o####.######.###.######.####o#", // 3
  "#.............................#", // 4
  "#.####.##.###########.##.####.#", // 5
  "#......##.............##......#", // 6
  "######.#####.#####.#####.######", // 7
  "     #..               ..#     ", // 8
  "######.## ###-----### ##.######", // 9
  "      .   #         #   .      ", // 10  tunnel row
  "######.## #         # ##.######", // 11
  "     #.## ########### ##.#     ", // 12
  "######..               ..######", // 13
  "#..............#..............#", // 14
  "#.####.######.###.######.####.#", // 15
  "#o..##...................##..o#", // 16
  "###.##.##.###########.##.##.###", // 17
  "#......##.............##......#", // 18
  "#..............#..............#", // 19
  "###############################", // 20
]

// Validate maze dimensions
for (let i = 0; i < MAZE.length; i++) {
  if (MAZE[i].length !== W) {
    throw new Error(`Maze row ${i} has length ${MAZE[i].length}, expected ${W}`)
  }
}

function tileAt(x: number, y: number): string {
  if (x < 0 || y < 0 || x >= W || y >= H) return " "
  return MAZE[y][x]
}

function isWall(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= W || y >= H) return true
  const c = MAZE[y][x]
  return c === "#"
}

function isGhostDoor(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= W || y >= H) return false
  return MAZE[y][x] === "-"
}

// Pac treats ghost door as wall; ghosts can pass through it
function canPacMove(x: number, y: number, d: Dir): boolean {
  const { dx, dy } = DIRS[d]
  const w = wrapPos(x + dx, y + dy)
  return !isWall(w.x, w.y) && !isGhostDoor(w.x, w.y)
}

function canGhostMove(x: number, y: number, d: Dir): boolean {
  const { dx, dy } = DIRS[d]
  const w = wrapPos(x + dx, y + dy)
  return !isWall(w.x, w.y)
  // ghost door is passable for ghosts — not checked here
}

function isTunnel(_x: number, y: number): boolean {
  if (y < 0 || y >= H) return false
  return MAZE[y][0] === " " && MAZE[y][W - 1] === " "
}

function wrapPos(x: number, y: number): { x: number; y: number } {
  if (isTunnel(x, y)) {
    if (x < 0) x = W - 1
    if (x >= W) x = 0
  }
  return { x, y }
}

// --- pellets -----------------------------------------------------------------
let pellets = new Set<string>()
let power = new Set<string>()
let totalPellets = 0
function k(x: number, y: number) { return `${x},${y}` }

function resetPellets() {
  pellets.clear()
  power.clear()
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = MAZE[y][x]
      if (c === ".") pellets.add(k(x, y))
      if (c === "o") power.add(k(x, y))
    }
  }
  totalPellets = pellets.size + power.size
}

// --- entities ----------------------------------------------------------------
type Entity = {
  x: number; y: number
  dir: Dir; nextDir: Dir
  speed: number; moveAcc: number
}

const PAC_SPAWN = { x: 15, y: 16 }
const GHOST_SPAWN = [
  { x: 13, y: 10 },  // blinky
  { x: 15, y: 10 },  // pinky
  { x: 17, y: 10 },  // inky
  { x: 15, y: 11 },  // clyde
]

type GhostMode = "chase" | "scatter" | "fright" | "eaten"
type Ghost = Entity & {
  name: string
  mode: GhostMode
  frightT: number
  home: { x: number; y: number }
  spawnIdx: number
  releaseTimer: number
}

let pac: Entity
let ghosts: Ghost[] = []
let score = 0
let lives = 3
let level = 1
let gameOver = false
let gameWon = false
let readyTimer = 0
let ghostCombo = 0 // for escalating ghost eat scores: 200, 400, 800, 1600
let animFrame = 0

// --- renderer ----------------------------------------------------------------
const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
const fbView = new FrameBufferRenderable(renderer, { id: "pac", width: CELL_W, height: CELL_H })
renderer.root.add(fbView)

const BG      = RGBA.fromHex("#07090c")
const WALL    = RGBA.fromHex("#2244cc")
const WALL_HI = RGBA.fromHex("#4466ee")
const PEL     = RGBA.fromHex("#fde68a")
const POW_COL = RGBA.fromHex("#fbbf24")
const TEXT    = RGBA.fromHex("#e2e8f0")
const PACC    = RGBA.fromHex("#fde047")
const FRIGHT  = RGBA.fromHex("#2244cc")
const FRIGHT2 = RGBA.fromHex("#ffffff")
const DOOR    = RGBA.fromHex("#ffaacc")
const EATEN_COL = RGBA.fromHex("#aaaaff")
const GCOL: Record<string, RGBA> = {
  blinky: RGBA.fromHex("#ff0000"),
  pinky:  RGBA.fromHex("#ffb8ff"),
  inky:   RGBA.fromHex("#00ffff"),
  clyde:  RGBA.fromHex("#ffb852"),
}

function cellX(tx: number) { return 1 + tx * TILE_W }
function cellY(ty: number) { return 3 + ty * TILE_H }

function drawTile(tx: number, ty: number, ch: string, fg: RGBA, bg: RGBA = BG) {
  const fb = fbView.frameBuffer
  const cx = cellX(tx)
  const cy = cellY(ty)
  fb.setCell(cx, cy, ch, fg, bg)
  fb.setCell(cx + 1, cy, ch.length > 1 ? ch[1] : ch, fg, bg)
}

function drawTile2(tx: number, ty: number, ch1: string, ch2: string, fg: RGBA, bg: RGBA = BG) {
  const fb = fbView.frameBuffer
  const cx = cellX(tx)
  const cy = cellY(ty)
  fb.setCell(cx, cy, ch1, fg, bg)
  fb.setCell(cx + 1, cy, ch2, fg, bg)
}

function drawText(x: number, y: number, s: string, col = TEXT) {
  fbView.frameBuffer.drawText(s, x, y, col)
}

// --- input -------------------------------------------------------------------
let desiredDir: Dir = 3

renderer.keyInput.on("keypress", (kk: KeyEvent) => {
  const n = kk.name
  if (n === "escape") { cleanupAndExit(); return }
  if (n === "r") { restart(); return }
  if (gameOver || gameWon) return
  if (readyTimer > 0) return

  if (n === "up"    || n === "w") desiredDir = 0
  if (n === "right" || n === "d") desiredDir = 1
  if (n === "down"  || n === "s") desiredDir = 2
  if (n === "left"  || n === "a") desiredDir = 3
})

function cleanupAndExit() {
  try { renderer.dropLive() } catch {}
  renderer.destroy()
}

// --- ghost AI ----------------------------------------------------------------
function opposite(d: Dir): Dir { return ((d + 2) % 4) as Dir }

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2
}

function getGhostTarget(g: Ghost): { x: number; y: number } {
  if (g.mode === "scatter") return g.home
  if (g.mode === "eaten") return GHOST_SPAWN[g.spawnIdx]

  // Chase mode — each ghost has different targeting
  switch (g.name) {
    case "blinky":
      // Target pac directly
      return { x: pac.x, y: pac.y }
    case "pinky": {
      // Target 4 tiles ahead of pac
      const { dx, dy } = DIRS[pac.dir]
      return { x: pac.x + dx * 4, y: pac.y + dy * 4 }
    }
    case "inky": {
      // 2 tiles ahead of pac, then double the vector from blinky to that point
      const { dx, dy } = DIRS[pac.dir]
      const ax = pac.x + dx * 2
      const ay = pac.y + dy * 2
      const blinky = ghosts[0]
      return { x: ax + (ax - blinky.x), y: ay + (ay - blinky.y) }
    }
    case "clyde": {
      // If far from pac, target pac; if close, scatter
      if (dist2(g.x, g.y, pac.x, pac.y) > 64) {
        return { x: pac.x, y: pac.y }
      }
      return g.home
    }
    default:
      return { x: pac.x, y: pac.y }
  }
}

function chooseGhostDir(g: Ghost): Dir {
  const choices: Dir[] = []
  for (const d of [0, 1, 2, 3] as Dir[]) {
    if (d === opposite(g.dir)) continue
    if (canGhostMove(g.x, g.y, d)) choices.push(d)
  }
  if (choices.length === 0) {
    // Dead end — allow reverse
    for (const d of [0, 1, 2, 3] as Dir[]) {
      if (canGhostMove(g.x, g.y, d)) choices.push(d)
    }
  }
  if (choices.length === 0) return g.dir

  if (g.mode === "fright") {
    // Random direction when frightened
    return choices[Math.floor(Math.random() * choices.length)]
  }

  // Target-based movement for chase, scatter, eaten
  const target = getGhostTarget(g)
  let best = choices[0]
  let bestDist = Infinity

  for (const d of choices) {
    const { dx, dy } = DIRS[d]
    const w = wrapPos(g.x + dx, g.y + dy)
    const dd = dist2(w.x, w.y, target.x, target.y)
    if (dd < bestDist) {
      bestDist = dd
      best = d
    }
  }
  return best
}

// --- game state --------------------------------------------------------------
let scatter = true
let modeT = 0

// Scatter/chase timing per level (simplified)
const SCATTER_TIME = 7
const CHASE_TIME = 20
const FRIGHT_TIME = 8

function restart() {
  score = 0
  lives = 3
  level = 1
  gameOver = false
  gameWon = false
  desiredDir = 3
  resetPellets()
  spawnAll()
  readyTimer = 2.0
}

function spawnAll() {
  pac = { x: PAC_SPAWN.x, y: PAC_SPAWN.y, dir: 3, nextDir: 3, speed: 8, moveAcc: 0 }
  ghosts = [
    makeGhost("blinky", 0, { x: W - 3, y: 0 },    0),
    makeGhost("pinky",  1, { x: 2, y: 0 },          1.5),
    makeGhost("inky",   2, { x: W - 3, y: H - 1 },  3.0),
    makeGhost("clyde",  3, { x: 2, y: H - 1 },      4.5),
  ]
  scatter = true
  modeT = 0
  ghostCombo = 0
}

function makeGhost(name: string, idx: number, home: { x: number; y: number }, releaseDelay: number): Ghost {
  const sp = GHOST_SPAWN[idx]
  return {
    x: sp.x, y: sp.y,
    dir: 0, nextDir: 0,
    speed: 6.5,
    moveAcc: 0,
    name, mode: "scatter",
    frightT: 0,
    home,
    spawnIdx: idx,
    releaseTimer: releaseDelay,
  }
}

function resetRound() {
  pac.x = PAC_SPAWN.x
  pac.y = PAC_SPAWN.y
  pac.dir = 3
  pac.nextDir = 3
  pac.moveAcc = 0
  desiredDir = 3
  readyTimer = 1.5
  ghostCombo = 0
  ghosts.forEach((g, i) => {
    g.x = GHOST_SPAWN[i].x
    g.y = GHOST_SPAWN[i].y
    g.dir = 0
    g.nextDir = 0
    g.moveAcc = 0
    g.mode = scatter ? "scatter" : "chase"
    g.frightT = 0
    g.releaseTimer = i * 1.5
  })
}

function nextLevel() {
  level += 1
  score += 500
  resetPellets()
  spawnAll()
  readyTimer = 2.0
}

// --- game loop ---------------------------------------------------------------

function tickModes(dt: number) {
  modeT += dt
  const cycleLen = scatter ? SCATTER_TIME : CHASE_TIME
  if (modeT >= cycleLen) {
    modeT = 0
    scatter = !scatter
    for (const g of ghosts) {
      if (g.mode !== "fright" && g.mode !== "eaten") {
        g.mode = scatter ? "scatter" : "chase"
        // Reverse direction on mode switch (classic behavior)
        g.dir = opposite(g.dir)
      }
    }
  }

  // Frightened timer countdown
  for (const g of ghosts) {
    if (g.mode === "fright") {
      g.frightT -= dt
      if (g.frightT <= 0) {
        g.mode = scatter ? "scatter" : "chase"
        g.frightT = 0
      }
    }
  }
}

function movePac(dt: number) {
  pac.nextDir = desiredDir

  // Try turning to desired direction first
  if (canPacMove(pac.x, pac.y, pac.nextDir)) {
    pac.dir = pac.nextDir
  }

  pac.moveAcc += pac.speed * dt
  while (pac.moveAcc >= 1) {
    pac.moveAcc -= 1
    if (!canPacMove(pac.x, pac.y, pac.dir)) {
      pac.moveAcc = 0
      break
    }
    const { dx, dy } = DIRS[pac.dir]
    const w = wrapPos(pac.x + dx, pac.y + dy)
    pac.x = w.x
    pac.y = w.y
  }
}

function moveGhost(g: Ghost, dt: number) {
  // Release timer — ghost stays in house until timer expires
  if (g.releaseTimer > 0) {
    g.releaseTimer -= dt
    return
  }

  // If eaten and back at spawn, revive
  if (g.mode === "eaten") {
    if (g.x === GHOST_SPAWN[g.spawnIdx].x && g.y === GHOST_SPAWN[g.spawnIdx].y) {
      g.mode = scatter ? "scatter" : "chase"
    }
  }

  // Speed varies by mode
  const spd = g.mode === "eaten" ? 12 : g.mode === "fright" ? 5 : 6.5 + level * 0.3

  g.moveAcc += spd * dt
  while (g.moveAcc >= 1) {
    g.moveAcc -= 1

    // At current position, decide direction
    const possible = ([0, 1, 2, 3] as Dir[]).filter(d => canGhostMove(g.x, g.y, d)).length
    const atIntersection = possible >= 3
    if (atIntersection || !canGhostMove(g.x, g.y, g.dir)) {
      g.nextDir = chooseGhostDir(g)
    }
    if (canGhostMove(g.x, g.y, g.nextDir)) {
      g.dir = g.nextDir
    }

    if (!canGhostMove(g.x, g.y, g.dir)) {
      g.moveAcc = 0
      break
    }
    const { dx, dy } = DIRS[g.dir]
    const w = wrapPos(g.x + dx, g.y + dy)
    g.x = w.x
    g.y = w.y
  }
}

function checkCollisions() {
  for (const g of ghosts) {
    if (g.x === pac.x && g.y === pac.y) {
      if (g.mode === "fright") {
        // Eat ghost — escalating score
        ghostCombo++
        const pts = 200 * Math.pow(2, ghostCombo - 1)
        score += Math.min(pts, 1600)
        g.mode = "eaten"
        g.frightT = 0
      } else if (g.mode === "eaten") {
        // No collision with eaten ghosts (eyes only)
        continue
      } else {
        // Pac dies
        lives -= 1
        if (lives <= 0) {
          gameOver = true
        } else {
          resetRound()
        }
        return
      }
    }
  }
}

function step(dt: number) {
  if (gameOver || gameWon) return

  // Ready countdown
  if (readyTimer > 0) {
    readyTimer -= dt
    return
  }

  tickModes(dt)

  // Move pac
  movePac(dt)

  // Check pellets at pac position
  const pk = k(pac.x, pac.y)
  if (pellets.has(pk)) {
    pellets.delete(pk)
    score += 10
  }
  if (power.has(pk)) {
    power.delete(pk)
    score += 50
    ghostCombo = 0
    for (const g of ghosts) {
      if (g.mode !== "eaten") {
        g.mode = "fright"
        g.frightT = FRIGHT_TIME
        g.dir = opposite(g.dir) // Ghosts reverse on fright
      }
    }
  }

  // Move ghosts
  for (const g of ghosts) {
    moveGhost(g, dt)
  }

  // Check ghost collisions
  checkCollisions()

  // Win condition — all pellets eaten
  if (pellets.size === 0 && power.size === 0) {
    nextLevel()
  }

  animFrame++
}

// --- render ------------------------------------------------------------------

const PAC_CHARS_R = ["◗", "◐", "●"]
const PAC_CHARS_L = ["◖", "◑", "●"]
const PAC_CHARS_U = ["◓", "◑", "●"]
const PAC_CHARS_D = ["◒", "◐", "●"]
const GHOST_CHAR = "ᗣ"
const GHOST_FRIGHT_CHAR = "ᗣ"
const GHOST_EATEN_CHAR = "◌"

function getPacChar(): string {
  const phase = Math.floor(animFrame / 4) % 3
  switch (pac.dir) {
    case 0: return PAC_CHARS_U[phase]
    case 1: return PAC_CHARS_R[phase]
    case 2: return PAC_CHARS_D[phase]
    case 3: return PAC_CHARS_L[phase]
  }
}

function render() {
  const fb = fbView.frameBuffer
  fb.fillRect(0, 0, CELL_W, CELL_H, BG)

  // HUD
  const hearts = lives > 0 ? "♥".repeat(lives) : ""
  drawText(1, 1, `SCORE ${String(score).padStart(6, "0")}   ${hearts}   LVL ${level}`, TEXT)
  drawText(1, 2, "arrows/wasd  r:restart  esc:quit", RGBA.fromHex("#666688"))

  // Draw maze
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = MAZE[y][x]
      if (c === "#") {
        // Walls — use different shading based on adjacency for subtle depth
        const wallChar = "█"
        drawTile(x, y, wallChar, WALL)
      } else if (c === "-") {
        // Ghost door
        drawTile(x, y, "─", DOOR)
      } else {
        // Floor — check for pellets
        const pk2 = k(x, y)
        if (power.has(pk2)) {
          // Power pellets pulse
          const pulse = Math.floor(animFrame / 8) % 2 === 0
          drawTile(x, y, pulse ? "●" : "○", POW_COL)
        } else if (pellets.has(pk2)) {
          drawTile(x, y, "·", PEL)
        } else {
          drawTile(x, y, " ", TEXT, BG)
        }
      }
    }
  }

  // Draw ghosts (before pac so pac draws on top)
  for (const g of ghosts) {
    if (g.mode === "eaten") {
      drawTile(g.x, g.y, GHOST_EATEN_CHAR, EATEN_COL)
    } else if (g.mode === "fright") {
      // Flash when fright is about to end
      const flashing = g.frightT < 2.5 && Math.floor(animFrame / 4) % 2 === 0
      drawTile(g.x, g.y, GHOST_FRIGHT_CHAR, flashing ? FRIGHT2 : FRIGHT)
    } else {
      drawTile(g.x, g.y, GHOST_CHAR, GCOL[g.name])
    }
  }

  // Draw pac
  drawTile(pac.x, pac.y, getPacChar(), PACC)

  // Ready message
  if (readyTimer > 0) {
    const readyX = cellX(12)
    const readyY = cellY(13)
    drawText(readyX, readyY, "  READY!  ", RGBA.fromHex("#ffff00"))
  }

  // Game over overlay
  if (gameOver) {
    const goX = cellX(11)
    const goY = cellY(10)
    drawText(goX, goY, "  GAME  OVER  ", RGBA.fromHex("#ff4444"))
    drawText(goX, goY + 1, "  press R to restart ", RGBA.fromHex("#aaaaaa"))
  }

  // Win
  if (gameWon) {
    const wX = cellX(11)
    const wY = cellY(10)
    drawText(wX, wY, "  YOU  WIN!  ", RGBA.fromHex("#44ff44"))
  }
}

// --- start -------------------------------------------------------------------

restart()
renderer.requestLive()

let last = Date.now()
const tick = setInterval(() => {
  const now = Date.now()
  const dt = clamp((now - last) / 1000, 0, 0.05)
  last = now
  step(dt)
  render()
}, 1000 / 30)

renderer.on("destroy", () => clearInterval(tick))
