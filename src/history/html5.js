/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { START } from '../util/route'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

// 封装了html5 history对象的类
export class HTML5History extends History {
  constructor (router: Router, base: ?string) {
    super(router, base)

    // https://router.vuejs.org/zh/guide/advanced/scroll-behavior.html#%E6%BB%9A%E5%8A%A8%E8%A1%8C%E4%B8%BA
    // vueRouter支持导航时的滚动位置控制
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll

    if (supportsScroll) {
      setupScroll()
    }
    // 获取对象初始化时的url，并保存
    const initLocation = getLocation(this.base)
    // 监听popstate事件，当使用history.pushState和history.replaceState时并不会触发
    window.addEventListener('popstate', e => {
      const current = this.current

      // Avoiding first `popstate` event dispatched in some browsers but first
      // history route not updated since async guard at the same time.
      // 获取当前地址栏url
      const location = getLocation(this.base)
      // 当导航到History对象初始化的url时，框架不进行处理
      if (this.current === START && location === initLocation) {
        return
      }
      // 如果用户点击浏览器的前进后退按钮会触发popstate事件，然后开始框架导航处理
      // 由于popState事件会在url改变后触发，所以location是toRoute的path
      this.transitionTo(location, route => {
        // 处理滚动
        if (supportsScroll) {
          handleScroll(router, route, current, true)
        }
      })
    })
  }
  // 封装原生方法，会触发popState事件
  go (n: number) {
    window.history.go(n)
  }

  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this // 当前route作为fromRoute
    // 开始导航
    this.transitionTo(location, route => {
      // 此时已经完成导航，以及所有导航守卫的调用
      // 改变url地址栏
      pushState(cleanPath(this.base + route.fullPath))
      // 处理页面滚动
      handleScroll(this.router, route, fromRoute, false)
      // 回调用户设置的回调函数
      onComplete && onComplete(route)
    }, onAbort)
  }

  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    // 开始导航
    this.transitionTo(location, route => {
      replaceState(cleanPath(this.base + route.fullPath))
      handleScroll(this.router, route, fromRoute, false)
      onComplete && onComplete(route)
    }, onAbort)
  }
  // 调用原生history对象方法，确认改变url地址栏
  ensureURL (push?: boolean) {
    if (getLocation(this.base) !== this.current.fullPath) {
      const current = cleanPath(this.base + this.current.fullPath)
      push ? pushState(current) : replaceState(current)
    }
  }

  // 获取当前的url
  getCurrentLocation (): string {
    return getLocation(this.base)
  }
}

// 获取当前url，如果有base参数，则除去base
export function getLocation (base: string): string {
  let path = decodeURI(window.location.pathname) // 获取当前url的pathname，NOTE: 并且decode一次
  if (base && path.indexOf(base) === 0) { // 如果当前path以base开头，则舍去base开头
    path = path.slice(base.length)
  }
  return (path || '/') + window.location.search + window.location.hash // 返回当前path + search + hash
}
