/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { getLocation } from './html5'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

export class HashHistory extends History {
  constructor (router: Router, base: ?string, fallback: boolean) {
    super(router, base)
    // check history fallback deeplinking
    if (fallback && checkFallback(this.base)) {
      return
    }
    // NOTE: 确保当前url的hash以/开始 例如 www.a.com#index => www.a.com/#index
    // NOTE: 调用getHash对#和？之间的内容进行decode
    ensureSlash()
  }

  // this is delayed until the app mounts
  // to avoid the hashchange listener being fired too early
  // history模式，对popState事件的监听是放在构造函数中的，这里对hashChange的监听没有放在构造函数
  // 由于构造函数中调用的ensureSlash函数，以及框架启动时首次导航可能会触发hashChange事件，所以对hashChange的
  // 事件监听不会在构造函数中进行，而是等到首次导航结束后才设置监听
  setupListeners () {
    const router = this.router
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll

    if (supportsScroll) {
      setupScroll()
    }

    window.addEventListener(
      // NOTE: hash模式，如果支持pushState API的话，导航使用的依然是pushState和replaceState
      // 虽然地址栏中是hash值在变化
      supportsPushState ? 'popstate' : 'hashchange',
      () => {
        // 触发事件时，url地址已经改变，但是框架导航并未开始
        const current = this.current
        if (!ensureSlash()) {
          return
        }
        this.transitionTo(getHash(), route => {
          if (supportsScroll) {
            handleScroll(this.router, route, current, true)
          }
          if (!supportsPushState) {
            replaceHash(route.fullPath)
          }
        })
      }
    )
  }

  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        // url地址栏切换
        pushHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }

  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        // url地址栏切换
        replaceHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }

  go (n: number) {
    window.history.go(n)
  }

  // 确保url切换的兜底操作，在transitionTo方法中被调用
  ensureURL (push?: boolean) {
    const current = this.current.fullPath
    if (getHash() !== current) {
      push ? pushHash(current) : replaceHash(current)
    }
  }

  getCurrentLocation () {
    return getHash()
  }
}

function checkFallback (base) {
  const location = getLocation(base)
  if (!/^\/#/.test(location)) {
    window.location.replace(cleanPath(base + '/#' + location))
    return true
  }
}

// NOTE: 确保当前url的hash以/开始 例如 www.a.com#index => www.a.com/#index
// NOTE: 调用getHash对#和？之间的内容进行decode
/**
 * @description
 * @returns {boolean} 当前hash是否已 / 开头，是则返回true，否则返回false
 */
function ensureSlash (): boolean {
  const path = getHash()
  if (path.charAt(0) === '/') {
    return true
  }
  replaceHash('/' + path)
  return false
}

/**
 * @description 针对当前url中第一个#和？之间，或者第一个#和第二个#之间的内容进行decode
 * @export
 * @returns {string}
 */
export function getHash (): string {
  // 在这里无法使用window.location.hash，因为这个属性在不同浏览器表现不一样。
  // firefox总是会对hash进行pre-decode
  // We can't use window.location.hash here because it's not
  // consistent across browsers - Firefox will pre-decode it!
  let href = window.location.href
  const index = href.indexOf('#')
  // empty path
  if (index < 0) return ''
  // 获取#后面的字符
  href = href.slice(index + 1)
  // decode the hash but not the search or hash
  // as search(query) is already decoded
  // https://github.com/vuejs/vue-router/issues/2708
  // NOTE: 上面这个issue挺有意思，说的是 3.0.3版本的vueRouter，由于在getHash方法内已经对query字符decode了一次，
  // 但是在根据query字符串获取query对象时，又decode一次，使得url的query字符中存在%时会引发报错
  const searchIndex = href.indexOf('?')
  if (searchIndex < 0) {
    // 没有?，不存在query
    const hashIndex = href.indexOf('#')
    if (hashIndex > -1) { // 存在第二个#
      // NOTE: decode 第一个#和第二个#之间的内容，加上第二个#之后的内容
      href = decodeURI(href.slice(0, hashIndex)) + href.slice(hashIndex)
    } else href = decodeURI(href)
  } else { // 存在?，有query
    // decode第一个#和?之间的内容，加上?之后的内容
    href = decodeURI(href.slice(0, searchIndex)) + href.slice(searchIndex)
  }
  // NOTE: 注意到这里query参数是不会被decode处理的
  return href
}

/**
 * @description 传入hash部分，获取当前浏览器完整url
 * @param {*} path
 * @returns
 */
function getUrl (path) {
  const href = window.location.href
  const i = href.indexOf('#')
  const base = i >= 0 ? href.slice(0, i) : href
  return `${base}#${path}`
}

/**
 * @description 调用浏览器原生方法，改变url地址栏
 * @param {*} path
 */
function pushHash (path) {
  if (supportsPushState) {
    pushState(getUrl(path))
  } else {
    window.location.hash = path
  }
}
// 将地址栏修改为 .../#....
function replaceHash (path) {
  if (supportsPushState) {
    // 调用history.replaceState 将地址栏修改为 .../#....
    // 因为调用
    replaceState(getUrl(path))
  } else {
    window.location.replace(getUrl(path))
  }
}
