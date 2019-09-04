import { Player } from '@/player/player'
import { Danmaku, DanmakuType } from '@/player/danmaku/danmaku'
import { sortBy, groupBy } from 'lodash'
import { DanmakuDrawer, DanmakuFlowDrawer, DanmakuFixedDrawer } from './danmakuDrawer'
import { EventEmitter } from 'events'
import { Canvas } from '@/player/danmaku/canvas'

export interface DanmakuLayerOptions {
  enable: boolean
  flowDuration: number
  fadeoutDuration: number
  contextMenu: ((d: DanmakuDrawer) => { [name: string]: () => void }) | undefined
}

const template = '<div class="content"></div><div class="buttons"><span class="copy">复制</span></div>'

function MakeDanmakuDrawerMenu (d: DanmakuDrawer, menus: { [p: string]: () => void }): HTMLDivElement {
  const $div = document.createElement('div')
  $div.innerHTML = template
  const $content = $div.querySelector('.content') as HTMLElement
  $content.innerText = d.danmaku.text
  const $buttons = $div.querySelector('.buttons') as HTMLDivElement
  for (let key in menus) {
    const $span = document.createElement('span')
    $span.innerText = key
    $span.onclick = menus[key]
    $buttons.prepend($span)
  }
  const $copy = $div.querySelector('.copy')
  return $div
}

export function MakeDanmakuLayerOptions ({
  enable = true,
  flowDuration = 8,
  fadeoutDuration = 5,
  contextMenu = undefined
}: Partial<DanmakuLayerOptions> = {}): DanmakuLayerOptions {
  return { enable, flowDuration, fadeoutDuration, contextMenu }
}

export class DanmakuLayer {
  private player: Player
  private readonly canvas: Canvas
  private $menu: HTMLElement

  // 弹幕内容池
  danmakus: Danmaku[] = []
  showed: Danmaku[] = []

  // 池
  topEnables: DanmakuFixedDrawer[] = []
  topAndBottomDisables: DanmakuFixedDrawer[] = []
  bottomEnables: DanmakuFixedDrawer[] = []
  flowEnables: DanmakuFlowDrawer[] = []
  flowDisables: DanmakuFlowDrawer[] = []

  private topTop = 0
  private flowTop = 0
  private bottomTop = 0

  // 上一帧的生成时间
  private frameTime: number = 0
  // 最后一帧
  private lastFrame: number = Date.now()

  isShow = true

  private width = 0
  private height = 0
  private calcTopInterval: number = -1
  private destroied: boolean = false

  private event: EventEmitter

  constructor (player: Player) {
    this.player = player
    this.event = new EventEmitter()

    this.canvas = new Canvas(player)
    // @ts-ignore
    window.canvas = this.canvas
    DanmakuDrawer.canvas = this.canvas

    this.$menu = player.$root.querySelector('.float.danmaku-context-menu') as HTMLElement

    const hideMenu = () => {
      this.$menu.classList.remove('show')
      document.removeEventListener('click', hideMenu)
      document.removeEventListener('contextmenu', hideMenu)
    }

    this.canvas.$canvas.addEventListener('contextmenu', (e: MouseEvent) => {
      const found = this.findDrawers(e)
      if (found.length > 0 && this.player.options.danmaku.contextMenu) {
        console.log('found', found)
        this.$menu.classList.add('show')
        this.$menu.innerHTML = ''
        for (let i = 0; i < found.length; i++) {
          const drawer = found[i]
          const menu = MakeDanmakuDrawerMenu(drawer, this.player.options.danmaku.contextMenu(drawer))
          this.$menu.append(menu)
        }
        this.$menu.style.left = e.offsetX + 'px'
        this.$menu.style.top = e.offsetY + 'px'
        this.$menu.focus()
        document.addEventListener('click', hideMenu)
        document.addEventListener('contextmenu', hideMenu)
      } else {
        this.$menu.classList.remove('show')
      }
      e.preventDefault()
      e.stopPropagation()
      return false
    })

    this.player.$video.addEventListener('seeked', () => {
      // console.log('video seeked 事件')
      this.clear()
    })

    if (this.player.options.danmaku.enable) {
      this.show()
    } else {
      this.hide()
    }
    this.loop()
  }

  show () {
    this.isShow = true
  }

  hide () {
    this.isShow = false
    this.canvas.clear()
  }

  clear () {
    this.showed.length = 0
    this.canvas.clear()
    this.topAndBottomDisables.push(...this.topEnables)
    this.topEnables.length = 0
    this.flowDisables.push(...this.flowEnables)
    this.flowEnables.length = 0
  }

  resize () {
    this.width = this.player.$root.clientWidth
    this.height = this.player.$root.clientHeight
    this.canvas.resize()
  }

  toggle (): void {
    if (this.isShow) {
      this.hide()
    } else {
      this.show()
    }
  }

  send (d: Danmaku) {
    this.danmakus.push(d)
  }

  private findDrawers (e: MouseEvent): DanmakuDrawer[] {
    return [
      ...this.topEnables.filter(drawer => DanmakuLayer.find(e, drawer)),
      ...this.bottomEnables.filter(drawer => DanmakuLayer.find(e, drawer)),
      ...this.flowEnables.filter(drawer => DanmakuLayer.find(e, drawer))
    ]
  }

  private static find (e: MouseEvent, drawer: DanmakuDrawer): boolean {
    if (e.offsetX > drawer.left && e.offsetX < (drawer.left + drawer.width)) {
      if (e.offsetY > drawer.top && e.offsetY < (drawer.top + drawer.height)) {
        return true
      }
    }
    return false
  }

  private addDanmakuToCanvas () {
    let hasChange = false
    for (let i = 0; i < this.danmakus.length; i++) {
      const danmaku = this.danmakus[i]
      const time = Math.abs(this.player.currentTime - danmaku.currentTime)
      if (this.showed.includes(danmaku)) continue
      if (time > 0.1) continue
      hasChange = true
      this.showed.push(danmaku)

      if (danmaku.type === DanmakuType.Flow) {
        this.calcFlowTop()
        let drawer = this.flowDisables.shift()
        if (!drawer) {
          drawer = new DanmakuFlowDrawer()
        }
        drawer.set(danmaku, this.width, this.flowTop)
        this.flowEnables.push(drawer)
        this.canvas.addDrawer(drawer)
      } else {
        let drawer = this.topAndBottomDisables.shift()
        if (!drawer) {
          drawer = new DanmakuFixedDrawer()
        }
        if (danmaku.type === DanmakuType.Top) {
          drawer.set(danmaku, this.player.options.danmaku.fadeoutDuration, this.width, this.topTop)
          this.calcTopTop(drawer)
          this.topEnables.push(drawer)
        } else {
          drawer.set(danmaku, this.player.options.danmaku.fadeoutDuration, this.width, this.bottomTop)
          this.calcBottomTop(drawer)
          this.bottomEnables.push(drawer)
        }
        this.canvas.addDrawer(drawer)
      }
    }
  }

  private calcFlowTop () {
    if (this.flowEnables.length === 0) {
      this.flowTop = 0
      return
    }
    const lineHeight = this.flowEnables[0].height
    // 按top坐标分组
    const lines = groupBy<DanmakuFlowDrawer>(this.flowEnables, (item) => Math.floor(item.top))
    let top = 0

    for (let key in lines) {
      const drawers: DanmakuFlowDrawer[] = sortBy(lines[key], drawer => drawer.left + drawer.width)
      const drawer: DanmakuFlowDrawer = drawers[drawers.length - 1]
      if ((drawer.left + drawer.width) < this.width) {
        top = drawer.top
        break
      } else {
        top += drawer.height
      }
    }
    if (top + lineHeight > this.height) {
      console.log('高度超出画布')
      top = 0
    }
    console.log({ lineHeight, top, flowTop: this.flowTop })
    this.flowTop = top
  }

  private calcTopTop (drawer: DanmakuFixedDrawer) {
    if (drawer.enable) {
      const height = drawer.top + drawer.height
      if (height > this.height) {
        this.topTop = drawer.top = 0
      } else {
        this.topTop = height
      }
    } else if (drawer.top < this.topTop) {
      this.topTop = drawer.top
    }
  }

  private calcBottomTop (drawer: DanmakuFixedDrawer) {
    if (drawer.enable) {
      if (drawer.top <= 0) {
        drawer.top = this.height - drawer.height
      }
      this.bottomTop = drawer.top - drawer.height
    } else if (drawer.top > this.bottomTop) {
      this.bottomTop = drawer.top
    }
  }

  /**
   * 绘制弹幕
   */
  private drawDanmaku () {
    this.topEnables = this.topEnables.filter(drawer => {
      if (drawer.enable) {
        drawer.update(this.frameTime)
        return true
      } else {
        this.canvas.removeDrawer(drawer)
        this.topAndBottomDisables.push(drawer)
        this.calcTopTop(drawer)
        return false
      }
    })

    this.bottomEnables = this.bottomEnables.filter(drawer => {
      if (drawer.enable) {
        drawer.update(this.frameTime)
        return true
      } else {
        this.canvas.removeDrawer(drawer)
        this.topAndBottomDisables.push(drawer)
        this.calcBottomTop(drawer)
        return false
      }
    })

    this.flowEnables = this.flowEnables.filter(drawer => {
      if (drawer.enable) {
        drawer.update(this.width, this.player.options.danmaku.flowDuration, this.frameTime)
        return true
      } else {
        this.canvas.removeDrawer(drawer)
        this.flowDisables.push(drawer)
        return false
      }
    })

    if (!this.player.paused && this.isShow) {
      this.canvas.renderAll()
    }
  }

  private loop () {
    if (this.destroied) return
    this.addDanmakuToCanvas()
    if (!this.player.paused) {
      this.drawDanmaku()
    }
    this.frameTime = (Date.now() - this.lastFrame) / 1000
    this.lastFrame = Date.now()

    window.requestAnimationFrame(() => { this.loop() })
  }

  destroy () {
    this.destroied = true
    clearInterval(this.calcTopInterval)
  }

  get debug (): Object {
    return {
      isShow: this.isShow,
      all: this.danmakus.length,
      showed: this.showed.length,
      fixed: {
        top: this.topEnables.length,
        bottom: this.bottomEnables.length,
        disabled: this.topAndBottomDisables.length
      },
      flow: {
        enables: this.flowEnables.length,
        disabled: this.flowDisables.length
      },
      top: {
        top: this.topTop,
        flow: this.flowTop,
        bottom: this.bottomTop
      }
    }
  }
}
