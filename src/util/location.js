/* @flow */

import type VueRouter from '../index'
import { parsePath, resolvePath } from './path'
import { resolveQuery } from './query'
import { fillParams } from './params'
import { warn } from './warn'
import { extend } from './misc'

/**
 * @description 根据传入的对象生成标准化的Location对象
 * @param {RawLocation} raw 导航目标的RawLocation
 * @param {Route} current 当前页面的route对象
 * @param {*} append
 * @param {*} router
 */
export function normalizeLocation (
  raw: RawLocation,
  current: ?Route,
  append: ?boolean,
  router: ?VueRouter
): Location {
  // raw就是以下调用中传入的参数
  // this.$router.push({
  //   name: '',
  //   params: {
  //     ...
  //   }
  // });
  let next: Location = typeof raw === 'string' ? { path: raw } : raw
  // named target
  if (next._normalized) {
    // 已经标准化过直接返回
    return next
  } else if (next.name) {
    // 为啥有name属性，就不需要添加next._normalized标志
    next = extend({}, raw)
    const params = next.params
    if (params && typeof params === 'object') {
      next.params = extend({}, params)
    }
    return next
  }

  // relative params
  if (!next.path && next.params && current) {
    // 没有name也没有path属性？？
    next = extend({}, next)
    next._normalized = true
    const params: any = extend(extend({}, current.params), next.params)
    if (current.name) {
      next.name = current.name
      next.params = params
    } else if (current.matched.length) {
      const rawPath = current.matched[current.matched.length - 1].path
      next.path = fillParams(rawPath, params, `path ${current.path}`)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(false, `relative params navigation requires a current route.`)
    }
    return next
  }

  const parsedPath = parsePath(next.path || '')
  const basePath = (current && current.path) || '/'
  const path = parsedPath.path
    ? resolvePath(parsedPath.path, basePath, append || next.append)
    : basePath
  // 获取query对象
  const query = resolveQuery(
    parsedPath.query,
    next.query,
    router && router.options.parseQuery
  )

  let hash = next.hash || parsedPath.hash
  if (hash && hash.charAt(0) !== '#') {
    hash = `#${hash}`
  }
  // 返回标准化的Location对象
  return {
    _normalized: true,
    path, // Location path路径
    query, // Location query对象
    hash // Location hash字符串
  }
}
