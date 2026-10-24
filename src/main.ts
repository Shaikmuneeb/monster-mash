// MONSTER MASH — engine bootstrap, cinematic render stack, combat, quests, SDK wiring.

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { InputManager } from './input'
import { Monster, MonsterPool, VARIANT_STYLES, type MonsterVariant } from './monsters'
import { World, WORLD_R } from './world'
import { loadBest, saveBest } from './sdk'
import { sfx } from './audio'

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

// ---------- Posture / parry / deathblow ----------
let guarding = false
let guardStart = -10
let playerPosture = 0
const PLAYER_POSTURE_MAX = 100
let slowT = 0            // deathblow slow-motion remaining
let camPulse = 0         // combat-clash camera zoom pulse

// ---------- Phases & boss ----------
let artifactsCollected = 0
let phase = 1
let boss: Monster | null = null
let bossHp = 0
const BOSS_MAX = 620
let bossState: 'chase' | 'windup' | 'attack' | 'rest' = 'chase'
let bossT = 0

const hudPosture = document.getElementById('playerposture')!
const bossWrap = document.getElementById('bosswrap')!
const bossFill = document.getElementById('bossfill')!
const bossPostureFill = document.getElementById('posturefill')!
const bannerEl = document.getElementById('banner')!

function showBanner(text: string, ms = 2600) {
  bannerEl.textContent = text
  bannerEl.classList.add('show')
  setTimeout(() => bannerEl.classList.remove('show'), ms)
}

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

// ---------- Combat: 3-hit combo (light, light, HEAVY finisher) ----------
let comboStage: 1 | 2 | 3 = 1
let comboWindow = 0
let shakeT = 0

function heroAttack() {
  if (heroAttackCd > 0 || hero.anim === 'attack' || guarding) return
  // cinematic DEATHBLOW takes priority over a normal swing
  for (const e of pool.all) {
    if (!e.active || e.stunT <= 0) continue
    const d = Math.hypot(e.group.position.x - hero.group.position.x, e.group.position.z - hero.group.position.z)
    if (d < 2.8) { void executeDeathblow(e); return }
  }
  if (boss && bossHp > 0 && boss.postureBroken) {
    const d = Math.hypot(boss.group.position.x - hero.group.position.x, boss.group.position.z - hero.group.position.z)
    if (d < 3.2) { void executeDeathblow(boss); return }
  }
  comboStage = comboWindow > 0 ? ((comboStage % 3) + 1) as 1 | 2 | 3 : 1
  comboWindow = 1.2
  hero.comboStage = comboStage
  heroAttackCd = comboStage === 3 ? 0.85 : 0.34
  hero.setAnim('attack')
  // alert nearby foes: some raise a blocking stance
  for (const e of pool.all) {
    if (!e.active || e.anim === 'attack' || e.anim === 'guard') continue
    const d = Math.hypot(e.group.position.x - hero.group.position.x, e.group.position.z - hero.group.position.z)
    if (d < 4 && Math.random() < 0.3) e.setAnim('guard')
  }
}

/** Slow-motion cinematic finishing slash. */
async function executeDeathblow(e: Monster) {
  slowT = 1.1
  camPulse = 1
  shakeT = 0.6
  hitStop = 0.05
  sfx.deathblow()
  hero.setAnim('attack')
  hero.comboStage = 3
  hero.faceTowards(e.group.position.x, e.group.position.z)
  burst(e.group.position.x, 1.4, e.group.position.z, 30, 0xffe28a, 11)
  e.posture = 0
  e.stunT = 0
  e.hp = 0
  score += 250
  const wasBoss = e === boss
  if (wasBoss) {
    bossHp = 0
    killBoss()
  } else {
    pool.release(e)
  }
}

function resolveHeroStrike() {
  const hx = hero.group.position.x, hz = hero.group.position.z
  const facing = hero.group.rotation.y
  const heavy = comboStage === 3
  const reach = heavy ? 4.0 : 3.4
  sfx[heavy ? 'heavy' : 'slash']()
  const hits = (e: Monster, isBoss: boolean) => {
    const dx = e.group.position.x - hx
    const dz = e.group.position.z - hz
    const d = Math.hypot(dx, dz)
    if (d > reach) return
    const ang = Math.atan2(dx, dz)
    let diff = ang - facing
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    if (Math.abs(diff) > 1.25) return

    // blocking foes take chip damage and spark instead of flinching
    let dmg = hero.dmg * (heavy ? 2.2 : 1)
    if (e.anim === 'guard') {
      dmg *= 0.15
      sfx.clang()
      burst(e.group.position.x, 1.5, e.group.position.z, 6, 0xd8e6ff, 4)
      e.addPosture(8)
    } else {
      e.addPosture(heavy ? 34 : 14)
    }
    if (!isBoss) e.hp -= dmg
    else bossHp -= dmg

    if (e.postureBroken && e.stunT <= 0) {
      e.stunT = isBoss ? 2.4 : 2.0
      e.setAnim('flinch')
      sfx.postureBreak()
      hitStop = 0.1
      shakeT = Math.max(shakeT, 0.3)
    }

    if (!isBoss && e.stunT <= 0) {
      e.setAnim('flinch')
      const kb = heavy ? 2.2 : 1.1
      e.group.position.x += (dx / d) * kb
      e.group.position.z += (dz / d) * kb
    }
    burst(e.group.position.x, 1.4, e.group.position.z, heavy ? 14 : 8, VARIANT_STYLES[e.variant].accent)
    if (!isBoss && e.hp <= 0) {
      pool.release(e)
      score += 100
      burst(e.group.position.x, 1.2, e.group.position.z, 20, VARIANT_STYLES[e.variant].accent, 9)
      hitStop = 0.06
    }
  }

  for (const e of pool.all) {
    if (!e.active) continue
    hits(e, false)
  }
  if (boss && bossHp > 0) hits(boss, true)
  if (heavy) { shakeT = 0.4; hitStop = 0.09 }
}

function damageHero(amount: number) {
  if (invuln > 0) return
  heroHp -= amount
  invuln = 0.9
  hitStop = 0.08
  shakeT = Math.max(shakeT, 0.25)
  sfx.hurt()
  burst(hero.group.position.x, 1.5, hero.group.position.z, 10, 0xff5e8a)
  if (heroHp <= 0 && hearts > 0) {
    hearts--
    heroHp = HERO_MAX
    if (hearts === 0) void die()
  }
}

/** Enemy strike frame: perfect-parry, block, or take the hit. */
function onEnemyStrike(e: Monster, amount: number) {
  const hx = hero.group.position.x, hz = hero.group.position.z
  const ex = e.group.position.x, ez = e.group.position.z

  if (guarding) {
    const mx = (hx + ex) / 2, mz = (hz + ez) / 2
    if (time - guardStart < 0.3) {
      // PERFECT PARRY: metal clash, sparks, attacker staggered
      sfx.clang()
      burst(mx, 1.5, mz, 18, 0xd8e6ff, 9)
      e.addPosture(45)
      e.setAnim('flinch')
      e.lungeCd = 2.5
      hitStop = 0.12
      shakeT = Math.max(shakeT, 0.3)
      camPulse = 1
      playerPosture = Math.max(0, playerPosture - 12)
      if (e.postureBroken) {
        e.stunT = 2.0
        sfx.postureBreak()
        setQuest('⚡ Posture broken! Strike to execute a DEATHBLOW')
      }
      return
    }
    // regular guard: chip damage + posture build
    sfx.guard()
    burst(mx, 1.5, mz, 6, 0xd8e6ff, 4)
    playerPosture = Math.min(PLAYER_POSTURE_MAX, playerPosture + 18)
    e.addPosture(10)
    if (playerPosture >= PLAYER_POSTURE_MAX) {
      // guard crushed — you are staggered
      playerPosture = 0
      guarding = false
      hero.setAnim('flinch')
      invuln = 0.5
      shakeT = Math.max(shakeT, 0.35)
      sfx.postureBreak()
      setQuest('Your guard was broken — recover!')
    }
    return
  }

  if (invuln > 0) return
  damageHero(amount)
}

async function die() {
  running = false
  dead = true
  if (score > best) { best = score; await saveBest(score, best) }
  document.getElementById('deathStats')!.textContent = `Score ${score} · Best ${best}`
  document.getElementById('deathScreen')!.classList.remove('hidden')
}

// ---------- Interaction (chests + shrines + artifacts) ----------
function nearestInteract(): { kind: 'chest' | 'artifact' | 'shrine', dist: number } | null {
  const hx = hero.group.position.x, hz = hero.group.position.z
  let bestD = 3.4
  let kind: 'chest' | 'artifact' | 'shrine' | null = null
  for (const c of world.chests) {
    if (c.opened) continue
    const d = Math.hypot(c.group.position.x - hx, c.group.position.z - hz)
    if (d < bestD) { bestD = d; kind = 'chest' }
  }
  for (const s of world.shrines) {
    if (s.cleansed) continue
    const d = Math.hypot(s.group.position.x - hx, s.group.position.z - hz)
    if (d < bestD) { bestD = d; kind = 'shrine' }
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
  } else if (n.kind === 'shrine') {
    for (const s of world.shrines) {
      if (s.cleansed) continue
      if (Math.hypot(s.group.position.x - hx, s.group.position.z - hz) < 3.4) {
        s.cleansed = true
        score += 300
        difficulty += 0.25
        sfx.cleanse()
        burst(s.group.position.x, 2.4, s.group.position.z, 22, 0x39ff88, 8)
        world.spawnArtifactAt(s.group.position.x, s.group.position.z)
        setQuest('✦ Artifact unlocked! Claim it at the cleansed shrine')
        break
      }
    }
  } else if (n.kind === 'artifact' && world.artifact) {
    world.artifact.collected = true
    score += 500
    difficulty += 0.35
    maxAlive = Math.min(12, maxAlive + 2)
    artifactsCollected++
    burst(world.artifact.mesh.position.x, 1.6, world.artifact.mesh.position.z, 26, 0x7cf6b2, 10)
    if (artifactsCollected === 1) {
      phase = 2
      showBanner('PHASE II — THE CURSED SHRINE GROUNDS')
      setQuest('Phase II: the woods grow restless… survive and gather the second relic')
      setTimeout(() => updateEvents(-999), 100) // force an ambush wave
    } else if (artifactsCollected === 2) {
      phase = 3
      showBanner('FINAL PHASE — THE WARLORD AWAKENS')
      setQuest('☠ WARLORD ODAEMON has come for you. Parry his rage — strike when posture breaks!')
      spawnBoss()
    } else {
      world.spawnArtifact()
      setQuest('✦ The relic resurfaced — cleanse another shrine to reveal it')
    }
  }
}

// ---------- Dynamic events ----------
let ambushT = 22 // first ambush arrives early to hook the player
function updateEvents(dt: number) {
  ambushT -= dt
  if (ambushT > 0) return
  ambushT = Math.max(28, 45 - difficulty * 4)

  // spirits materialize in a ring around a light pillar near the player
  const a = camState.yaw + Math.PI * (0.6 + Math.random() * 0.8)
  const ex = THREE.MathUtils.clamp(hero.group.position.x + Math.cos(a) * 12, -WORLD_R + 5, WORLD_R - 5)
  const ez = THREE.MathUtils.clamp(hero.group.position.z + Math.sin(a) * 12, -WORLD_R + 5, WORLD_R - 5)
  world.spawnPillar(ex, ez)
  const count = Math.min(pool.capacity, 4 + Math.floor(difficulty))
  for (let i = 0; i < count; i++) {
    const m = pool.acquire()
    if (!m) break
    const ra = (i / count) * Math.PI * 2
    m.group.position.set(ex + Math.cos(ra) * 4.5, 0, ez + Math.sin(ra) * 4.5)
    m.setAnim('walk')
    m.resetPose()
  }
  setQuest('☠ AMBUSH! Forest spirits surround the dark pillar')
  setTimeout(() => { world.removePillar(); if (running) setQuest('⚔ Cleanse the Cursed Shrines (E) to reveal artifacts') }, 8000)
}

// ---------- Boss: WARLORD ODAEMON ----------
function spawnBoss() {
  boss = new Monster('magma', BOSS_MAX, 5.4, 34)
  boss.group.scale.setScalar(1.75)
  boss.group.position.set(hero.group.position.x + 14, 0, hero.group.position.z + 14)
  boss.maxPosture = 150
  const aura = new THREE.PointLight(0xff7a2e, 10, 16)
  aura.position.y = 2.5
  boss.group.add(aura)
  activeScene.add(boss.group)
  bossHp = BOSS_MAX
  bossState = 'chase'
  bossT = 2
  bossWrap.style.display = ''
  sfx.postureBreak()
}

function killBoss() {
  if (!boss) return
  burst(boss.group.position.x, 2, boss.group.position.z, 40, 0xff7a2e, 12)
  activeScene.remove(boss.group)
  boss = null
  bossWrap.style.display = 'none'
  score += 1000
  shakeT = 0.8
  running = false
  document.getElementById('victoryStats')!.textContent = `Final score ${score}`
  document.getElementById('victoryScreen')!.classList.remove('hidden')
}

function updateBoss(dt: number) {
  if (!boss || bossHp <= 0) return
  bossT -= dt
  const bx = boss.group.position.x, bz = boss.group.position.z
  const dx = hx0() - bx, dz = hz0() - bz
  const d = Math.hypot(dx, dz)

  if (boss.anim === 'flinch' || boss.stunT > 0) {
    if (boss.stunT > 0) {
      boss.stunT -= dt
      if (boss.animT > 0.32) boss.setAnim('flinch')
      boss.animate(dt)
      if (boss.stunT <= 0) { boss.posture = 0; boss.setAnim('idle') }
      return
    }
    boss.animate(dt)
    return
  }
  if (boss.anim === 'attack') {
    if (boss.animate(dt)) onEnemyStrike(boss, boss.dmg)
    if (boss.animT > 0.7) { boss.setAnim('idle'); bossState = 'rest'; bossT = 0.8 }
    return
  }

  boss.faceTowards(bx + dx, bz + dz)
  switch (bossState) {
    case 'chase': {
      boss.setAnim('walk')
      const spd = boss.speed * (bossHp < BOSS_MAX * 0.5 ? 1.25 : 1) // enrage below 50%
      boss.group.position.x += (dx / d) * spd * dt
      boss.group.position.z += (dz / d) * spd * dt
      if (d < 3.2) { bossState = 'windup'; bossT = 0.35 }
      else if (bossT <= 0 && d > 8 && d < 18) { bossState = 'windup'; bossT = 0.5 } // lunge setup
      break
    }
    case 'windup': {
      boss.setAnim('idle')
      if (d > 6) { // lunge dash into range
        boss.lunging = 0.4
        boss.group.position.x += (dx / d) * 26 * dt
        boss.group.position.z += (dz / d) * 26 * dt
        burst(bx, 0.5, bz, 3, 0xff7a2e, 3)
      }
      if (bossT <= 0) { bossState = 'attack'; boss.comboStage = 3; boss.setAnim('attack') }
      break
    }
    case 'rest': {
      boss.setAnim('idle')
      if (bossT <= 0) { bossState = 'chase'; bossT = 1.2 }
      break
    }
  }
  boss.animate(dt)
}

function hx0() { return hero.group.position.x }
function hz0() { return hero.group.position.z }

// ---------- Update ----------
function update(dt: number) {
  time += dt
  if (slowT > 0) { slowT -= dt; dt *= 0.32 }   // cinematic deathblow slow-motion
  if (hitStop > 0) { hitStop -= dt; dt *= 0.15 }
  if (invuln > 0) invuln -= dt
  if (heroAttackCd > 0) heroAttackCd -= dt
  if (dodgeCd > 0) dodgeCd -= dt
  if (comboWindow > 0) comboWindow -= dt
  if (camPulse > 0) camPulse = Math.max(0, camPulse - dt * 2)

  const inp0 = input.poll()
  const inp = inp0

  // guard / parry stance (cannot move while guarding)
  const wasGuarding = guarding
  guarding = inp.guardHeld && dodgeT <= 0 && hero.anim !== 'attack' && hero.anim !== 'flinch'
  if (guarding && !wasGuarding) guardStart = time
  if (guarding) {
    if (hero.anim !== 'guard') hero.setAnim('guard')
  } else if (wasGuarding && hero.anim === 'guard') {
    hero.setAnim('idle')
  }
  // player posture: builds on blocked hits, decays otherwise; full = guard crushed
  if (!guarding) playerPosture = Math.max(0, playerPosture - 10 * dt)

  // dodge dash with generous i-frames
  if (inp.dodgePressed && dodgeCd <= 0) {
    dodgeCd = 1.3
    dodgeT = 0.3
    invuln = Math.max(invuln, 0.55)
    burst(hero.group.position.x, 0.6, hero.group.position.z, 8, 0x9b6bff, 4)
  }
  const dashing = dodgeT > 0
  if (dashing) dodgeT -= dt

  // screen rotation: hold right mouse and drag
  camState.yaw += input.takeLookDelta()

  // movement — screen-relative: W forward, S back, A left, D right (locked while guarding)
  const mvLen = guarding ? 0 : Math.hypot(inp.moveX, inp.moveY)
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
    if (hero.animate(dt)) resolveHeroStrike()
    const dur = comboStage === 3 ? 0.95 : 0.5
    if (hero.animT > dur) hero.setAnim('idle')
  } else {
    hero.animate(dt)
  }
  hero.group.visible = !(invuln > 0 && Math.floor(time * 14) % 2 === 0)

  // enemies — patrol, chase, lunge, block
  spawnEnemies()
  const hx = hero.group.position.x, hz = hero.group.position.z
  for (const e of pool.all) {
    if (!e.active) continue
    const dx = hx - e.group.position.x
    const dz = hz - e.group.position.z
    const d = Math.hypot(dx, dz)

    if (e.lungeCd > 0) e.lungeCd -= dt
    if (!e.postureBroken) e.addPosture(-5 * dt)

    if (e.anim === 'flinch') {
      if (e.stunT > 0) {
        // posture-broken stagger: held open for a deathblow
        e.stunT -= dt
        if (e.animT > 0.32) e.setAnim('flinch')
        e.animate(dt)
        if (e.stunT <= 0) { e.posture = 0; e.setAnim('idle') }
      } else {
        e.animate(dt)
      }
      continue
    }
    if (e.anim === 'guard') {
      e.animate(dt)
      if (e.animT > 0.8) e.setAnim('idle')
      continue
    }
    if (e.anim === 'attack') {
      if (e.animate(dt)) onEnemyStrike(e, e.dmg)
      if (e.animT > 0.7) e.setAnim('idle')
      continue
    }
    // posture-broken stagger handled in the flinch branch above

    const lunging = e.lunging > 0
    if (lunging) e.lunging -= dt

    if (d < 2.3) {
      e.faceTowards(hx, hz)
      e.setAnim('attack')
    } else if (d < 20) {
      e.faceTowards(hx, hz)
      // aggressive variants (yokai) lunge from mid-range
      if (e.variant === 'electric' && e.lungeCd <= 0 && d > 5 && d < 10) {
        e.lungeCd = 3.5
        e.lunging = 0.38
        e.setAnim('walk')
      }
      const spd = e.speed * difficulty * (lunging ? 4.2 : 1)
      e.group.position.x += (dx / d) * spd * dt
      e.group.position.z += (dz / d) * spd * dt
      if (!lunging) e.setAnim('walk')
    } else {
      // patrol
      e.aiT -= dt
      if (e.aiT <= 0) {
        e.aiT = 1.5 + Math.random() * 2.5
        e.setAnim(Math.random() < 0.5 ? 'idle' : 'walk')
        e.group.rotation.y = Math.random() * Math.PI * 2
      }
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

  updateEvents(dt)
  updateBoss(dt)
  world.updateArtifact(time)
  world.updateShrines(time)
  world.updateParticles(hx, hz, time, dt)
  updateParticles(dt)

  // camera follow + combat screen shake + clash zoom pulse (yaw owned by right-mouse look)
  const effDist = camState.dist - camPulse * 4.5
  const effHeight = camState.height - camPulse * 1.8
  const camTargetX = hx - Math.sin(camState.yaw) * effDist
  const camTargetZ = hz - Math.cos(camState.yaw) * effDist
  camPos.lerp(new THREE.Vector3(camTargetX, effHeight, camTargetZ), Math.min(1, dt * (4 + camPulse * 8)))
  camera.position.copy(camPos)
  if (shakeT > 0) {
    shakeT -= dt
    const s = shakeT * 12
    camera.position.x += (Math.random() - 0.5) * s
    camera.position.y += (Math.random() - 0.5) * s * 0.6
    camera.position.z += (Math.random() - 0.5) * s
  }
  camera.lookAt(hx, 1.8, hz)

  // HUD
  hudHearts.textContent = '♥'.repeat(hearts) + '·'.repeat(3 - hearts)
  hudFill.style.width = `${Math.max(0, heroHp / HERO_MAX) * 100}%`
  hudScore.textContent = String(score)
  hudPosture.style.width = `${Math.min(100, playerPosture)}%`
  if (boss && bossHp > 0) {
    bossFill.style.width = `${Math.max(0, bossHp / BOSS_MAX) * 100}%`
    bossPostureFill.style.width = `${Math.min(100, boss.posture / boss.maxPosture * 100)}%`
  }
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
  guarding = false
  playerPosture = 0
  slowT = 0
  camPulse = 0
  phase = 1
  artifactsCollected = 0
  bossWrap.style.display = 'none'
  if (boss) { activeScene.remove(boss.group); boss = null }
  showBanner('PHASE I — THE WHISPERING BAMBOO FOREST')
  for (const c of world.chests) { c.opened = false; c.lid.rotation.x = 0 }
  for (const e of pool.all) if (e.active) pool.release(e)
  setQuest('⚔ Cleanse the Cursed Shrines (E) to reveal the Ancient Artifact')
  world.removePillar()
  world.clearArtifact()
  for (const s of world.shrines) s.cleansed = false
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
document.getElementById('againBtn')!.addEventListener('click', () => {
  document.getElementById('victoryScreen')!.classList.add('hidden')
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
