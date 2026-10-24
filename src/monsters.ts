// Procedural stylized monster characters with a lightweight animation state machine.
// All monsters share one rig layout (body, eyes, horns, arms) and are built from
// low-poly primitives — cheap enough for dozens of simultaneous mobile FPS-60 monsters.

import * as THREE from 'three'

export type MonsterVariant = 'toxic' | 'electric' | 'magma'

interface VariantStyle {
  body: number
  accent: number      // emissive: bioluminescent glow
  eye: number
  horns: number
  scale: number
}

export const VARIANT_STYLES: Record<MonsterVariant, VariantStyle> = {
  toxic:    { body: 0x1d5c3a, accent: 0x39ff88, eye: 0xd4ff5e, horns: 2, scale: 1.0 },
  electric: { body: 0x3a2a6e, accent: 0x9b6bff, eye: 0x6bf0ff, horns: 3, scale: 0.92 },
  magma:    { body: 0x5c2413, accent: 0xff7a2e, eye: 0xffd23e, horns: 2, scale: 1.15 },
}

export type MonsterAnim = 'idle' | 'walk' | 'attack' | 'flinch'

export class Monster {
  group = new THREE.Group()
  hp: number
  maxHp: number
  speed: number
  dmg: number
  variant: MonsterVariant
  active = false

  // animation state
  anim: MonsterAnim = 'idle'
  animT = 0          // time in current anim
  phase = Math.random() * Math.PI * 2

  private body!: THREE.Mesh
  private arms: THREE.Object3D[] = []
  private head!: THREE.Object3D
  private glowMat!: THREE.MeshStandardMaterial

  constructor(variant: MonsterVariant, hp: number, speed: number, dmg: number) {
    this.variant = variant
    this.hp = this.maxHp = hp
    this.speed = speed
    this.dmg = dmg
    this.build()
  }

  private build() {
    const st = VARIANT_STYLES[this.variant]
    const bodyMat = new THREE.MeshStandardMaterial({ color: st.body, roughness: 0.65, metalness: 0.15 })
    this.glowMat = new THREE.MeshStandardMaterial({
      color: st.accent, emissive: st.accent, emissiveIntensity: 0.55, roughness: 0.4,
    })
    const eyeMat = new THREE.MeshStandardMaterial({ color: st.eye, emissive: st.eye, emissiveIntensity: 2.2 })

    this.body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), bodyMat)
    this.body.scale.set(1, 1.15, 0.95)
    this.body.position.y = 1.0
    this.body.castShadow = true
    this.group.add(this.body)

    this.head = new THREE.Group()
    this.head.position.y = 1.75
    const eyeGeo = new THREE.SphereGeometry(0.13, 10, 10)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat)
      eye.position.set(0.26 * sx, 0.08, 0.62)
      this.head.add(eye)
    }
    const hornGeo = new THREE.ConeGeometry(0.11, 0.5, 6)
    for (let i = 0; i < st.horns; i++) {
      const horn = new THREE.Mesh(hornGeo, this.glowMat)
      const a = (i / st.horns) * Math.PI * 2
      horn.position.set(Math.cos(a) * 0.3, 0.42, Math.sin(a) * 0.3 - 0.05)
      horn.rotation.z = -Math.cos(a) * 0.4
      horn.rotation.x = Math.sin(a) * 0.4
      this.head.add(horn)
    }
    this.group.add(this.head)

    const armGeo = new THREE.CapsuleGeometry(0.16, 0.55, 4, 8)
    const armMat = bodyMat
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.position.set(0.85 * sx, 1.25, 0)
      const arm = new THREE.Mesh(armGeo, armMat)
      arm.position.y = -0.35
      arm.castShadow = true
      pivot.add(arm)
      this.arms.push(pivot)
      this.group.add(pivot)
    }

    this.group.scale.setScalar(st.scale)
  }

  /** Clear pose leftovers from a previous life (pool reuse). */
  resetPose() {
    this.body.rotation.set(0, 0, 0)
    this.body.scale.y = 1.15
    this.head.position.y = 1.75
    for (const a of this.arms) a.rotation.x = 0
    this.group.position.y = 0
  }

  setAnim(a: MonsterAnim) {
    if (this.anim !== a) { this.anim = a; this.animT = 0 }
  }

  /** Procedural animation tick. Returns true when an attack reaches its strike frame. */
  animate(dt: number): boolean {
    this.animT += dt
    const t = this.animT
    let strike = false

    switch (this.anim) {
      case 'idle': {
        const b = Math.sin(t * 2.2 + this.phase)
        this.body.scale.y = 1.15 + b * 0.05
        this.head.position.y = 1.75 + b * 0.05
        this.arms[0].rotation.x = b * 0.12
        this.arms[1].rotation.x = -b * 0.12
        break
      }
      case 'walk': {
        const b = Math.sin(t * 9)
        this.group.position.y = Math.abs(b) * 0.09
        this.body.rotation.z = b * 0.08
        this.arms[0].rotation.x = b * 0.7
        this.arms[1].rotation.x = -b * 0.7
        this.body.scale.y = 1.15 + Math.sin(t * 4.5) * 0.03
        break
      }
      case 'attack': {
        // windup 0..0.35, strike at ~0.35, recover to 0.7
        const p = Math.min(t / 0.7, 1)
        if (p < 0.5) {
          const w = p / 0.5
          this.arms[0].rotation.x = -w * 2.2
          this.arms[1].rotation.x = -w * 2.2
          this.body.rotation.x = -w * 0.25
        } else {
          const s = (p - 0.5) / 0.5
          this.arms[0].rotation.x = -2.2 + s * 3.4
          this.arms[1].rotation.x = -2.2 + s * 3.4
          this.body.rotation.x = -0.25 + s * 0.5
          if (!strike && s > 0.25) strike = true
        }
        break
      }
      case 'flinch': {
        const p = Math.min(t / 0.3, 1)
        this.body.rotation.x = Math.sin(p * Math.PI) * -0.5
        this.head.position.y = 1.75 - Math.sin(p * Math.PI) * 0.15
        if (p >= 1) this.setAnim('idle')
        break
      }
    }
    this.glowMat.emissiveIntensity = 0.55 + Math.sin(t * 3 + this.phase) * 0.15
    return strike
  }

  faceTowards(x: number, z: number) {
    const a = Math.atan2(x - this.group.position.x, z - this.group.position.z)
    this.group.rotation.y = a
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
    return null // pool exhausted: skip spawn this tick (no mid-game allocation)
  }

  release(m: Monster) {
    m.active = false
    m.group.visible = false
  }

  get all(): Monster[] { return this.pool }
}
