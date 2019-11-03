/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn, isError, isExtendedError } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'
import { NavigationDuplicated } from './errors'

// 完整的导航解析流程 https://router.vuejs.org/zh/guide/advanced/navigation-guards.html#%E5%AE%8C%E6%95%B4%E7%9A%84%E5%AF%BC%E8%88%AA%E8%A7%A3%E6%9E%90%E6%B5%81%E7%A8%8B
// 1. 导航被触发。
// 2. 在失活的组件里调用离开守卫。
// 3. 调用全局的 beforeEach 守卫。
// 4. 在重用的组件里调用 beforeRouteUpdate 守卫 (2.2+)。
// 5. 在路由配置里调用 beforeEnter。
// 6. 解析异步路由组件。
// 7. 在被激活的组件里调用 beforeRouteEnter。
// 8. 调用全局的 beforeResolve 守卫 (2.5+)。
// 9. 导航被确认。
// 10. 调用全局的 afterEach 钩子。
// 11. 触发 DOM 更新。
// 12. 用创建好的实例调用 beforeRouteEnter 守卫中传给 next 的回调函数。

// 基类 HTML5History和HashHistory都继承这个对象
export class History {
  router: Router
  base: string
  current: Route // 当前导航的route对象
  pending: ?Route // 正在导航中的toRoute对象
  cb: (r: Route) => void
  ready: boolean
  readyCbs: Array<Function>
  readyErrorCbs: Array<Function>
  errorCbs: Array<Function>

  // implemented by sub-classes 由子类实现
  +go: (n: number) => void
  +push: (loc: RawLocation) => void
  +replace: (loc: RawLocation) => void
  +ensureURL: (push?: boolean) => void // 调用原生history对象方法，确认改变url地址栏
  +getCurrentLocation: () => string

  constructor (router: Router, base: ?string) {
    this.router = router
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START
    this.pending = null
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
  }

  listen (cb: Function) {
    this.cb = cb
  }

  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }

  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }
  /**
   * @description 框架导航的入口方法
   * @param {RawLocation} location toRoute 的url
   * @param {Function} onComplete 导航完成回调函数
   * @param {Function} onAbort 取消导航完成回调
   */
  transitionTo (
    location: RawLocation,
    onComplete?: Function,
    onAbort?: Function
  ) {
    // 根据Location对象创建Route对象
    const route = this.router.match(location, this.current)
    // 实际导航方法
    this.confirmTransition(
      route,
      () => {
        // 确认导航，调用全局的afterEach钩子
        this.updateRoute(route)
        // 调用用户设置的onComplete函数
        // this.$router.push({
        //   name: '',
        // }, function onComplete(toRoute) {
        //   // 导航确认后的回调函数
        // });
        onComplete && onComplete(route)
        // 如果onComplete中没有根据toRoute改变url，
        // 则调用ensureURL确保会改变url地址栏，相当于兜底操作
        this.ensureURL()

        // fire ready cbs once
        if (!this.ready) {
          this.ready = true
          this.readyCbs.forEach(cb => {
            cb(route)
          })
        }
      },
      err => {
        if (onAbort) {
          onAbort(err)
        }
        if (err && !this.ready) {
          this.ready = true
          this.readyErrorCbs.forEach(cb => {
            cb(err)
          })
        }
      }
    )
  }

  /**
   * @description 导航处理方法，在这个方法中开始导航并且运行了完整导航解析流程的1~8步
   * 从导航被触发 到 导航被确认
   * @param {Route} route toRoute对象
   * @param {Function} onComplete 导航确认后的回调函数
   * @param {Function} onAbort 取消回调函数
   */
  confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {
    const current = this.current
    const abort = err => {
      // after merging https://github.com/vuejs/vue-router/pull/2771 we
      // When the user navigates through history through back/forward buttons
      // we do not want to throw the error. We only throw it if directly calling
      // push/replace. That's why it's not included in isError
      if (!isExtendedError(NavigationDuplicated, err) && isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => {
            cb(err)
          })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    if (
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      route.matched.length === current.matched.length
    ) {
      this.ensureURL()
      return abort(new NavigationDuplicated(route))
    }
    // updated、deactivated、activated是三个RouteRecord数组
    const { updated, deactivated, activated } = resolveQueue(
      this.current.matched, // 当前Route匹配的RouteRecord
      route.matched // 目标Route匹配的RouteRecord
    )

    // queue都是导航确认前的路由钩子函数组成的数组
    // 从这里可以看到完整的导航解析流程的一部分
    // https://router.vuejs.org/zh/guide/advanced/navigation-guards.html#%E5%AE%8C%E6%95%B4%E7%9A%84%E5%AF%BC%E8%88%AA%E8%A7%A3%E6%9E%90%E6%B5%81%E7%A8%8B
    const queue: Array<?NavigationGuard> = [].concat(
      // in-component leave guards NOTE: beforeRouteLeave
      extractLeaveGuards(deactivated), // 从deactivated的RouteRecord中提取出导航守卫 在失活的组件里调用离开守卫。
      // global before hooks NOTE: beforeEach
      this.router.beforeHooks, // beforEach 路由钩子 调用全局的 beforeEach 守卫。
      // in-component update hooks NOTE: beforeRouteUpdate
      extractUpdateHooks(updated), // 从updated的RouteRecord中提取出导航守卫  在重用的组件里调用 beforeRouteUpdate 守卫 (2.2+)。
      // in-config enter guards NOTE: beforeEnter
      // https://router.vuejs.org/zh/guide/advanced/navigation-guards.html#%E8%B7%AF%E7%94%B1%E7%8B%AC%E4%BA%AB%E7%9A%84%E5%AE%88%E5%8D%AB
      activated.map(m => m.beforeEnter), // 从activated的RouteRecord中提取出导航守卫，也就是路由独享的beforeEnter  在路由配置里调用 beforeEnter。
      // async components 返回一个路由钩子函数，负责解析异步组件 NavigationGuard
      resolveAsyncComponents(activated) // 解析异步路由组件。
    )
    // NOTE: 打印查看queue队列 queue数组中存储了所有定义好的路由导航钩子函数
    console.log(queue)
    // 设置toRoute为正在加载的route
    this.pending = route
    /**
     *
     * @param {NavigationGuard} hook 需要被运行的钩子函数
     * @param {Function} next 运行完当前钩子函数后，调用next开始下一个钩子函数运行
     */
    const iterator = (hook: NavigationGuard, next) => {
      if (this.pending !== route) {
        // 如果当前正在加载的route已经发生变化，说明导航路由发生了突变，则调用abort放弃剩下的路由钩子执行
        return abort()
      }
      try {
        // 调用设置到NavigationGuard(to, from, next)
        hook(route, current, (to: any) => {
          if (to === false || isError(to)) {
            // next(false) -> abort navigation, ensure current URL
            // 放弃导航，根据currentRoute对象重新确认url地址栏并且需要使用replace，以避免对当前历史栈产生影响
            this.ensureURL(true)
            // 调用用户设置的取消回调函数
            abort(to) // 不再调用next函数，放弃剩下的路由钩子
          } else if (
            typeof to === 'string' ||
            (typeof to === 'object' &&
              (typeof to.path === 'string' || typeof to.name === 'string'))
          ) {
            // 如果用户在next中传入了path或者对象，则意味用户想要重定向路由导航
            // next('/') or next({ path: '/' }) -> redirect
            abort()
            if (typeof to === 'object' && to.replace) {
              // 根据用户设置调用replace方法，重启导航过程，不再调用next函数，放弃剩下的路由钩子
              this.replace(to)
            } else {
              // 根据用户设置调用push方法，重启导航过程，不再调用next函数，放弃剩下的路由钩子
              this.push(to)
            }
          } else {
            // confirm transition and pass on the value
            // 确认继续导航
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }

    // 运行导航时的路由钩子queue
    runQueue(queue, iterator, () => {
      // 此时已经完成了路由导航的以下步骤的1 ~ 6步
      // 1. 导航被触发。
      // 2. 在失活的组件里调用离开守卫。
      // 3. 调用全局的 beforeEach 守卫。
      // 4. 在重用的组件里调用 beforeRouteUpdate 守卫 (2.2+)。
      // 5. 在路由配置里调用 beforeEnter。
      // 6. 解析异步路由组件。
      // 7. 在被激活的组件里调用 beforeRouteEnter。
      // 8. 调用全局的 beforeResolve 守卫 (2.5+)。
      // 9. 导航被确认。
      // 10. 调用全局的 afterEach 钩子。
      // 11. 触发 DOM 更新。
      // 12. 用创建好的实例调用 beforeRouteEnter 守卫中传给 next 的回调函数。
      const postEnterCbs = [] // 从来存储beforeRouteEnter钩子中的next函数接收的回调函数
      const isValid = () => this.current === route
      // wait until async components are resolved before
      // extracting in-component enter guards
      // 从被激活的组件总提取beforeRouteEnter路由钩子
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
      const queue = enterGuards.concat(this.router.resolveHooks) // 全局的 beforeResolve 钩子
      runQueue(queue, iterator, () => {
        // 此时完成了上述路由导航步骤的7~8步
        if (this.pending !== route) { // 检查当前加载的路由是否起了变化，如果发生变化则调用取消回调
          return abort()
        }
        this.pending = null
        onComplete(route)
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            // 调用beforeRouteEnter中的next函数接收的回调函数，已经绑定了vm参数
            // beforeRouteEnter (to, from, next) {
            //   next(vm => {
            //     // 通过 `vm` 访问组件实例
            //   })
            // }
            postEnterCbs.forEach(cb => {
              cb()
            })
          })
        }
      })
    })
  }
  // 更新Route对象，调用afterEach钩子
  updateRoute (route: Route) {
    const prev = this.current
    // 设置当前路由对象
    this.current = route
    this.cb && this.cb(route)
    // 调用vuerouter.afterEach钩子
    this.router.afterHooks.forEach(hook => {
      hook && hook(route, prev) // to, from
    })
  }
}

function normalizeBase (base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  return base.replace(/\/$/, '')
}

/**
 * @description 传入两个RouteRecord数组，返回相同的部分和不同的部分
 * @param {*} current 当前RouteRecord
 * @param {*} next 目标Route的RouteRecord
 */
function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    // NOTE: 为啥next和current中相同的一定都排在前面？
    updated: next.slice(0, i), // next和current中相同的RouteRecord归为update数组
    activated: next.slice(i), // next中和current不相同的归为activated数组
    deactivated: current.slice(i) // current中和next不相同的归为deactivated数组
  }
}

/**
 * @description 传入RouteRecord对象，从RouteRecord的components中提取指定name的路由导航钩子函数
 * @param {*} records 传入的RouteRecord对象数组，其中的components属性引用这组件实例
 * @param {*} name 需要从组件实例中提取的路有钩子名称 ’beforeRouteLeave‘ 等等
 * @param {*} bind
 * @param {*} reverse
 * @returns 返回路由钩子数组
 */
function extractGuards (
  records: Array<RouteRecord>,
  name: string,
  bind: Function,
  reverse?: boolean
): Array<?Function> {
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    // 从vue options中获取指定名称的路由钩子
    // 这个vue options是match的routeRecord的compoments中的vue options
    // 所以只有注册到routeConfig的组件的路由独享守卫才会被调用
    const guard = extractGuard(def, name)
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  return flatten(reverse ? guards.reverse() : guards)
}
// 从VueOptions中获取指定key的value
function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}

function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}

function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}

// 传入路由导航钩子和vue实例，返回一个绑定了vue实例调用的路由钩子函数
function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      // 绑定this指针
      return guard.apply(instance, arguments)
    }
  }
}

function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(
    activated,
    'beforeRouteEnter',
    (guard, _, match, key) => {
      return bindEnterGuard(guard, match, key, cbs, isValid)
    }
  )
}

function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>,
  isValid: () => boolean
): NavigationGuard {
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      if (typeof cb === 'function') {
        cbs.push(() => {
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          poll(cb, match.instances, key, isValid)
        })
      }
      next(cb)
    })
  }
}

function poll (
  cb: any, // somehow flow cannot infer this is a function
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (
    instances[key] &&
    !instances[key]._isBeingDestroyed // do not reuse being destroyed instance
  ) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
