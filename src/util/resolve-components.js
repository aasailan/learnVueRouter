/* @flow */

import { _Vue } from '../install'
import { warn, isError } from './warn'

/**
 * @description 高阶函数，返回一个路由导航函数，负责解析异步组件
 * @export
 * @param {Array<RouteRecord>} matched
 * @returns {Function} NavigationGuard
 */
export function resolveAsyncComponents (matched: Array<RouteRecord>): Function {
  return (to, from, next) => {
    let hasAsync = false
    let pending = 0
    let error = null

    flatMapComponents(matched, (def, _, match, key) => {
      // if it's a function and doesn't have cid attached,
      // assume it's an async component resolve function.
      // we are not using Vue's default async resolving mechanism because
      // we want to halt the navigation until the incoming component has been
      // resolved.
      // NOTE:
      // route = {
      //   name: '',
      //   path: '',
      //   components: {
      //     default: () => import('...index.vue'), // 这个就是def
      //   }
      // }
      // 如果def是函数，则认为存在异步组件
      if (typeof def === 'function' && def.cid === undefined) {
        hasAsync = true
        pending++ // 异步加载计数器

        const resolve = once(resolvedDef => {
          if (isESModule(resolvedDef)) {
            resolvedDef = resolvedDef.default
          }
          // save resolved on async factory in case it's used elsewhere
          def.resolved = typeof resolvedDef === 'function'
            ? resolvedDef
            : _Vue.extend(resolvedDef)
          match.components[key] = resolvedDef // 异步加载后export出的对象
          pending--
          if (pending <= 0) { // 如果所有异步加载都结束则next，继续路由导航
            next()
          }
        })

        const reject = once(reason => {
          const msg = `Failed to resolve async component ${key}: ${reason}`
          process.env.NODE_ENV !== 'production' && warn(false, msg)
          if (!error) {
            error = isError(reason)
              ? reason
              : new Error(msg)
            next(error)
          }
        })

        let res
        try {
          // 运行异步加载组件函数，传入定义好的resolve和reject，处理以下使用场景
          // const route = {
          //   name: '',
          //   path: '',
          //   component: (resolve, reject) => {
          //     // 异步加载组件，然后回调resolve即可
          //   }
          // }
          res = def(resolve, reject)
        } catch (e) {
          reject(e)
        }
        if (res) {
          if (typeof res.then === 'function') {
            // 如果返回的res是promise，则添加then监听，处理以下使用场景
            // const route = {
            //   name: '',
            //   path: '',
            //   component: () => import('...index.vue'),
            // }
            res.then(resolve, reject)
          } else {
            // new syntax in Vue 2.3
            // https://cn.vuejs.org/v2/guide/components-dynamic-async.html#%E5%A4%84%E7%90%86%E5%8A%A0%E8%BD%BD%E7%8A%B6%E6%80%81
            // 处理异步组件工厂函数
            const comp = res.component
            if (comp && typeof comp.then === 'function') {
              comp.then(resolve, reject)
            }
          }
        }
      }
    })

    if (!hasAsync) next() // 没有异步加载组件，直接next
  }
}
/**
 * @description 传入routeRecord的数组，对routeRecord的所有Components应用fn函数，然后返回一个由fn函数结果返回的数组
 * @param {*} matched
 * @param {*} fn
 */
export function flatMapComponents (
  matched: Array<RouteRecord>,
  fn: Function
): Array<?Function> {
  return flatten(matched.map(m => {
    // 遍历所有RouteRecord
    return Object.keys(m.components).map(key => fn(
      // 遍历每一个RouteRecord下的每一个Components
      m.components[key], // 每一个Components构造函数或者构造options
      m.instances[key], // 每一个匹配的组件实例
      m, key // key是命名组件的名称 m是RouteRecord
    ))
  }))
}

// 起到类似Array.flat(1);的效果
export function flatten (arr: Array<any>): Array<any> {
  return Array.prototype.concat.apply([], arr)
}

const hasSymbol =
  typeof Symbol === 'function' &&
  typeof Symbol.toStringTag === 'symbol'

// 检查是否esmodule的导出
function isESModule (obj) {
  return obj.__esModule || (hasSymbol && obj[Symbol.toStringTag] === 'Module')
}

// in Webpack 2, require.ensure now also returns a Promise
// so the resolve/reject functions may get called an extra time
// if the user uses an arrow function shorthand that happens to
// return that Promise.
// 包装fn，确保fn只能被调用一次
function once (fn) {
  let called = false
  return function (...args) {
    if (called) return
    called = true
    return fn.apply(this, args)
  }
}
