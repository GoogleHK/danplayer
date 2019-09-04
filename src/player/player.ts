import './style.scss'
import Hls from 'hls.js'
import { Danmaku, DanmakuOptions } from '@/player/danmaku/danmaku'
import { UI } from '@/player/UI'
import { MakeDanmakuLayerOptions, DanmakuLayerOptions } from '@/player/danmaku/danmakuLayer'

const template = `{video-layer}
<div class="interactive-layer">
  <canvas class="danmaku-layer"></canvas>
  
  <div class="bg-gradient show"></div>
  
  <div class="float danmaku-context-menu" tabIndex="2"></div>
  
  <div class="float danmaku-style-layer"></div>
  
  <div class="float volume-bar">
    <div class="volume-num-label"></div>
    <div class="volume-column-bar">
      <div class="bar-ui bar-full"></div>
      <div class="bar-ui bar-current"></div>
      <div class="bar-controller"></div>
    </div>
  </div>
  
  <div class="float quality-menu"></div>
  
  <div class="controller-bottom-bar">
    <div class="progress-bar live-hide">
      <div class="bar-full"></div>
      <div class="bar-buffer"></div>
      <div class="bar-current"></div>
      <div class="bar-controller"></div>    
    </div>
    
    <div class="buttons">
      <div class="left">
        <div class="button intern-button play" data-on="&#xe6a4;" data-off="&#xe6a5;"
          data-on-title="播放视频" data-off-title="暂停播放">&#xe6a4;</div>
        <div class="button intern-button volume" data-on="&#xe63d;" data-off="&#xe63e;" title="音量">&#xe63d;</div>
        <div class="button intern-button toggle-danamaku" title="隐藏弹幕"
          data-on="&#xe697;" data-off="&#xe696;" 
          data-on-title="显示弹幕" data-off-title="隐藏弹幕">&#xe696;</div>
      </div>
      
      <div class="middle danmaku_form">
        <div class="button intern-button danmaku-style">&#xe6a1;</div>
        <input placeholder="输入弹幕内容">
        <button>发送</button>
      </div>
      <div class="right">
        <div class="button quality" title="切换画质"></div>
        <div class="button intern-button full-screen" data-on="&#xe6d9;" data-off="&#xe6e8;">&#xe6d9;</div>
      </div>
    </div>
  </div>
</div>`

interface PlayerOptions extends Object {
  /**
   * 直播模式
   * 没有进度条
   */
  live: boolean

  // 音量
  volume: number

  autoplay: boolean,

  // ui 的隐藏时间
  uiFadeOutDelay: number

  // 视频寸尺
  width: number | string
  height: number | string

  // 视频来源，也可以在<video src=""></video>的src设置
  src: string

  // 扩展按钮
  extraButtons: Element[]

  // 弹幕层的配置
  danmaku: DanmakuLayerOptions

  fullScreen: boolean

  danmakuForm: boolean

  onlyOne: boolean

  color: string
}

function MakeDefaultOptions ({
  autoplay = false,
  color = '#00a1d6',
  live = false,
  volume = 0.7,
  width = 600,
  height = 350,
  uiFadeOutDelay = 3000,
  extraButtons = [],
  src = '',
  danmakuForm = true,
  fullScreen = true,
  danmaku = MakeDanmakuLayerOptions(),
  onlyOne = false
}: Partial<PlayerOptions>): PlayerOptions {
  return {
    autoplay,
    color,
    live,
    height,
    danmaku,
    danmakuForm,
    fullScreen,
    src,
    uiFadeOutDelay,
    extraButtons,
    onlyOne,
    volume,
    width
  }
}

export class Player {
  private static instances: Player[] = []
  $root: HTMLElement
  $video: HTMLVideoElement
  hls?: Hls
  public ui: UI

  // 尺寸
  private _width: string = ''
  private _height: string = ''

  get width () {
    return this.$root.clientWidth
  }

  get height () {
    return this.$root.clientHeight
  }

  private isFullScreen: boolean = false

  private _duration: number = 0
  private _loading = true
  private _paused = true

  get loading () {
    return this._loading
  }

  public options: PlayerOptions

  constructor ($e: HTMLVideoElement, options?: Partial<PlayerOptions>) {
    Player.instances.push(this)
    const parent = $e.parentElement as Element
    this.$root = document.createElement('div')
    this.$root.setAttribute('tabIndex', '1')
    this.$root.classList.add('video-player')
    parent.insertBefore(this.$root, $e)
    $e.classList.add('video-layer')
    $e.removeAttribute('id')
    this.$root.innerHTML = template.replace('{video-layer}', $e.outerHTML)
    $e.remove()

    this.$root.addEventListener('keypress', (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      if (this.$video.paused) {
        this.$video.play()
      } else {
        this.$video.pause()
      }
    })

    this.$root.addEventListener('mousemove', () => {
      this.$root.classList.remove('mouse-idle')
      this.ui.show()
      if (this.paused) {

      } else {
        if (this.ui.isMouseInUI) return
        this.ui.hideUIDelay().then(() => {
          this.$root.classList.add('mouse-idle')
        })
      }
    })

    this.$root.addEventListener('mouseenter', () => {
      this.ui.show()
      this.ui.cancelHideUIDelay()
    })
    this.$root.addEventListener('mouseleave', () => {
      this.ui.hide()
      this.ui.cancelHideUIDelay()
    })

    this.$video = this.$root.querySelector('.video-layer') as HTMLVideoElement
    this.$video.removeAttribute('controls')
    this.$video.addEventListener('durationchange', () => {
      console.log('视频长度', this.$video.duration)
      this._duration = this.$video.duration
    })

    this.$video.addEventListener('playing', () => this.ui.hideUIDelay())

    this.$video.addEventListener('play', () => this.ui.updatePlayButton())
    this.$video.addEventListener('pause', () => this.ui.updatePlayButton())

    window.addEventListener('resize', () => this.resizeEvt(1000))

    this.options = MakeDefaultOptions(options || { autoplay: this.$video.hasAttribute('autoplay') })

    this.ui = new UI(this)

    this._set().then()
  }

  private async _set () {
    this.ui.insertExtraButtons()

    if (this.options.src) {
      this.$video.setAttribute('src', this.options.src)
    }

    await this.getContentType()

    if (this.hls) {
      this.hls.on(Hls.Events.LEVEL_LOADED, () => {
        this.ui.qualitySelector.updateLevel(this.hls as Hls)
      })
    }

    console.log('_set', { autoplay: this.options.autoplay, paused: this._paused })
    if (this.options.autoplay || !this.paused) {
      console.log('_set 播放')
      this.play()
    }

    this.ui.updatePlayButton()

    this.resize()
  }

  set (options: Partial<PlayerOptions>) {
    const newOptions = Object.assign({}, this.options, options)
    const hasSrcChanged = newOptions.src !== this.options.src
    if (hasSrcChanged) {
      if (this.hls) {
        this.hls.detachMedia()
        this.hls = undefined
      }
      this.ui.progressBar.resize()
    }
    this.options = newOptions
    this._set().then()
  }

  resize () {
    if (this.options.width) {
      if (typeof this.options.width === 'number' || parseInt(this.options.width).toString() === this.options.width) {
        this._width = this.options.width + 'px'
      } else {
        this._width = this.options.width
      }
    }
    if (this.options.height) {
      if (typeof this.options.height === 'number' || parseInt(this.options.height).toString() === this.options.height) {
        this._height = this.options.height + 'px'
      } else {
        this._height = this.options.height
      }
    }
    console.log('resize options', this.options, { width: this._width, height: this._height })
    if (!this.isFullScreen) {
      this.$root.style.width = this._width
      this.$root.style.height = this._height
    }
    this.ui.resize()
  }

  private delayResize: number = -1

  private resizeEvt (ms: number) {
    window.clearTimeout(this.delayResize)
    this.delayResize = window.setTimeout(() => {
      this.resize()
    }, ms)
  }

  /**
   * 批量填充弹幕
   */
  fillDanmakus (array: Danmaku[]) {
    this.ui.danmakuLayer.danmakus.push(...array)
  }

  get currentTime () {
    return this.$video.currentTime
  }

  sendDanmaku (danmaku: Danmaku) {
    this.ui.danmakuLayer.send(danmaku)
  }

  sendDanmakuWithStyle (danmaku: Danmaku) {
    Object.assign(danmaku, this.ui.styleLayer.getStyle())
    this.ui.danmakuLayer.send(danmaku)
  }

  get paused () {
    return this._paused
  }

  toggle () {
    if (this.paused) {
      this.play()
    } else {
      this.pause()
    }
  }

  play () {
    console.warn('player')
    this._paused = false
    this.$video.play().then()
    if (this.options.onlyOne) {
      Player.instances.forEach(player => {
        if (player !== this) {
          console.log('暂停其它实例')
          player.pause()
        }
      })
    }
  }

  pause () {
    console.warn('pause')
    this._paused = true
    this.$video.pause()
  }

  private async getContentType () {
    let useHLS = false
    const src = this.$video.getAttribute('src') as string
    console.log('视频网址', src)
    if (src) {
      useHLS = !!src.match(/\.m3u[8]/)
      this.options.src = src
    }
    if (useHLS) {
      console.log('使用Hls.js')
      if (Hls.isSupported()) {
        this.hls = new Hls()
        this.hls.attachMedia(this.$video)
        this.hls.loadSource(src)
      } else {
        const http = new XMLHttpRequest()
        http.open('Get', src)
        http.send()
        const contentType: string | null = await new Promise(resolve => {
          http.onreadystatechange = () => {
            if (http.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
              if (http.status === 200) {
                resolve(http.getResponseHeader('Content-Type') as string)
              } else {
                resolve(null)
              }
              http.abort()
            }
          }
        })
        console.log({ contentType })
        if (contentType && this.$video.canPlayType(contentType)) {
          this.options.src = this.$video.src = src
        }
      }
    }
  }

  /**
   * 切换全屏模式
   */
  async toggleFullScreen () {
    this.isFullScreen = !this.isFullScreen
    if (this.isFullScreen) {
      await this.$root.requestFullscreen()
      this.ui.danmakuForm.show()
    } else {
      await document.exitFullscreen()
      this.ui.danmakuForm.hide()
    }
    this.resize()
  }

  /**
   * 销毁
   */
  destroy () {
    this.ui.destroy()
  }

  get debug (): Object {
    let quality = '默认'
    let src = this.options.src
    if (this.hls) {
      if (this.ui.qualitySelector.currentLevel === -1) {
        quality = '自动 '
      } else {
        quality = ''
      }
      if (this.hls.currentLevel !== -1) {
        quality += this.hls.levels[this.hls.currentLevel].name + 'P'
      }
    }
    return {
      width: this.width,
      height: this.height,
      src,
      quality,
      ui: this.ui.debug
    }
  }
}
