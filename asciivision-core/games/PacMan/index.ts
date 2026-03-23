import { createCliRenderer, FrameBufferRenderable, RGBA, type KeyEvent } from "@opentui/core"

// pac-ish: maze, pellets, power pellets, 4 ghosts, frightened mode
// controls: arrows or wasd, r restart, esc quit

const W = 31
const H = 21

// render scale (cells) — each tile becomes 2x1 cells for nicer aspect
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
// # = wall
// . = pellet
// o = power pellet
// ' ' = empty
// G = ghost house (treated as empty but used for spawn area)
const MAZE_RAW = [
  "###############################",
  "#............##............o..#",
  "#.####.#####.##.#####.####.#..#",
  "#.#  #.#   #.##.#   #.#  #.#..#",
  "#.####.#####.##.#####.####.#..#",
  "#............................#.#",
  "#.####.##.########.##.####.#..#",
  "#......##....##....##......#..#",
  "######.##### ## #####.######..#",
  "     #.##### ## #####.#       #",
  "######.##          ##.######  #",
  "#......## ###GG### ##......#  #",
  "#.####.## #      # ##.####.#  #",
  "#....#.... # P  # ....#....#  #",
  "####.#.#######  #######.#.### #",
  "#............##............o..#",
  "#.####.#####.##.#####.####.#..#",
  "#...##................##...#..#",
  "###.##.##.########.##.##.###..#",
  "#......##....##....##......#..#",
  "###############################",
].map(r => r.padEnd(W, " ").slice(0, W))

// normalize width to W
const maze: string[] = MAZE_RAW.map(r => r.length < W ? r.padEnd(W, " ") : r.slice(0, W))

function isWall(x: number, y: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true
  return maze[y][x] === "#"
}
function isTunnel(x: number, y: number) {
  // allow wrap in row 9/10 area (classic tunnel-ish). here we allow wrap for any row where edges are spaces.
  if (y < 0 || y >= H) return false
  return maze[y][0] === " " && maze[y][W - 1] === " "
}
function wrapPos(x: number, y: number) {
  if (isTunnel(x, y)) {
    if (x < 0) x = W - 1
    if (x >= W) x = 0
  }
  return { x, y }
}

// pellets state derived from maze
let pellets = new Set<string>()
let power = new Set<string>()
function key(x: number, y: number) { return `${x},${y}` }

function resetPellets() {
  pellets.clear()
  power.clear()
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = maze[y][x]
      if (c === ".") pellets.add(key(x, y))
      if (c === "o") power.add(key(x, y))
    }
  }
}

// --- entities ----------------------------------------------------------------

type Entity = { x: number; y: number; dir: Dir; nextDir: Dir; speed: number; moveAcc: number }

const PAC_SPAWN = { x: 14, y: 13 }
const GHOST_SPAWN = [
  { x: 13, y: 11 },
  { x: 14, y: 11 },
  { x: 15, y: 11 },
  { x: 14, y: 10 },
]

let pac: Entity
type Ghost = Entity & { name: string; mode: "chase" | "scatter" | "fright"; frightT: number; home: { x: number; y: number } }
let ghosts: Ghost[] = []

let score = 0
let lives = 3
let level = 1
let gameOver = false

// --- renderer ----------------------------------------------------------------

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
const fbView = new FrameBufferRenderable(renderer, { id: "pac", width: CELL_W, height: CELL_H })
renderer.root.add(fbView)

const BG = RGBA.fromHex("#07090c")
const WALL = RGBA.fromHex("#60a5fa")
const PEL = RGBA.fromHex("#fde68a")
const POW = RGBA.fromHex("#fbbf24")
const TEXT = RGBA.fromHex("#e2e8f0")
const PACC = RGBA.fromHex("#fde047")
const FRIGHT = RGBA.fromHex("#38bdf8")
const GCOL = {
  blinky: RGBA.fromHex("#fb7185"),
  pinky: RGBA.fromHex("#f0abfc"),
  inky: RGBA.fromHex("#2dd4bf"),
  clyde: RGBA.fromHex("#fb923c"),
}

function cellX(tx: number) { return 1 + tx * TILE_W }
function cellY(ty: number) { return 3 + ty * TILE_H }

function drawTileChar(tx: number, ty: number, ch: string, fg: RGBA, bg: RGBA = BG) {
  const fb = fbView.frameBuffer
  const cx = cellX(tx)
  const cy = cellY(ty)
  // 2 wide tiles
  fb.setCell(cx, cy, ch, fg, bg)
  fb.setCell(cx + 1, cy, ch, fg, bg)
}

function drawText(x: number, y: number, s: string, col = TEXT) {
  fbView.frameBuffer.drawText(s, x, y, col)
}

// --- input -------------------------------------------------------------------

let desiredDir: Dir = 1

renderer.keyInput.on("keypress", (k: KeyEvent) => {
  const n = k.name
  if (n === "escape") { cleanupAndExit(); return }
  if (n === "r") restart()
  if (gameOver) return

  if (n === "up" || n === "w") desiredDir = 0
  if (n === "right" || n === "d") desiredDir = 1
  if (n === "down" || n === "s") desiredDir = 2
  if (n === "left" || n === "a") desiredDir = 3
})

function cleanupAndExit() {
  try { renderer.dropLive() } catch {}
  renderer.destroy()
}

// --- ai ----------------------------------------------------------------------

function opposite(d: Dir): Dir { return ((d + 2) % 4) as Dir }

function canMove(x: number, y: number, d: Dir) {
  const { dx, dy } = DIRS[d]
  const nx = x + dx
  const ny = y + dy
  const w = wrapPos(nx, ny)
  return !isWall(w.x, w.y)
}

function chooseGhostDir(g: Ghost) {
  // at intersections, pick direction that moves toward target (chase/scatter) or away (fright)
  const choices: Dir[] = []
  for (const d of [0, 1, 2, 3] as Dir[]) {
    if (d === opposite(g.dir)) continue
    if (canMove(g.x, g.y, d)) choices.push(d)
  }
  if (choices.length === 0) {
    // dead-end: allow reverse
    for (const d of [0, 1, 2, 3] as Dir[]) if (canMove(g.x, g.y, d)) choices.push(d)
  }
  if (choices.length === 0) return g.dir

  // determine target
  let tx = pac.x, ty = pac.y
  if (g.mode === "scatter") { tx = g.home.x; ty = g.home.y }
  if (g.mode === "fright") { tx = pac.x; ty = pac.y } // but we invert scoring later

  let best = choices[0]
  let bestScore = Infinity

  for (const d of choices) {
    const { dx, dy } = DIRS[d]
    const w = wrapPos(g.x + dx, g.y + dy)
    const dist = (w.x - tx) ** 2 + (w.y - ty) ** 2

    // fright: try to increase distance (run away)
    const scoreD = g.mode === "fright" ? -dist : dist

    if (scoreD < bestScore) {
      bestScore = scoreD
      best = d
    }
  }
  return best
}

// --- game loop ----------------------------------------------------------------

let scatter = true
let modeT = 0

function restart() {
  score = 0
  lives = 3
  level = 1
  gameOver = false
  resetPellets()
  spawnAll()
}

function spawnAll() {
  pac = { x: PAC_SPAWN.x, y: PAC_SPAWN.y, dir: 1, nextDir: 1, speed: 8, moveAcc: 0 }
  ghosts = [
    { name: "blinky", ...baseGhost(GHOST_SPAWN[0], { x: W - 2, y: 1 }) },
    { name: "pinky",  ...baseGhost(GHOST_SPAWN[1], { x: 1, y: 1 }) },
    { name: "inky",   ...baseGhost(GHOST_SPAWN[2], { x: W - 2, y: H - 2 }) },
    { name: "clyde",  ...baseGhost(GHOST_SPAWN[3], { x: 1, y: H - 2 }) },
  ]
  scatter = true
  modeT = 0
}

function baseGhost(sp: { x: number; y: number }, home: { x: number; y: number }): Omit<Ghost, "name"> {
  return { x: sp.x, y: sp.y, dir: 3, nextDir: 3, speed: 7.2, moveAcc: 0, mode: "scatter", frightT: 0, home }
}

function resetRound() {
  pac.x = PAC_SPAWN.x; pac.y = PAC_SPAWN.y; pac.dir = 1; pac.nextDir = 1; pac.moveAcc = 0
  ghosts.forEach((g, i) => { g.x = GHOST_SPAWN[i].x; g.y = GHOST_SPAWN[i].y; g.dir = 3; g.nextDir = 3; g.moveAcc = 0; g.mode = scatter ? "scatter" : "chase"; g.frightT = 0 })
}

function tickModes(dt: number) {
  modeT += dt
  // simple alternation
  // scatter 7s, chase 20s, repeat
  const cycle = scatter ? 7 : 20
  if (modeT >= cycle) {
    modeT = 0
    scatter = !scatter
    for (const g of ghosts) if (g.mode !== "fright") g.mode = scatter ? "scatter" : "chase"
  }
  // frightened timer
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

function moveEntity(e: Entity, dt: number) {
  // attempt to turn if possible
  if (canMove(e.x, e.y, e.nextDir)) e.dir = e.nextDir

  e.moveAcc += e.speed * dt
  while (e.moveAcc >= 1) {
    e.moveAcc -= 1
    const { dx, dy } = DIRS[e.dir]
    const w = wrapPos(e.x + dx, e.y + dy)
    if (isWall(w.x, w.y)) break
    e.x = w.x
    e.y = w.y
  }
}

function step(dt: number) {
  if (gameOver) return

  // pac direction desire
  pac.nextDir = desiredDir

  tickModes(dt)

  // pac moves
  moveEntity(pac, dt)

  // pellets
  const k = key(pac.x, pac.y)
  if (pellets.has(k)) { pellets.delete(k); score += 10 }
  if (power.has(k)) {
    power.delete(k)
    score += 50
    for (const g of ghosts) {
      g.mode = "fright"
      g.frightT = 8.0
    }
  }

  // ghosts move + choose turns on intersections (or every step)
  for (const g of ghosts) {
    // choose nextDir periodically
    // if can keep going and not at intersection, do nothing
    const possible = [0, 1, 2, 3].filter(d => canMove(g.x, g.y, d as Dir)).length
    const atIntersection = possible >= 3
    if (atIntersection || !canMove(g.x, g.y, g.dir)) {
      g.nextDir = chooseGhostDir(g)
    }
    moveEntity(g, dt)
  }

  // collisions
  for (const g of ghosts) {
    if (g.x === pac.x && g.y === pac.y) {
      if (g.mode === "fright") {
        score += 200
        // send ghost to spawn
        g.x = GHOST_SPAWN[0].x
        g.y = GHOST_SPAWN[0].y
        g.mode = scatter ? "scatter" : "chase"
        g.frightT = 0
      } else {
        lives -= 1
        if (lives <= 0) {
          gameOver = true
        } else {
          resetRound()
        }
        break
      }
    }
  }

  // win
  if (pellets.size === 0 && power.size === 0) {
    level += 1
    score += 500
    resetPellets()
    resetRound()
  }
}

// --- render ------------------------------------------------------------------

function render() {
  const fb = fbView.frameBuffer
  fb.fillRect(0, 0, CELL_W, CELL_H, BG)

  drawText(2, 1, `score ${score}    lives ${"♥".repeat(lives)}    level ${level}`)
  drawText(2, 2, `arrows/wasd move  r restart  esc quit  ${gameOver ? "GAME OVER" : ""}`)

  // maze walls + pellets
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = maze[y][x]
      if (c === "#") {
        drawTileChar(x, y, "█", WALL)
      } else {
        // floor
        // pellets
        const kk = key(x, y)
        if (power.has(kk)) {
          drawTileChar(x, y, "•", POW)
        } else if (pellets.has(kk)) {
          drawTileChar(x, y, "·", PEL)
        } else {
          // subtle empty
          drawTileChar(x, y, " ", TEXT, BG)
        }
      }
    }
  }

  // entities
  // pac
  drawTileChar(pac.x, pac.y, "◉", PACC)

  // ghosts
  for (const g of ghosts) {
    const col = g.mode === "fright" ? FRIGHT : (GCOL as any)[g.name]
    drawTileChar(g.x, g.y, "▣", col)
  }
}

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
