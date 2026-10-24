// Dual-input architecture: keyboard/mouse on desktop, virtual joystick + action buttons on touch.

export interface InputState {
  moveX: number
  moveY: number
  attackPressed: boolean   // edge-triggered, consumed by the game
  dodgePressed: boolean
  usePressed: boolean
  isTouch: boolean
  /** accumulated horizontal look delta (radians) since last poll; consumed via takeLookDelta() */
}

export class InputManager {
  state: InputState = { moveX: 0, moveY: 0, attackPressed: false, dodgePressed: false, usePressed: false, isTouch: false }
  private keys = new Set<string>()
  private joyId: number | null = null
  private joyStart = { x: 0, y: 0 }
  private joyVec = { x: 0, y: 0 }
  private looking = false
  private lastLookX = 0
  private lookDelta = 0

  /** Accumulated right-mouse-drag yaw since last call (radians). */
  takeLookDelta(): number {
    const d = this.lookDelta
    this.lookDelta = 0
    return d
  }

  constructor() {
    const isTouch = matchMedia('(pointer: coarse)').matches
    this.state.isTouch = isTouch
    if (isTouch) document.body.classList.add('touch')

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()
      this.keys.add(k)
      if (k === ' ') { this.state.attackPressed = true; e.preventDefault() }
      if (k === 'shift') this.state.dodgePressed = true
      if (k === 'e') this.state.usePressed = true
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    // click-to-attack on desktop
    window.addEventListener('mousedown', (e) => {
      if (this.state.isTouch) return
      if (e.button === 0) this.state.attackPressed = true
      if (e.button === 2) { this.looking = true; this.lastLookX = e.clientX }
    })
    window.addEventListener('mousemove', (e) => {
      if (!this.looking) return
      this.lookDelta += (e.clientX - this.lastLookX) * 0.006
      this.lastLookX = e.clientX
    })
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.looking = false
    })
    // keep the browser context menu out of the way of camera-drag
    window.addEventListener('contextmenu', (e) => {
      if (!this.state.isTouch) e.preventDefault()
    })

    if (isTouch) this.setupJoystick()
  }

  private setupJoystick() {
    const base = document.getElementById('joyBase')!
    const knob = document.getElementById('joyKnob')!
    const R = 48

    const setKnob = (dx: number, dy: number) => {
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    }

    base.addEventListener('pointerdown', (e) => {
      this.joyId = e.pointerId
      const r = base.getBoundingClientRect()
      this.joyStart = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      base.setPointerCapture(e.pointerId)
    })
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return
      let dx = e.clientX - this.joyStart.x
      let dy = e.clientY - this.joyStart.y
      const d = Math.hypot(dx, dy)
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
      this.joyVec = { x: dx / R, y: dy / R }
      setKnob(dx, dy)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return
      this.joyId = null
      this.joyVec = { x: 0, y: 0 }
      setKnob(0, 0)
    }
    base.addEventListener('pointerup', end)
    base.addEventListener('pointercancel', end)

    const bindBtn = (id: string, flag: 'attackPressed' | 'dodgePressed' | 'usePressed') => {
      const el = document.getElementById(id)!
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation()
        this.state[flag] = true
      })
    }
    bindBtn('btnAttack', 'attackPressed')
    bindBtn('btnDodge', 'dodgePressed')
    bindBtn('btnUse', 'usePressed')
  }

  /** Call once per frame; returns and clears edge triggers. */
  poll(): InputState {
    const s = this.state
    let mx = 0, my = 0
    if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1
    if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1
    if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1
    const l = Math.hypot(mx, my)
    if (l > 0) { mx /= l; my /= l }
    if (this.joyId !== null) { mx = this.joyVec.x; my = this.joyVec.y }

    const out: InputState = {
      moveX: mx, moveY: my, isTouch: s.isTouch,
      attackPressed: s.attackPressed, dodgePressed: s.dodgePressed, usePressed: s.usePressed,
    }
    s.attackPressed = s.dodgePressed = s.usePressed = false
    return out
  }
}
