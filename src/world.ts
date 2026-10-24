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
  private embers!: THREE.Points
  private mist: THREE.Mesh[] = []
  chests: Chest[] = []
  artifact: Artifact | null = null
  private artifactCount = 0

  constructor() {
    this.buildSkyAndFog()
    this.buildLights()
    this.buildGround()
    this.buildProps()
    this.buildForest()
    this.buildMist()
    this.buildParticles()
    this.buildChests()
    this.spawnArtifact()
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
    const g = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD_R + 30, 48),
      new THREE.MeshStandardMaterial({ color: 0x0f1c14, roughness: 0.95 }),
    )
    g.rotation.x = -Math.PI / 2
    g.receiveShadow = true
    this.scene.add(g)

    // faint neon grid ring paths
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.05, side: THREE.DoubleSide })
    for (const r of [40, 80, 120]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.4, r, 96), ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.02
      this.scene.add(ring)
    }
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
      const a = Math.random() * Math.PI * 2
      const r = 14 + Math.random() * (WORLD_R - 10)
      pos.set(Math.cos(a) * r, 0, Math.sin(a) * r)
      const s = 1.3 + Math.random() * 2.2
      scl.set(s, s * (0.85 + Math.random() * 0.4), s)
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2)
      m.compose(pos, q, scl)
      pines.setMatrixAt(i, m)
    }
    this.scene.add(pines)

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
    // floating magical spores (ambient field around the player)
    const SN = 260
    const sPos = new Float32Array(SN * 3)
    for (let i = 0; i < SN; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 90
      sPos[i * 3 + 1] = Math.random() * 12
      sPos[i * 3 + 2] = (Math.random() - 0.5) * 90
    }
    const sGeo = new THREE.BufferGeometry()
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3))
    this.spores = new THREE.Points(sGeo, new THREE.PointsMaterial({
      color: 0xd7ff8a, size: 0.34, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    this.scene.add(this.spores)

    // rising embers near the ground (magma mood)
    const EN = 160
    const ePos = new Float32Array(EN * 3)
    for (let i = 0; i < EN; i++) {
      ePos[i * 3] = (Math.random() - 0.5) * 100
      ePos[i * 3 + 1] = Math.random() * 6
      ePos[i * 3 + 2] = (Math.random() - 0.5) * 100
    }
    const eGeo = new THREE.BufferGeometry()
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3))
    this.embers = new THREE.Points(eGeo, new THREE.PointsMaterial({
      color: 0xff7a2e, size: 0.2, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    this.scene.add(this.embers)
  }

  /** Keep particle fields centered on the player; drift mist patches. */
  updateParticles(px: number, pz: number, t: number, dt = 0) {
    for (const [pts, speed] of [
      [this.spores, 0.5], [this.embers, 1.4],
    ] as const) {
      pts.position.set(
        Math.round(px / 90) * 90 + Math.sin(t * speed * 0.3) * 2,
        0,
        Math.round(pz / 90) * 90,
      )
      pts.rotation.y = t * 0.01 * speed
    }
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

  spawnArtifact() {
    if (this.artifact) {
      this.scene.remove(this.artifact.mesh, this.artifact.beacon)
      this.artifact.mesh.geometry.dispose()
    }
    this.artifactCount++
    const a = Math.random() * Math.PI * 2
    const r = 40 + Math.random() * (WORLD_R - 60)
    const x = Math.cos(a) * r, z = Math.sin(a) * r

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

  updateArtifact(t: number) {
    const art = this.artifact
    if (!art || art.collected) return
    art.mesh.rotation.y = t * 1.4
    art.mesh.position.y = 1.6 + Math.sin(t * 2) * 0.25
  }
}
