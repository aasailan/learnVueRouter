/* @flow */

import { install } from './install'
import { START } from './util/route'
import { assert } from './util/warn'
import { inBrowser } from './util/dom'
import { cleanPath } from './util/path'
import { createMatcher } from './create-matcher'
import { normalizeLocation } from './util/location'
import { supportsPushState } from './util/push-state'

import { HashHistory } from './history/hash'
import { HTML5History } from './history/html5'
import { AbstractHistory } from './history/abstract'

import type { Matcher } from './create-matcher'

// const router = new VueRouter(config);
export default class VueRouter {
  // Vue.use(VueRouter); 静态方法，Vue插件方式调用
  static install: () => void; // 后续会赋值成一个install函数
  static version: string;

  app: any;
  apps: Array<any>;
  ready: boolean;
  readyCbs: Array<Function>;
  options: RouterOptions;
  mode: string;
  history: HashHistory | HTML5History | AbstractHistory; // 当前路由导航对象
  matcher: Matcher;
  fallback: boolean;
  beforeHooks: Array<?NavigationGuard>; // beforeEach
  resolveHooks: Array<?NavigationGuard>; // beforeResolve
  afterHooks: Array<?AfterNavigationHook>; // afterEach

  constructor (options: RouterOptions = {}) {
    this.app = null // 当前激活使用的app
    this.apps = [] // 被注册的app数组
    this.options = options // 保存配置对象
    this.beforeHooks = [] // 钩子数组
    this.resolveHooks = []
    this.afterHooks = []
    // 匹配器
    this.matcher = createMatcher(options.routes || [], this)

    let mode = options.mode || 'hash' // 默认hash模式
    this.fallback = mode === 'history' && !supportsPushState && options.fallback !== false // history模式，但浏览器不支持pushState时，回退到hash模式
    if (this.fallback) {
      mode = 'hash'
    }
    if (!inBrowser) { // 当前不在浏览器中，可能是ssr
      mode = 'abstract'
    }
    this.mode = mode

    switch (mode) {
      case 'history':
        // options.base https://router.vuejs.org/zh/api/#base
        this.history = new HTML5History(this, options.base) // history对象，用来操作路由
        break
      case 'hash':
        this.history = new HashHistory(this, options.base, this.fallback)
        break
      case 'abstract':
        this.history = new AbstractHistory(this, options.base)
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          assert(false, `invalid mode: ${mode}`)
        }
    }
  }

  match (
    raw: RawLocation,
    current?: Route,
    redirectedFrom?: Location // ?
  ): Route {
    return this.matcher.match(raw, current, redirectedFrom)
  }

  // 获取当前route对象
  get currentRoute (): ?Route {
    return this.history && this.history.current
  }

  /**
   * @description 初始化 在VueRouter.install 中被调用，在Vue.use(VueRouter)是被调用
   * @param {*} app new Vue({ router: vuerouter }); 实例
   * @memberof VueRouter
   */
  init (app: any /* Vue component instance */) {
    process.env.NODE_ENV !== 'production' && assert(
      install.installed,
      `not installed. Make sure to call \`Vue.use(VueRouter)\` ` +
      `before creating root instance.`
    )

    this.apps.push(app)

    // 设置app destroy时的监听，确保app destroy时，能从router实例内部对app进行移除来释放内存
    // set up app destroyed handler
    // https://github.com/vuejs/vue-router/issues/2639
    app.$once('hook:destroyed', () => {
      // clean out app from this.apps array once destroyed
      const index = this.apps.indexOf(app)
      if (index > -1) this.apps.splice(index, 1)
      // ensure we still have a main app or null if no apps
      // we do not release the router so it can be reused
      if (this.app === app) this.app = this.apps[0] || null
    })

    // main app previously initialized
    // return as we don't need to set up new history listener
    if (this.app) {
      return
    }

    this.app = app

    const history = this.history

    if (history instanceof HTML5History) {
      // 初始化后开始对当前url进行导航
      history.transitionTo(history.getCurrentLocation())
    } else if (history instanceof HashHistory) {
      // 初始化后对当前url进行导航
      const setupHashListener = () => {
        history.setupListeners()
      }
      history.transitionTo(
        history.getCurrentLocation(),
        setupHashListener, // onComplete
        setupHashListener // onAbort
      )
    }

    history.listen(route => {
      this.apps.forEach((app) => {
        app._route = route
      })
    })
  }

  // 以下是路由钩子方法接口
  beforeEach (fn: Function): Function {
    // 向this.beforeHooks注册钩子函数
    return registerHook(this.beforeHooks, fn)
  }

  beforeResolve (fn: Function): Function {
    return registerHook(this.resolveHooks, fn)
  }

  afterEach (fn: Function): Function {
    return registerHook(this.afterHooks, fn)
  }

  onReady (cb: Function, errorCb?: Function) {
    this.history.onReady(cb, errorCb)
  }

  onError (errorCb: Function) {
    this.history.onError(errorCb)
  }

  // router.push方法
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      // 如果没有定义onComplete和onAbort且存在promise，则返回一个promise
      return new Promise((resolve, reject) => {
        // 调用HTML5History实例
        this.history.push(location, resolve, reject)
      })
    } else {
      this.history.push(location, onComplete, onAbort)
    }
  }

  // router.replace方法
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.replace(location, resolve, reject)
      })
    } else {
      this.history.replace(location, onComplete, onAbort)
    }
  }
  // router.go方法
  go (n: number) {
    this.history.go(n)
  }
  // router.back
  back () {
    this.go(-1)
  }
  // router.forward
  forward () {
    this.go(1)
  }
  // 获取匹配的组件
  getMatchedComponents (to?: RawLocation | Route): Array<any> {
    const route: any = to
      ? to.matched
        ? to
        : this.resolve(to).route
      : this.currentRoute
    if (!route) {
      return []
    }
    return [].concat.apply([], route.matched.map(m => {
      return Object.keys(m.components).map(key => {
        return m.components[key]
      })
    }))
  }

  resolve (
    to: RawLocation,
    current?: Route,
    append?: boolean
  ): {
    location: Location,
    route: Route,
    href: string,
    // for backwards compat
    normalizedTo: Location,
    resolved: Route
  } {
    current = current || this.history.current
    const location = normalizeLocation(
      to,
      current,
      append,
      this
    )
    const route = this.match(location, current)
    const fullPath = route.redirectedFrom || route.fullPath
    const base = this.history.base
    const href = createHref(base, fullPath, this.mode)
    return {
      location,
      route,
      href,
      // for backwards compat
      normalizedTo: location,
      resolved: route
    }
  }
  // 动态注册route对象
  addRoutes (routes: Array<RouteConfig>) {
    this.matcher.addRoutes(routes)
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }
}

/**
 * @description 向指定数组注册一个回调钩子函数
 * @param {Array<any>} list
 * @param {Function} fn
 * @returns {Function} 返回一个cancel函数
 */
function registerHook (list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}

function createHref (base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}

VueRouter.install = install
VueRouter.version = '__VERSION__'

if (inBrowser && window.Vue) {
  window.Vue.use(VueRouter)
}
