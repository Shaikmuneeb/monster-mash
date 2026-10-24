// MONSTER MASH — engine bootstrap, cinematic render stack, combat, quests, SDK wiring.

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { InputManager } from './input'
import { Monster, MonsterPool, VARIANT_STYLES, type MonsterVariant } from './monsters'
import { World, WORLD_R } from './world'
import { loadBest, saveBest } from './sdk'

// ---------- Renderer (cinematic stack) ----------
const canvas = document.getElementById('game') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0

const scene = new THREE.Scene() // replaced by world.scene below
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 700)

const world = new World()
const activeScene = world.scene

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(activeScene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 0.85)
composer.addPass(bloom)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})

// ---------- Player hero ----------
const hero = new Monster('toxic', 100, 10.5, 34)
hero.group.position.set(0, 0, 8)
activeScene.add(hero.group)
const heroGlow = new THREE.PointLight(VARIANT_STYLES.toxic.accent, 3, 7)
heroGlow.position.y = 2
hero.group.add(heroGlow)

let heroHp = 100
const HERO_MAX = 100

// ---------- Camera rig (third-person follow) ----------
const camState = { yaw: 0, dist: 11.5, height: 6.2 }
const camPos = new THREE.Vector3(0, 6, 18)

// ---------- Enemy pool + spawner ----------
const VARIANTS: MonsterVariant[] = ['toxic', 'electric', 'magma']
const pool = new MonsterPool(activeScene, 14, VARIANTS, (v) => ({
  hp: v === 'magma' ? 90 : v === 'electric' ? 55 : 70,
  speed: v === 'electric' ? 6.4 : v === 'magma' ? 3.6 : 4.6,
  dmg: v === 'magma' ? 40 : v === 'electric' ? 24 : 30,
}))
let maxAlive = 5
let difficulty = 1

// ---------- Particles (pooled hit/death bursts) ----------
const P_N = 240
const pPos = new Float32Array(P_N * 3)
const pVel = new Float32Array(P_N * 3)
const pLife = new Float32Array(P_N)
const pGeo = new THREE.BufferGeometry()
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
const pMat = new THREE.PointsMaterial({ color: 0xffe28a, size: 0.35, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
const pPoints = new THREE.Points(pGeo, pMat)
pPoints.frustumCulled = false
activeScene.add(pPoints)
let pCursor = 0

function burst(x: number, y: number, z: number, n: number, color: number, power = 7) {
  pMat.color.setHex(color)
  for (let i = 0; i < n; i++) {
    const j = pCursor = (pCursor + 1) % P_N
    pPos[j * 3] = x; pPos[j * 3 + 1] = y; pPos[j * 3 + 2] = z
    const a = Math.random() * Math.PI * 2
    const up = 0.4 + Math.random()
    pVel[j * 3] = Math.cos(a) * power * Math.random()
    pVel[j * 3 + 1] = up * power * 0.7
    pVel[j * 3 + 2] = Math.sin(a) * power * Math.random()
    pLife[j] = 0.7
  }
}

function updateParticles(dt: number) {
  for (let i = 0; i < P_N; i++) {
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -100; continue }
    pLife[i] -= dt
    pVel[i * 3 + 1] -= 14 * dt
    pPos[i * 3] += pVel[i * 3] * dt
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt
  }
  pGeo.attributes.position.needsUpdate = true
}

// ---------- Game state ----------
const input = new InputManager()
let running = false
let dead = false
let score = 0
let best = 0
let hearts = 3
let invuln = 0
let dodgeCd = 0
let dodgeT = 0
let heroAttackCd = 0
let hitStop = 0
let time = 0
let spawnT = 0

const hudHearts = document.getElementById('hearts')!
const hudFill = document.getElementById('hullfill') as HTMLDivElement
const hudScore = document.getElementById('score')!
const hudQuest = document.getElementById('quest')!

function setQuest(text: string) { hudQuest.textContent = text }

// ---------- Spawning ----------
function spawnEnemies() {
  const alive = pool.all.filter(m => m.active).length
  if (alive >= maxAlive) return
  spawnT -= 1
  if (spawnT > 0) return
  spawnT = 2
  const m = pool.acquire()
  if (!m) return
  const a = Math.random() * Math.PI * 2
  const r = 22 + Math.random() * 14
  m.group.position.set(
    THREE.MathUtils.clamp(hero.group.position.x + Math.cos(a) * r, -WORLD_R, WORLD_R),
    0,
    THREE.MathUtils.clamp(hero.group.position.z + Math.sin(a) * r, -WORLD_R, WORLD_R),
  )
  m.setAnim('walk')
  m.resetPose()
}

// ---------- Combat ----------
function heroAttack() {
  if (heroAttackCd > 0 || hero.anim === 'attack') return
  heroAttackCd = 0.55
  hero.setAnim('attack')
}

function resolveHeroStrike() {
  const hx = hero.group.position.x, hz = hero.group.position.z
  const facing = hero.group.rotation.y
  for (const e of pool.all) {
    if (!e.active) continue
    const dx = e.group.position.x - hx
    const dz = e.group.position.z - hz
    const d = Math.hypot(dx, dz)
    if (d > 3.4) continue
    const ang = Math.atan2(dx, dz)
    let diff = ang - facing
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    if (Math.abs(diff) > 1.2) continue
    e.hp -= hero.dmg
    e.setAnim('flinch')
    // knockback
    e.group.position.x += (dx / d) * 1.1
    e.group.position.z += (dz / d) * 1.1
    burst(e.group.position.x, 1.4, e.group.position.z, 8, VARIANT_STYLES[e.variant].accent)
    if (e.hp <= 0) {
      pool.release(e)
      score += 100
      burst(e.group.position.x, 1.2, e.group.position.z, 20, VARIANT_STYLES[e.variant].accent, 9)
      hitStop = 0.06
    }
  }
}

function damageHero(amount: number) {
  if (invuln > 0) return
  heroHp -= amount
  invuln = 0.9
  hitStop = 0.08
  burst(hero.group.position.x, 1.5, hero.group.position.z, 10, 0xff5e8a)
  if (heroHp <= 0 && hearts > 0) {
    hearts--
    heroHp = HERO_MAX
    if (hearts === 0) void die()
  }
}

async function die() {
  running = false
  dead = true
  if (score > best) { best = score; await saveBest(score, best) }
  document.getElementById('deathStats')!.textContent = `Score ${score} · Best ${best}`
  document.getElementById('deathScreen')!.classList.remove('hidden')
}

// ---------- Interaction (chests + artifacts) ----------
function nearestInteract(): { kind: 'chest' | 'artifact', dist: number } | null {
  const hx = hero.group.position.x, hz = hero.group.position.z
  let bestD = 3.2
  let kind: 'chest' | 'artifact' | null = null
  for (const c of world.chests) {
    if (c.opened) continue
    const d = Math.hypot(c.group.position.x - hx, c.group.position.z - hz)
    if (d < bestD) { bestD = d; kind = 'chest' }
  }
  const art = world.artifact
  if (art && !art.collected) {
    const d = Math.hypot(art.mesh.position.x - hx, art.mesh.position.z - hz)
    if (d < bestD) { bestD = d; kind = 'artifact' }
  }
  return kind ? { kind, dist: bestD } : null
}

function doUse() {
  const n = nearestInteract()
  if (!n) return
  const hx = hero.group.position.x, hz = hero.group.position.z
  if (n.kind === 'chest') {
    for (const c of world.chests) {
      if (c.opened) continue
      if (Math.hypot(c.group.position.x - hx, c.group.position.z - hz) < 3.2) {
        c.opened = true
        score += 150
        burst(c.group.position.x, 1.2, c.group.position.z, 16, 0xffd23e, 8)
        if (hearts < 3 && Math.random() < 0.5) hearts++
        break
      }
    }
  } else if (n.kind === 'artifact' && world.artifact) {
    world.artifact.collected = true
    score += 500
    difficulty += 0.35
    maxAlive = Math.min(12, maxAlive + 2)
    burst(world.artifact.mesh.position.x, 1.6, world.artifact.mesh.position.z, 26, 0x7cf6b2, 10)
    world.spawnArtifact()
    setQuest('⚔ Next Ancient Artifact detected — follow the light pillar')
  }
}

// ---------- Update ----------
function update(dt: number) {
  time += dt
  if (hitStop > 0) { hitStop -= dt; dt *= 0.15 }
  if (invuln > 0) invuln -= dt
  if (heroAttackCd > 0) heroAttackCd -= dt
  if (dodgeCd > 0) dodgeCd -= dt

  const inp = input.poll()

  // dodge dash
  if (inp.dodgePressed && dodgeCd <= 0) {
    dodgeCd = 1.6
    dodgeT = 0.28
    invuln = Math.max(invuln, 0.4)
    burst(hero.group.position.x, 0.6, hero.group.position.z, 8, 0x9b6bff, 4)
  }
  const dashing = dodgeT > 0
  if (dashing) dodgeT -= dt

  // screen rotation: hold right mouse and drag
  camState.yaw += input.takeLookDelta()

  // movement — screen-relative: W forward, S back, A left, D right
  const mvLen = Math.hypot(inp.moveX, inp.moveY)
  if (mvLen > 0.05) {
    const speed = dashing ? 26 : hero.speed
    const yaw = camState.yaw
    const fx = Math.sin(yaw), fz = Math.cos(yaw)      // camera forward on the ground plane
    const rx = -fz, rz = fx                            // camera right
    const wx = (fx * -inp.moveY + rx * inp.moveX)
    const wz = (fz * -inp.moveY + rz * inp.moveX)
    const wl = Math.hypot(wx, wz) || 1
    const nx = wx / wl * Math.min(mvLen, 1)
    const nz = wz / wl * Math.min(mvLen, 1)
    hero.group.position.x = THREE.MathUtils.clamp(hero.group.position.x + nx * speed * dt, -WORLD_R, WORLD_R)
    hero.group.position.z = THREE.MathUtils.clamp(hero.group.position.z + nz * speed * dt, -WORLD_R, WORLD_R)
    const targetYaw = Math.atan2(nx, nz)
    let dy = targetYaw - hero.group.rotation.y
    while (dy > Math.PI) dy -= Math.PI * 2
    while (dy < -Math.PI) dy += Math.PI * 2
    hero.group.rotation.y += dy * Math.min(1, dt * 12)
    if (hero.anim !== 'attack') hero.setAnim(dashing ? 'walk' : 'walk')
  } else if (hero.anim === 'walk') {
    hero.setAnim('idle')
  }

  // actions
  if (inp.attackPressed) heroAttack()
  if (inp.usePressed) doUse()

  // hero attack strike frame
  if (hero.anim === 'attack') {
    if (hero.animate(1.35 * dt)) resolveHeroStrike()
    if (hero.animT > 0.7) hero.setAnim('idle')
  } else {
    hero.animate(dt)
  }
  hero.group.visible = !(invuln > 0 && Math.floor(time * 14) % 2 === 0)

  // enemies
  spawnEnemies()
  const hx = hero.group.position.x, hz = hero.group.position.z
  for (const e of pool.all) {
    if (!e.active) continue
    const dx = hx - e.group.position.x
    const dz = hz - e.group.position.z
    const d = Math.hypot(dx, dz)

    if (e.anim === 'flinch') {
      e.animate(dt)
      continue
    }
    if (e.anim === 'attack') {
      if (e.animate(dt)) damageHero(e.dmg)
      if (e.animT > 0.7) e.setAnim('idle')
      continue
    }

    if (d < 2.3) {
      e.faceTowards(hx, hz)
      e.setAnim('attack')
    } else if (d < 20) {
      e.faceTowards(hx, hz)
      e.setAnim('walk')
      e.group.position.x += (dx / d) * e.speed * difficulty * dt
      e.group.position.z += (dz / d) * e.speed * difficulty * dt
    } else {
      // wander
      if (e.animT > 2.5) { e.setAnim(Math.random() < 0.5 ? 'idle' : 'walk'); e.group.rotation.y = Math.random() * Math.PI * 2 }
      const a = e.group.rotation.y
      e.group.position.x += Math.sin(a) * e.speed * 0.4 * dt
      e.group.position.z += Math.cos(a) * e.speed * 0.4 * dt
    }
    e.animate(dt)
  }

  // chest lids animate open
  for (const c of world.chests) {
    if (c.opened && c.lid.rotation.x > -2.0) c.lid.rotation.x -= dt * 5
  }

  world.updateArtifact(time)
  world.updateParticles(hx, hz, time, dt)
  updateParticles(dt)

  // camera follow (yaw is owned by right-mouse look / touch drag)
  const camTargetX = hx - Math.sin(camState.yaw) * camState.dist
  const camTargetZ = hz - Math.cos(camState.yaw) * camState.dist
  camPos.lerp(new THREE.Vector3(camTargetX, camState.height, camTargetZ), Math.min(1, dt * 4))
  camera.position.copy(camPos)
  camera.lookAt(hx, 1.8, hz)

  // HUD
  hudHearts.textContent = '♥'.repeat(hearts) + '·'.repeat(3 - hearts)
  hudFill.style.width = `${Math.max(0, heroHp / HERO_MAX) * 100}%`
  hudScore.textContent = String(score)
}

// ---------- Loop ----------
let last = performance.now()
let fpsAccum = 0, fpsFrames = 0
function frame(now: number) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (running) update(dt)
  else { input.poll(); hero.animate(dt); world.updateArtifact(time) }
  composer.render()

  // lightweight perf watchdog (console only; no on-screen badge per UI policy)
  fpsAccum += dt; fpsFrames++
  if (fpsAccum >= 3) {
    const fps = Math.round(fpsFrames / fpsAccum)
    if (fps < 45) console.warn(`[MonsterMash] fps ${fps} — consider lowering pixel ratio`)
    fpsAccum = 0; fpsFrames = 0
  }
}
requestAnimationFrame(frame)

// ---------- Flow ----------
function resetGame() {
  hero.group.position.set(0, 0, 8)
  heroHp = HERO_MAX
  hearts = 3
  score = 0
  invuln = 1
  dead = false
  difficulty = 1
  maxAlive = 5
  for (const c of world.chests) { c.opened = false; c.lid.rotation.x = 0 }
  for (const e of pool.all) if (e.active) pool.release(e)
  setQuest('⚔ Quest: Collect the Ancient Artifact')
}

document.getElementById('startBtn')!.addEventListener('click', () => {
  document.getElementById('startScreen')!.classList.add('hidden')
  resetGame()
  running = true
})
document.getElementById('retryBtn')!.addEventListener('click', () => {
  document.getElementById('deathScreen')!.classList.add('hidden')
  resetGame()
  running = true
})
// ---------- Boot: async SDK init (runner-style), then best score ----------
async function boot() {
  try {
    // `await runner.start(...)`-style async init; the SDK self-initializes on import,
    // and appStorage/ads become usable. Failures keep the game fully playable.
    best = await loadBest()
  } catch {
    best = 0
  }
  document.getElementById('bestScore')!.textContent = best > 0 ? `Best score: ${best}` : ''
}
void boot()
void scene
