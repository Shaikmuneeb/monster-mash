// Samurai Monsters — Oni & Yokai warriors, built procedurally from low-poly primitives.
// Each warrior: horned kabuto helmet, glowing demonic eyes, lamellar armor plates,
// and a katana with a glowing energy slash trail. All pooled for zero mid-frame allocation.

import * as THREE from 'three'

export type MonsterVariant = 'toxic' | 'electric' | 'magma'

interface VariantStyle {
  name: string
  armor: number        // lacquered armor color
  accent: number       // bioluminescent glow (crest, blade edge, eyes)
  skin: number
  scale: number
}

export const VARIANT_STYLES: Record<MonsterVariant, VariantStyle> = {
  toxic:    { name: 'Mori Oni',   armor: 0x1d4d33, accent: 0x39ff88, skin: 0x2a6e4a, scale: 1.0 },
  electric: { name: 'Yokai',      armor: 0x33246b, accent: 0x9b6bff, skin: 0x4a3a7e, scale: 0.95 },
  magma:    { name: 'Akuma',      armor: 0x5c1f14, accent: 0xff7a2e, skin: 0x7e3a24, scale: 1.12 },
}

export type MonsterAnim = 'idle' | 'walk' | 'attack' | 'flinch' | 'guard'

export class Monster {
  group = new THREE.Group()
  hp: number
  maxHp: number
  speed: number
  dmg: number
  variant: MonsterVariant
  active = false

  anim: MonsterAnim = 'idle'
  animT = 0
  phase = Math.random() * Math.PI * 2
  comboStage: 1 | 2 | 3 = 1
  aiT = Math.random() * 3      // wander decision timer
  lungeCd = 0                  // aggressive lunge cooldown
  lunging = 0                  // lunge seconds remaining

  // posture (guard gauge): parries and guarded hits build it; a full bar staggers
  posture = 0
  maxPosture = 100
  stunT = 0                    // posture-broken stagger remaining

  addPosture(n: number) {
    this.posture = Math.max(0, Math.min(this.maxPosture, this.posture + n))
  }
  get postureBroken() { return this.posture >= this.maxPosture }

  private torso!: THREE.Group
  private arms: THREE.Group[] = []      // [left, right]
  private legs: THREE.Group[] = []      // [left, right]
  private swordPivot!: THREE.Group
  private katana!: THREE.Group
  private bladeGlow!: THREE.MeshStandardMaterial
  private crestGlow!: THREE.MeshStandardMaterial
  private slash!: THREE.Mesh
  private slashMat!: THREE.MeshBasicMaterial
  private strikeFired = false

  constructor(variant: MonsterVariant, hp: number, speed: number, dmg: number) {
    this.variant = variant
    this.hp = this.maxHp = hp
    this.speed = speed
    this.dmg = dmg
    this.build()
  }

  private build() {
    const st = VARIANT_STYLES[this.variant]
    const armorMat = new THREE.MeshStandardMaterial({ color: st.armor, roughness: 0.42, metalness: 0.55 })
    const skinMat = new THREE.MeshStandardMaterial({ color: st.skin, roughness: 0.7, metalness: 0.1 })
    this.crestGlow = new THREE.MeshStandardMaterial({ color: st.accent, emissive: st.accent, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.3 })
    this.bladeGlow = new THREE.MeshStandardMaterial({ color: 0xd8e6ff, emissive: st.accent, emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.8 })

    // ---- torso + lamellar armor plates ----
    this.torso = new THREE.Group()
    this.torso.position.y = 1.15
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.62, 0.95, 8), skinMat)
    chest.castShadow = true
    this.torso.add(chest)
    const plateGeo = new THREE.BoxGeometry(0.62, 0.2, 0.68)
    for (let i = 0; i < 3; i++) {          // chest lamellar rows
      const plate = new THREE.Mesh(plateGeo, armorMat)
      plate.position.set(0, 0.28 - i * 0.26, 0.12)
      plate.rotation.x = -0.12 + i * 0.1
      plate.castShadow = true
      this.torso.add(plate)
    }
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.72), this.crestGlow)
    sash.position.y = -0.42
    this.torso.add(sash)

    // ---- head: oni face + kabuto ----
    const head = new THREE.Group()
    head.position.y = 0.82
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), skinMat)
    skull.castShadow = true
    head.add(skull)
    const menpo = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.28), armorMat) // face mask plate
    menpo.position.set(0, -0.08, 0.22)
    head.add(menpo)
    const eyeGeo = new THREE.SphereGeometry(0.075, 8, 8)
    const eyeMat = new THREE.MeshStandardMaterial({ color: st.accent, emissive: st.accent, emissiveIntensity: 2.4 })
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(0.13 * sx, 0.1, 0.28)
      head.add(eye)
    }
    // kabuto: bowl, brim, neck guard
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.37, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), armorMat)
    bowl.position.y = 0.12
    bowl.castShadow = true
    head.add(bowl)
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.5), armorMat)
    brim.position.set(0, 0.08, 0.12)
    brim.rotation.x = 0.16
    head.add(brim)
    const shikoro = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.3, 8, 1, true), armorMat)
    shikoro.position.y = 0.02
    shikoro.rotation.x = Math.PI
    head.add(shikoro)
    // maedate: glowing crescent horns
    const hornGeo = new THREE.ConeGeometry(0.06, 0.42, 6)
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(hornGeo, this.crestGlow)
      horn.position.set(0.16 * sx, 0.42, 0.1)
      horn.rotation.z = -sx * 0.55
      head.add(horn)
    }
    this.torso.add(head)

    // ---- arms: pauldrons + pivots; katana on the right ----
    const pauldronGeo = new THREE.SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6)
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.position.set(0.68 * sx, 0.32, 0)
      const pauldron = new THREE.Mesh(pauldronGeo, armorMat)
      pauldron.castShadow = true
      pivot.add(pauldron)
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.5, 4, 8), skinMat)
      arm.position.y = -0.36
      arm.castShadow = true
      pivot.add(arm)
      this.arms.push(pivot)
      this.torso.add(pivot)
    }

    this.katana = new THREE.Group()
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.34, 6), armorMat)
    handle.position.y = 0.17
    this.katana.add(handle)
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 10), this.crestGlow)
    guard.position.y = 0.36
    this.katana.add(guard)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.012), this.bladeGlow)
    blade.position.y = 0.95
    blade.rotation.z = 0.04
    this.katana.add(blade)
    this.katana.position.set(0, -0.5, 0.05)
    this.arms[1].add(this.katana)

    // ---- legs: hakama-clad, animated walk cycle ----
    const legMat = armorMat
    const legGeo = new THREE.CapsuleGeometry(0.13, 0.5, 4, 8)
    const footGeo = new THREE.BoxGeometry(0.22, 0.1, 0.36)
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.position.set(0.24 * sx, 0.72, 0)
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.y = -0.32
      leg.castShadow = true
      pivot.add(leg)
      const foot = new THREE.Mesh(footGeo, this.crestGlow)
      foot.position.set(0, -0.62, 0.08)
      pivot.add(foot)
      this.legs.push(pivot)
      this.group.add(pivot)
    }

    // ---- slash trail: additive arc, hidden except mid-swing ----
    this.slashMat = new THREE.MeshBasicMaterial({
      color: st.accent, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    })
    this.slash = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.75, 20, 1, -0.4, Math.PI * 0.95), this.slashMat)
    this.slash.rotation.x = -Math.PI / 2.15
    this.slash.rotation.z = Math.PI * 0.42
    this.slash.position.set(0.35, 0.25, 0.15)
    this.slash.visible = false
    this.torso.add(this.slash)

    this.group.add(this.torso)
    this.group.scale.setScalar(st.scale)
  }

  setAnim(a: MonsterAnim) {
    if (this.anim !== a) { this.anim = a; this.animT = 0; this.strikeFired = false }
  }

  /** Procedural animation tick. Returns true on the frame the slash connects. */
  animate(dt: number): boolean {
    this.animT += dt
    const t = this.animT
    let strike = false
    const breathe = Math.sin(t * 2.2 + this.phase)

    switch (this.anim) {
      case 'idle': {
        this.torso.position.y = 1.15 + breathe * 0.04
        this.torso.rotation.z = breathe * 0.02
        this.arms[0].rotation.x = breathe * 0.08
        this.arms[1].rotation.x = 0.15 - breathe * 0.06   // hand resting near the saya
        this.legs[0].rotation.x = breathe * 0.03
        this.legs[1].rotation.x = -breathe * 0.03
        this.slashMat.opacity = 0
        break
      }
      case 'walk': {
        const b = Math.sin(t * 9)
        this.group.position.y = Math.abs(b) * 0.08
        this.torso.rotation.z = b * 0.05
        this.arms[0].rotation.x = b * 0.6
        this.arms[1].rotation.x = -b * 0.45 + 0.15
        this.legs[0].rotation.x = b * 0.75
        this.legs[1].rotation.x = -b * 0.75
        this.slashMat.opacity = 0
        break
      }
      case 'attack': {
        // iaijutsu combo: stage 1/2 quick cuts, stage 3 heavy finisher
        const heavy = this.comboStage === 3
        const dur = heavy ? 0.95 : 0.5
        const p = Math.min(t / dur, 1)
        const wind = heavy ? 0.42 : 0.4
        const cutEnd = heavy ? 0.64 : 0.62
        if (p < wind) {
          const w = p / wind
          this.arms[1].rotation.x = 0.15 - w * (heavy ? 2.8 : 2.4)
          this.arms[1].rotation.z = -w * 0.5
          this.torso.rotation.y = w * (heavy ? 0.55 : 0.35)
          if (heavy) this.torso.rotation.x = -w * 0.1
          this.slash.visible = false
        } else if (p < cutEnd) {
          const s = (p - wind) / (cutEnd - wind)
          this.arms[1].rotation.x = -(heavy ? 2.8 : 2.25) + s * (heavy ? 3.5 : 2.9)
          this.arms[1].rotation.z = -0.5 + s * 0.5
          this.torso.rotation.y = (heavy ? 0.55 : 0.35) - s * (heavy ? 1.1 : 0.7)
          if (heavy) this.torso.rotation.x = 0.1 - s * 0.25
          this.slash.visible = true
          this.slash.scale.setScalar(heavy ? 1.35 : 1)
          this.slashMat.opacity = (heavy ? 1 : 0.85) * (1 - s * 0.35)
          if (!this.strikeFired) { strike = true; this.strikeFired = true }
        } else {
          const r = (p - cutEnd) / (1 - cutEnd)
          this.arms[1].rotation.x = (heavy ? 0.7 : 0.65) - r * (heavy ? 0.6 : 0.5)
          this.arms[1].rotation.z = 0
          this.torso.rotation.y = (heavy ? -0.55 : -0.35) + r * (heavy ? 0.55 : 0.35)
          if (heavy) this.torso.rotation.x = -0.15 + r * 0.25
          this.slashMat.opacity = (heavy ? 0.7 : 0.5) * (1 - r)
        }
        // lunging step into the swing
        const step = Math.sin(Math.min(p * Math.PI, Math.PI)) * (heavy ? 0.35 : 0.18)
        this.legs[0].rotation.x = -step * 2
        this.legs[1].rotation.x = step * 1.2
        break
      }
      case 'guard': {
        // blade raised vertically in front — blocking stance
        this.arms[1].rotation.x = -1.5
        this.arms[1].rotation.z = 0.4
        this.arms[0].rotation.x = -0.7
        this.torso.rotation.y = 0.25
        this.legs[0].rotation.x = -0.2
        this.legs[1].rotation.x = 0.2
        const shimmer = 0.5 + Math.sin(t * 14) * 0.25
        this.slash.visible = true
        this.slashMat.opacity = shimmer * 0.25
        break
      }
      case 'flinch': {
        const p = Math.min(t / 0.3, 1)
        this.torso.rotation.x = Math.sin(p * Math.PI) * -0.45
        this.torso.position.y = 1.15 - Math.sin(p * Math.PI) * 0.12
        if (p >= 1) this.setAnim('idle')
        break
      }
    }

    const glowPulse = 0.55 + Math.sin(t * 3 + this.phase) * 0.15
    this.crestGlow.emissiveIntensity = glowPulse
    this.bladeGlow.emissiveIntensity = 1.1 + Math.sin(t * 5 + this.phase) * 0.25
    return strike
  }

  faceTowards(x: number, z: number) {
    const a = Math.atan2(x - this.group.position.x, z - this.group.position.z)
    this.group.rotation.y = a
  }

  /** Clear pose leftovers from a previous life (pool reuse). */
  resetPose() {
    this.torso.rotation.set(0, 0, 0)
    this.torso.position.y = 1.15
    for (const a of this.arms) a.rotation.set(0, 0, 0)
    for (const l of this.legs) l.rotation.set(0, 0, 0)
    this.group.position.y = 0
    this.comboStage = 1
    this.slash.visible = false
    this.slashMat.opacity = 0
  }
}

/** Fixed-size object pool so combat never allocates meshes mid-frame. */
export class MonsterPool {
  private pool: Monster[] = []
  private idx = 0

  constructor(
    scene: THREE.Scene,
    private size: number,
    variants: MonsterVariant[],
    stats: (v: MonsterVariant) => { hp: number; speed: number; dmg: number },
  ) {
    for (let i = 0; i < size; i++) {
      const v = variants[i % variants.length]
      const s = stats(v)
      const m = new Monster(v, s.hp, s.speed, s.dmg)
      m.group.visible = false
      m.active = false
      scene.add(m.group)
      this.pool.push(m)
    }
  }

  acquire(): Monster | null {
    for (let i = 0; i < this.size; i++) {
      const m = this.pool[(this.idx + i) % this.size]
      if (!m.active) {
        this.idx = (this.idx + i + 1) % this.size
        m.active = true
        m.group.visible = true
        m.hp = m.maxHp
        m.setAnim('idle')
        m.resetPose()
        return m
      }
    }
    return null
  }

  release(m: Monster) {
    m.active = false
    m.group.visible = false
  }

  get capacity(): number { return this.size }
  get all(): Monster[] { return this.pool }
}
