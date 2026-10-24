// World: spooky neon-lit monster realm — ground, bioluminescent props (instanced),
// ambient particle fields (spores + embers), loot chests and ancient artifacts.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const WORLD_R = 140 // playable radius

export interface Chest {
  group: THREE.Group
  lid: THREE.Object3D
  opened: boolean
}

export interface Artifact {
  mesh: THREE.Mesh
  beacon: THREE.Mesh
  collected: boolean
}

export class World {
  scene = new THREE.Scene()
  private spores!: THREE.Points
  private leaves!: { pts: THREE.Points; vel: Float32Array; geo: THREE.BufferGeometry }
  private mist: THREE.Mesh[] = []
  chests: Chest[] = []
  shrines: { group: THREE.Group; orb: THREE.Mesh; cleansed: boolean }[] = []
  ambushPillar: THREE.Mesh | null = null
  artifact: Artifact | null = null
  private artifactCount = 0

  constructor() {
    this.buildSkyAndFog()
    this.buildLights()
    this.buildGround()
    this.buildProps()
    this.buildForest()
    this.buildSacred()
    this.buildMist()
    this.buildParticles()
    this.buildChests()
    this.buildShrines()
  }

  private buildSkyAndFog() {
    // gradient dusk sky dome via shader
    const skyGeo = new THREE.SphereGeometry(600, 24, 16)
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x050b08) },
        mid: { value: new THREE.Color(0x122b1e) },
        bot: { value: new THREE.Color(0x1e3325) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){
          float h = normalize(vP).y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, pow(-h, 0.7));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    this.scene.add(new THREE.Mesh(skyGeo, skyMat))
    this.scene.fog = new THREE.FogExp2(0x0d1f16, 0.022)
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x7ca890, 0x142018, 1.3))
    const moon = new THREE.DirectionalLight(0xbfe8d0, 1.5)
    moon.position.set(-40, 70, -30)
    moon.castShadow = true
    moon.shadow.mapSize.set(1024, 1024)
    moon.shadow.camera.left = -60; moon.shadow.camera.right = 60
    moon.shadow.camera.top = 60; moon.shadow.camera.bottom = -60
    moon.shadow.camera.far = 200
    this.scene.add(moon)
  }

  private buildGround() {
    // mossy terrain: dark forest floor with organic vertex-colored patches
    const geo = new THREE.CircleGeometry(WORLD_R + 30, 64)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const moss = new THREE.Color(0x12291a)
    const dark = new THREE.Color(0x0b1810)
    const lichen = new THREE.Color(0x1c3524)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i)
      // two-octave value noise (cheap, deterministic)
      const n =
        Math.sin(x * 0.11) * Math.cos(y * 0.13) +
        Math.sin(x * 0.31 + 1.7) * Math.cos(y * 0.27 + 0.4) * 0.5
      c.copy(n > 0.35 ? lichen : n > -0.3 ? moss : dark)
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const g = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))
    g.rotation.x = -Math.PI / 2
    g.receiveShadow = true
    this.scene.add(g)
  }

  private buildProps() {
    // instanced glow mushrooms (toxic green + electric purple)
    const capGeo = new THREE.ConeGeometry(0.55, 0.9, 7)
    const stemGeo = new THREE.CylinderGeometry(0.12, 0.18, 0.7, 6)
    const capMat = new THREE.MeshStandardMaterial({ color: 0x39ff88, emissive: 0x39ff88, emissiveIntensity: 1.1, roughness: 0.5 })
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x241c3a, roughness: 0.9 })
    const N = 110
    const caps = new THREE.InstancedMesh(capGeo, capMat, N)
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, N)
    caps.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    stems.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 8 + Math.random() * (WORLD_R - 12)
      pos.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      const s = 0.7 + Math.random() * 1.6
      scl.set(s, s, s)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2)
      m.compose(pos, q, scl)
      caps.setMatrixAt(i, m)
      pos.y = 0.3 * s
      m.compose(pos, q, scl)
      stems.setMatrixAt(i, m)
    }
    this.scene.add(caps, stems)

    // instanced rocks
    const rockGeo = new THREE.DodecahedronGeometry(1, 0)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2b2140, roughness: 1, flatShading: true })
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 70)
    rocks.castShadow = true
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 10 + Math.random() * (WORLD_R - 5)
      pos.set(Math.cos(a) * r, Math.random() * 0.2, Math.sin(a) * r)
      scl.set(0.8 + Math.random() * 2.4, 0.6 + Math.random() * 1.6, 0.8 + Math.random() * 2.4)
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random()))
      m.compose(pos, q, scl)
      rocks.setMatrixAt(i, m)
    }
    this.scene.add(rocks)
  }

  private buildForest() {
    // ---- stylized pines: trunk + three canopy tiers merged into ONE geometry, instanced ----
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 1.6, 6)
    trunk.translate(0, 0.8, 0)
    const tiers: THREE.BufferGeometry[] = [trunk]
    const coneSpecs: Array<[number, number, number]> = [
      [1.5, 1.7, 1.4], [1.15, 1.5, 2.4], [0.8, 1.4, 3.35],
    ]
    for (const [r, h, y] of coneSpecs) {
      const c = new THREE.ConeGeometry(r, h, 7)
      c.translate(0, y, 0)
      tiers.push(c)
    }
    const pineGeo = mergeGeometries(tiers)!
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x14301f, roughness: 0.95, flatShading: true })
    const N_PINE = 56
    const pines = new THREE.InstancedMesh(pineGeo, pineMat, N_PINE)
    pines.castShadow = true
    pines.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < N_PINE; i++) {
      // dense clusters: 60% of pines gather around grove centers, the rest scatter
      let a: number, r: number
      if (i % 5 < 3) {
        const grove = Math.floor(i / 5) % 7
        const ga = (grove / 7) * Math.PI * 2 + 0.4
        const gr = 24 + (grove % 3) * 30
        a = ga + (Math.random() - 0.5) * 0.8
        r = gr + (Math.random() - 0.5) * 14
      } else {
        a = Math.random() * Math.PI * 2
        r = 14 + Math.random() * (WORLD_R - 10)
      }
      pos.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      const s = 1.3 + Math.random() * 2.2
      scl.set(s, s * (0.85 + Math.random() * 0.4), s)
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2)
      m.compose(pos, q, scl)
      pines.setMatrixAt(i, m)
    }
    this.scene.add(pines)

    // ---- winding stone path: flat stones spiraling from the center outward ----
    const stoneGeo = new THREE.CylinderGeometry(0.55, 0.62, 0.12, 7)
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 1, flatShading: true })
    const pathCount = 90
    const path = new THREE.InstancedMesh(stoneGeo, stoneMat, pathCount)
    path.receiveShadow = true
    let px = 0, pz = 0, pa = 0
    for (let i = 0; i < pathCount; i++) {
      pa += 0.16 + Math.random() * 0.05
      const pr = 3 + pa * 2.4
      px = Math.cos(pa) * pr
      pz = Math.sin(pa) * pr
      q.setFromEuler(new THREE.Euler(0, Math.random() * Math.PI, 0))
      scl.set(0.8 + Math.random() * 0.5, 1, 0.8 + Math.random() * 0.5)
      pos.set(px + (Math.random() - 0.5) * 0.8, 0.02, pz + (Math.random() - 0.5) * 0.8)
      m.compose(pos, q, scl)
      path.setMatrixAt(i, m)
    }
    this.scene.add(path)

    // ---- organic ground foliage: ferns + moss bumps ----
    const fernGeo = new THREE.ConeGeometry(0.4, 0.7, 5)
    fernGeo.translate(0, 0.3, 0)
    const fernMat = new THREE.MeshStandardMaterial({ color: 0x1d4a2a, roughness: 0.9, flatShading: true })
    const bumpGeo = new THREE.IcosahedronGeometry(0.3, 0)
    const bumpMat = new THREE.MeshStandardMaterial({ color: 0x24422c, roughness: 1, flatShading: true })
    const N_FERN = 130
    const ferns = new THREE.InstancedMesh(fernGeo, fernMat, N_FERN)
    const bumps = new THREE.InstancedMesh(bumpGeo, bumpMat, 80)
    for (let i = 0; i < N_FERN; i++) {
      const fa = Math.random() * Math.PI * 2
      const fr = 6 + Math.random() * (WORLD_R - 4)
      const s = 0.6 + Math.random() * 1.3
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2)
      scl.set(s, s, s)
      pos.set(Math.cos(fa) * fr, 0, Math.sin(fa) * fr)
      m.compose(pos, q, scl)
      ferns.setMatrixAt(i, m)
      if (i < 80) {
        const ba = Math.random() * Math.PI * 2
        const br = 8 + Math.random() * (WORLD_R - 8)
        scl.setScalar(0.5 + Math.random())
        pos.set(Math.cos(ba) * br, 0.1, Math.sin(ba) * br)
        m.compose(pos, q, scl)
        bumps.setMatrixAt(i, m)
      }
    }
    this.scene.add(ferns, bumps)

    // ---- ancient twisted trees (landmark silhouettes, individually crafted) ----
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x241a28, roughness: 1, flatShading: true })
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x2e2033, roughness: 1, flatShading: true })
    const wispMat = new THREE.MeshStandardMaterial({ color: 0x9b6bff, emissive: 0x9b6bff, emissiveIntensity: 0.8, roughness: 0.5 })
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group()
      const H = 5 + Math.random() * 3
      const segs = 4
      let px = 0, py = 0
      let tiltX = (Math.random() - 0.5) * 0.35
      let tiltZ = (Math.random() - 0.5) * 0.35
      for (let s = 0; s < segs; s++) {
        const segH = H / segs
        const r0 = 0.5 * (1 - s / segs) + 0.12
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.75, r0, segH, 7), barkMat)
        seg.position.set(px, py + segH / 2, 0)
        seg.rotation.z = tiltZ
        seg.rotation.x = tiltX
        seg.castShadow = true
        g.add(seg)
        // drooping gnarled branch every other segment
        if (s > 0) {
          const br = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.6 + Math.random(), 5), branchMat)
          const ba = Math.random() * Math.PI * 2
          br.position.set(px + Math.cos(ba) * 0.5, py + segH * 0.7, Math.sin(ba) * 0.5)
          br.rotation.z = Math.cos(ba) * 2.2
          br.rotation.x = -Math.sin(ba) * 2.2
          g.add(br)
        }
        px += tiltZ * segH * 0.9
        tiltZ += (Math.random() - 0.5) * 0.22
        tiltX += (Math.random() - 0.5) * 0.18
        py += segH * 0.96
      }
      // soul wisps coiling the crown
      for (let w = 0; w < 3; w++) {
        const wisp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), wispMat)
        wisp.position.set((Math.random() - 0.5) * 1.4, H + Math.random() * 1.2, (Math.random() - 0.5) * 1.4)
        g.add(wisp)
      }
      const a = (i / 7) * Math.PI * 2 + 0.9
      const r = 26 + Math.random() * (WORLD_R - 40)
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      this.scene.add(g)
    }
  }

  private buildSacred() {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    // ---- glowing stone lanterns (toro) along the stone path ----
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0x3d4046, roughness: 0.95, flatShading: true })
    const flameMat = new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0xffa33e, emissiveIntensity: 1.8, roughness: 0.4 })
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group()
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.5, 6), lanternMat)
      base.position.y = 0.25
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 6), lanternMat)
      pillar.position.y = 1.0
      const lightBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), lanternMat)
      lightBox.position.y = 1.75
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), flameMat)
      flame.position.y = 1.75
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.35, 6), lanternMat)
      roof.position.y = 2.1
      roof.castShadow = true
      g.add(base, pillar, lightBox, flame, roof)
      const glow = new THREE.PointLight(0xffa33e, 3.5, 9)
      glow.position.y = 1.8
      g.add(glow)
      const la = (i / 10) * Math.PI * 2
      const lr = 3 + ((i * 2.4) % 26)
      g.position.set(Math.cos(la) * lr, 0, Math.sin(la) * lr)
      this.scene.add(g)
    }

    // ---- giant sacred torii gates spanning the stone path ----
    const toriiMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.6, metalness: 0.2 })
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group()
      const H = 9 + i * 1.5
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, H, 8), toriiMat)
        p.position.set(4.2 * sx, H / 2, 0)
        p.castShadow = true
        g.add(p)
      }
      const kasagi = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.55, 0.9), toriiMat)
      kasagi.position.y = H
      kasagi.rotation.z = 0.02
      kasagi.castShadow = true
      const nuki = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.42, 0.6), toriiMat)
      nuki.position.y = H * 0.82
      g.add(kasagi, nuki)
      const pa = (i / 3) * Math.PI * 2 + 0.9
      const pr = 10 + i * 8
      g.position.set(Math.cos(pa) * pr, 0, Math.sin(pa) * pr)
      g.rotation.y = pa + Math.PI / 2 // span across the spiral path
      this.scene.add(g)
    }

    // ---- bamboo groves: tall thin culms in dense clusters ----
    const culmGeo = new THREE.CylinderGeometry(0.07, 0.09, 7, 5)
    culmGeo.translate(0, 3.5, 0)
    const culmMat = new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.7 })
    const leafGeo = new THREE.ConeGeometry(0.28, 1.0, 4)
    leafGeo.translate(0, 0.5, 0)
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x55803c, roughness: 0.8, flatShading: true })
    const N_CULM = 70
    const culms = new THREE.InstancedMesh(culmGeo, culmMat, N_CULM)
    const bLeaves = new THREE.InstancedMesh(leafGeo, leafMat, N_CULM * 2)
    culms.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    let li = 0
    for (let i = 0; i < N_CULM; i++) {
      const grove = i % 4
      const ga = (grove / 4) * Math.PI * 2 + 2.1
      const gr = 34 + grove * 16
      const a = ga + (Math.random() - 0.5) * 0.9
      const r = gr + (Math.random() - 0.5) * 10
      const s = 0.8 + Math.random() * 0.6
      q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.12, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.12))
      scl.set(s, s * (0.8 + Math.random() * 0.5), s)
      pos.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      m.compose(pos, q, scl)
      culms.setMatrixAt(i, m)
      for (let k = 0; k < 2 && li < N_CULM * 2; k++, li++) {
        q.setFromEuler(new THREE.Euler(Math.random() * 1.2, Math.random() * Math.PI * 2, Math.random() * 1.2))
        pos.set(Math.cos(a) * r + (Math.random() - 0.5), 4.5 + Math.random() * 2, Math.sin(a) * r + (Math.random() - 0.5))
        scl.setScalar(0.8 + Math.random() * 0.6)
        m.compose(pos, q, scl)
        bLeaves.setMatrixAt(li, m)
      }
    }
    this.scene.add(culms, bLeaves)
  }

  private buildMist() {
    // soft radial mist patches drifting low over the forest floor
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const c2 = cv.getContext('2d')!
    const grad = c2.createRadialGradient(64, 64, 4, 64, 64, 62)
    grad.addColorStop(0, 'rgba(160,220,190,0.35)')
    grad.addColorStop(1, 'rgba(160,220,190,0)')
    c2.fillStyle = grad
    c2.fillRect(0, 0, 128, 128)
    const mistTex = new THREE.CanvasTexture(cv)
    const mat = new THREE.MeshBasicMaterial({
      map: mistTex, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    })
    this.mist = []
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), mat)
      p.rotation.x = -Math.PI / 2
      p.rotation.z = Math.random() * Math.PI * 2
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * WORLD_R
      p.position.set(Math.cos(a) * r, 0.6 + Math.random() * 0.8, Math.sin(a) * r)
      this.scene.add(p)
      this.mist.push(p)
    }
  }

  private buildParticles() {
    // soft round sprite so particles never render as harsh neon squares
    const cv = document.createElement('canvas')
    cv.width = cv.height = 64
    const c2 = cv.getContext('2d')!
    const grad = c2.createRadialGradient(32, 32, 2, 32, 32, 30)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.4, 'rgba(255,255,255,0.55)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    c2.fillStyle = grad
    c2.fillRect(0, 0, 64, 64)
    const dotTex = new THREE.CanvasTexture(cv)

    // fireflies hovering low over the moss
    const SN = 140
    const sPos = new Float32Array(SN * 3)
    for (let i = 0; i < SN; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 90
      sPos[i * 3 + 1] = 0.4 + Math.random() * 2.6
      sPos[i * 3 + 2] = (Math.random() - 0.5) * 90
    }
    const sGeo = new THREE.BufferGeometry()
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
    this.spores = new THREE.Points(sGeo, new THREE.PointsMaterial({
      color: 0xd7ff8a, size: 0.5, map: dotTex, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }))
    this.scene.add(this.spores)

    // gentle falling autumn leaves, drifting sideways
    const LN = 90
    const lPos = new Float32Array(LN * 3)
    const lVel = new Float32Array(LN * 3)
    for (let i = 0; i < LN; i++) {
      lPos[i * 3] = (Math.random() - 0.5) * 80
      lPos[i * 3 + 1] = Math.random() * 9
      lPos[i * 3 + 2] = (Math.random() - 0.5) * 80
      lVel[i * 3] = (Math.random() - 0.5) * 0.4
      lVel[i * 3 + 1] = -(0.3 + Math.random() * 0.4)
      lVel[i * 3 + 2] = (Math.random() - 0.5) * 0.4
    }
    const lGeo = new THREE.BufferGeometry()
    lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3))
    this.leaves = { pts: new THREE.Points(lGeo, new THREE.PointsMaterial({
      color: 0xc0392b, size: 0.42, map: dotTex, transparent: true, opacity: 0.85,
      blending: THREE.NormalBlending, depthWrite: false,
    })), vel: lVel, geo: lGeo }
    this.leaves.pts.frustumCulled = false
    this.scene.add(this.leaves.pts)
  }

  /** Keep particle fields centered on the player; drift mist and fall leaves. */
  updateParticles(px: number, pz: number, t: number, dt = 0) {
    this.spores.position.set(
      Math.round(px / 90) * 90,
      0,
      Math.round(pz / 90) * 90,
    )
    this.spores.rotation.y = t * 0.005

    // falling leaves wrap around in a box centered on the player
    const lv = this.leaves
    const arr = lv.geo.attributes.position.array as Float32Array
    const n = arr.length / 3
    for (let i = 0; i < n; i++) {
      arr[i * 3] += (lv.vel[i * 3] + Math.sin(t * 1.3 + i) * 0.3) * dt
      arr[i * 3 + 1] += lv.vel[i * 3 + 1] * dt
      arr[i * 3 + 2] += lv.vel[i * 3 + 2] * dt
      if (arr[i * 3 + 1] < 0.1) {
        arr[i * 3] = px + (Math.random() - 0.5) * 80
        arr[i * 3 + 1] = 8 + Math.random() * 3
        arr[i * 3 + 2] = pz + (Math.random() - 0.5) * 80
      }
    }
    lv.geo.attributes.position.needsUpdate = true

    for (let i = 0; i < this.mist.length; i++) {
      const p = this.mist[i]
      p.rotation.z += dt * 0.02 * (i % 2 === 0 ? 1 : -1)
      p.position.y = 0.6 + Math.sin(t * 0.3 + i) * 0.15
    }
  }

  private buildChests() {
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.7, metalness: 0.3 })
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xffd23e, emissive: 0xffae00, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.6 })
    const boxGeo = new THREE.BoxGeometry(1.1, 0.7, 0.8)
    const lidGeo = new THREE.BoxGeometry(1.1, 0.35, 0.8)

    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group()
      const base = new THREE.Mesh(boxGeo, chestMat)
      base.position.y = 0.35
      base.castShadow = true
      const lid = new THREE.Group()
      const lidMesh = new THREE.Mesh(lidGeo, chestMat)
      lidMesh.position.set(0, 0.18, 0.4)
      lid.add(lidMesh)
      lid.position.set(0, 0.7, -0.4)
      const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.1), trimMat)
      clasp.position.set(0, 0.62, 0.42)
      g.add(base, lid, clasp)

      const a = (i / 6) * Math.PI * 2 + 0.5
      const r = 18 + Math.random() * (WORLD_R - 30)
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      g.rotation.y = Math.random() * Math.PI * 2
      this.scene.add(g)
      this.chests.push({ group: g, lid, opened: false })
    }
  }

  private buildShrines() {
    // cursed torii shrines: cleanse (E) to unlock the ancient artifact
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.9, flatShading: true })
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group()
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 3.4, 7), stoneMat)
        pillar.position.set(1.2 * sx, 1.7, 0)
        pillar.castShadow = true
        g.add(pillar)
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.28, 0.5), stoneMat)
      lintel.position.y = 3.4
      lintel.rotation.z = 0.04
      lintel.castShadow = true
      g.add(lintel)
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.2, 0.4), stoneMat)
      beam.position.y = 2.9
      g.add(beam)
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x9b6bff, emissive: 0x9b6bff, emissiveIntensity: 1.6, roughness: 0.3 }),
      )
      orb.position.y = 2.35
      g.add(orb)
      const a = (i / 2) * Math.PI * 2 + 1.9
      const r = 30 + i * 34
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      g.rotation.y = Math.random() * Math.PI * 2
      this.scene.add(g)
      this.shrines.push({ group: g, orb, cleansed: false })
    }
  }

  /** Glowing pillar marking an ambush wave center (or a shrine event). */
  spawnPillar(x: number, z: number, color = 0x9b6bff) {
    this.removePillar()
    this.ambushPillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 50, 16, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.ambushPillar.position.set(x, 25, z)
    this.scene.add(this.ambushPillar)
  }

  removePillar() {
    if (this.ambushPillar) {
      this.scene.remove(this.ambushPillar)
      this.ambushPillar.geometry.dispose()
      this.ambushPillar = null
    }
  }

  clearArtifact() {
    if (this.artifact) {
      this.scene.remove(this.artifact.mesh, this.artifact.beacon)
      this.artifact.mesh.geometry.dispose()
      this.artifact = null
    }
  }

  spawnArtifact() {
    // artifact materializes at the last cleansed shrine (falls back to a random spot)
    const s = this.shrines.find(sh => sh.cleansed)
    const a = Math.random() * Math.PI * 2
    const r = 40 + Math.random() * (WORLD_R - 60)
    const x = s ? s.group.position.x : Math.cos(a) * r
    const z = s ? s.group.position.z : Math.sin(a) * r
    this.spawnArtifactAt(x, z)
  }

  spawnArtifactAt(x: number, z: number) {
    if (this.artifact) {
      this.scene.remove(this.artifact.mesh, this.artifact.beacon)
      this.artifact.mesh.geometry.dispose()
      this.artifact = null
    }
    this.artifactCount++

    const hue = [0x39ff88, 0x9b6bff, 0xff7a2e][this.artifactCount % 3]
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 0),
      new THREE.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 2.4, roughness: 0.2 }),
    )
    mesh.position.set(x, 1.6, z)
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    )
    beacon.position.set(x, 30, z)
    this.scene.add(mesh, beacon)
    this.artifact = { mesh, beacon, collected: false }
  }

  updateShrines(t: number) {
    for (const s of this.shrines) {
      s.orb.rotation.y = t * (s.cleansed ? 2.5 : 0.6)
      s.orb.position.y = 2.35 + Math.sin(t * (s.cleansed ? 3 : 1.2)) * 0.12
      const mat = s.orb.material as THREE.MeshStandardMaterial
      mat.emissive.setHex(s.cleansed ? 0x39ff88 : 0x9b6bff)
      mat.color.setHex(s.cleansed ? 0x39ff88 : 0x9b6bff)
    }
  }

  updateArtifact(t: number) {
    const art = this.artifact
    if (!art || art.collected) return
    art.mesh.rotation.y = t * 1.4
    art.mesh.position.y = 1.6 + Math.sin(t * 2) * 0.25
  }
}
