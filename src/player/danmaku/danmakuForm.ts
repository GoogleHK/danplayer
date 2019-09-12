import { Ui } from '@/player/ui'
import { DanmakuStyleLayer } from '@/player/danmaku/danmakuStyleLayer'
import { Danmaku } from '@/player/danmaku/danmaku'

export class DanmakuForm {
  ui: Ui
  $root: HTMLElement
  $btn: HTMLElement
  $input: HTMLInputElement
  isShow = false
  styleLayer: DanmakuStyleLayer

  constructor (ui: Ui) {
    this.ui = ui
    this.styleLayer = new DanmakuStyleLayer(ui)

    this.$root = ui.player.$root.querySelector('.danmaku-form') as HTMLElement
    this.$input = this.$root.querySelector('input') as HTMLInputElement
    this.$btn = this.$root.querySelector('.send') as HTMLElement
    this.$btn.addEventListener('click', () => this.send())
    this.$input.addEventListener('keypress', (e: KeyboardEvent) => {
      // console.log('弹幕表单 keypress', e.key)
      if (e.key === 'Enter' && this.ui.isShow) {
        this.send()
      }
    })
    this.$input.addEventListener('keydown', (e: KeyboardEvent) => {
      // console.log('弹幕表单 keydown', e.key)
      if (e.key.startsWith('Arrow') || e.key === ' ') {
        e.stopPropagation()
      }
    })
    this.$input.addEventListener('keyup', (e: KeyboardEvent) => {
      // console.log('弹幕表单 keyup', e.key)
      if (e.key === 'Escape') {
        this.ui.player.$root.focus()
        this.ui.hide()
      }
      e.stopPropagation()
    })
    this.$input.addEventListener('focus', () => { this.ui.isMouseInUI = true })
    this.$input.addEventListener('blur', () => { this.ui.isMouseInUI = false })
  }

  async send () {
    const text = this.$input.value.trim()
    if (!text) return
    const options = this.styleLayer.getStyle()
    options.currentTime = this.ui.player.currentTime

    const danmaku = new Danmaku(text, options)
    if (this.ui.player.options.beforeSendDanmaku) {
      const success = await this.ui.player.options.beforeSendDanmaku(danmaku)
      if (!success) {
        return
      }
    }
    this.ui.danmakuLayer.send(danmaku)
    this.$input.value = ''
    this.$input.blur()
    this.ui.player.$root.focus()
  }

  show () {
    this.isShow = true
    this.$root.style.display = ''
  }

  hide () {
    this.isShow = false
    this.$root.style.display = 'none'
  }

  update () {
    if (this.ui.player.options.danmakuForm) {
      this.show()
    } else {
      this.hide()
    }
  }

  focus () {
    this.$input.focus()
  }
}
