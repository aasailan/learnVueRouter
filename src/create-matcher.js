/* @flow */

import type VueRouter from './index'
import { resolvePath } from './util/path'
import { assert, warn } from './util/warn'
import { createRoute } from './util/route'
import { fillParams } from './util/params'
import { createRouteMap } from './create-route-map'
import { normalizeLocation } from './util/location'

export type Matcher = {
  match: (raw: RawLocation, current?: Route, redirectedFrom?: Location) => Route;
  addRoutes: (routes: Array<RouteConfig>) => void;
};

/**
 * @description 创建一个route匹配器，用来根据route匹配对应的组件实例
 * @export
 * @param {Array<RouteConfig>} routes
 * @param {VueRouter} router
 * @returns {Matcher}
 */
export function createMatcher (
  routes: Array<RouteConfig>,
  router: VueRouter
): Matcher {
  // 传入routeConfigs，转换为routeRecord对象，然后存储在PathList、PathMap、NameMap中
  const { pathList, pathMap, nameMap } = createRouteMap(routes)

  // 根据传入的routes，重新初始化pathList, pathMap, nameMap三个对象，达到动态添加routeConfig的目的
  function addRoutes (routes) {
    createRouteMap(routes, pathList, pathMap, nameMap)
  }

  /**
   * @description 根据传入的raw创建对应的route对象（每次都是新建Route对象）
   * NOTE: 一个路由对象 (route object) 表示当前激活的路由的状态信息，包含了当前 URL 解析得到的信息，
   * 还有 URL 匹配到的路由记录 (route records)。路由对象是不可变 (immutable) 的，
   * 每次成功的导航后都会产生一个新的对象。
   * @param {RawLocation} raw 导航目标的url 或者 Location对象 包含了导航目标信息
   * @param {Route} [currentRoute] 当前页面的route对象 包含了当前页面信息
   * @param {Location} [redirectedFrom]
   * @returns {Route}
   */
  function match (
    raw: RawLocation, // string or Location 到
    currentRoute?: Route, // 当前页面的route对象（当前导航未确认，也就是导航过程中的fromRoute）
    redirectedFrom?: Location
  ): Route {
    // 生成Location对象，描述导航目标页面的位置信息
    const location = normalizeLocation(raw, currentRoute, false, router)
    const { name } = location

    if (name) {
      // NOTE: 根据name导航匹配
      const record = nameMap[name] // 获取routeRecord
      if (process.env.NODE_ENV !== 'production') {
        warn(record, `Route with name '${name}' does not exist`)
      }
      if (!record) return _createRoute(null, location)

      // 获取params参数名称数组
      // 比如设置routeConfig时， path: '/store/:id/:sid'
      // 这里的paramNames 就是 ['id', 'sid'];
      const paramNames = record.regex.keys
        .filter(key => !key.optional)
        .map(key => key.name)
      console.log('paramNames', paramNames)

      if (typeof location.params !== 'object') {
        // 如果用户没有初始化params属性，则初始化
        // route.params指向此对象
        // NOTE: 如果以name属性进行导航，那么params对像要么是用户初始化好的，要么为空，无需从url解析初始化
        // query对象同理
        location.params = {}
      }
      if (currentRoute && typeof currentRoute.params === 'object') {
        for (const key in currentRoute.params) {
          // 遍历当前页面route对象的params参数
          if (!(key in location.params) && paramNames.indexOf(key) > -1) {
            // TODO: 含义不明
            location.params[key] = currentRoute.params[key]
          }
        }
      }
      // 将params对象填充到url，比如
      // params = {
      //   id: 1,
      //   sid: 2,
      // }
      // path = '/store/:id/:sid'
      // 填充后的path为 /store/1/2
      // NOTE: 这里params对象的value会被urlencode，因为需要填充进url
      // console.log(location.params);
      location.path = fillParams(record.path, location.params, `named route "${name}"`)
      // console.log(location.path);
      return _createRoute(record, location, redirectedFrom)
    } else if (location.path) {
      // NOTE: 根据path导航match
      // 如果根据path导航，那么params对象大概率需要从url解析
      location.params = {}
      // 在注册过的path属性中遍历查找
      for (let i = 0; i < pathList.length; i++) {
        const path = pathList[i]
        const record = pathMap[path]
        // 根据导航目标的path，查找是否有匹配的RouteRecord
        // NOTE: 当有匹配的RouteRecord时，还会从url中解析初始化params对象
        if (matchRoute(record.regex, location.path, location.params)) {
          return _createRoute(record, location, redirectedFrom)
        }
      }
    }
    // no match
    return _createRoute(null, location)
  }

  function redirect (
    record: RouteRecord,
    location: Location
  ): Route {
    const originalRedirect = record.redirect
    let redirect = typeof originalRedirect === 'function'
      ? originalRedirect(createRoute(record, location, null, router))
      : originalRedirect

    if (typeof redirect === 'string') {
      redirect = { path: redirect }
    }

    if (!redirect || typeof redirect !== 'object') {
      if (process.env.NODE_ENV !== 'production') {
        warn(
          false, `invalid redirect option: ${JSON.stringify(redirect)}`
        )
      }
      return _createRoute(null, location)
    }

    const re: Object = redirect
    const { name, path } = re
    let { query, hash, params } = location
    query = re.hasOwnProperty('query') ? re.query : query
    hash = re.hasOwnProperty('hash') ? re.hash : hash
    params = re.hasOwnProperty('params') ? re.params : params

    if (name) {
      // resolved named direct
      const targetRecord = nameMap[name]
      if (process.env.NODE_ENV !== 'production') {
        assert(targetRecord, `redirect failed: named route "${name}" not found.`)
      }
      return match({
        _normalized: true,
        name,
        query,
        hash,
        params
      }, undefined, location)
    } else if (path) {
      // 1. resolve relative redirect
      const rawPath = resolveRecordPath(path, record)
      // 2. resolve params
      const resolvedPath = fillParams(rawPath, params, `redirect route with path "${rawPath}"`)
      // 3. rematch with existing query and hash
      return match({
        _normalized: true,
        path: resolvedPath,
        query,
        hash
      }, undefined, location)
    } else {
      if (process.env.NODE_ENV !== 'production') {
        warn(false, `invalid redirect option: ${JSON.stringify(redirect)}`)
      }
      return _createRoute(null, location)
    }
  }

  function alias (
    record: RouteRecord,
    location: Location,
    matchAs: string
  ): Route {
    const aliasedPath = fillParams(matchAs, location.params, `aliased route with path "${matchAs}"`)
    const aliasedMatch = match({
      _normalized: true,
      path: aliasedPath
    })
    if (aliasedMatch) {
      const matched = aliasedMatch.matched
      const aliasedRecord = matched[matched.length - 1]
      location.params = aliasedMatch.params
      return _createRoute(aliasedRecord, location)
    }
    return _createRoute(null, location)
  }
  // // 根据routeRecord，Location对象创建route对象
  function _createRoute (
    record: ?RouteRecord,
    location: Location,
    redirectedFrom?: Location
  ): Route {
    if (record && record.redirect) {
      // 如果routeRecord有重定向的配置，那么开始重定向
      return redirect(record, redirectedFrom || location)
    }
    if (record && record.matchAs) {
      return alias(record, location, record.matchAs)
    }
    // 根据routeRecord，Location对象创建route对象
    // console.log('before createRoute, location', location);
    return createRoute(record, location, redirectedFrom, router)
  }

  // 返回一个对象，包含match和addRoutes方法
  return {
    match, // 根据当前路由匹配到组件实例
    addRoutes // 动态注册routeConfig对象
  }
}

function matchRoute (
  regex: RouteRegExp,
  path: string,
  params: Object
): boolean {
  const m = path.match(regex)

  if (!m) {
    return false
  } else if (!params) {
    return true
  }
  // NOTE: 从url中解析初始化params对象
  for (let i = 1, len = m.length; i < len; ++i) {
    const key = regex.keys[i - 1]
    // NOTE: 对url中value值进行了decode
    const val = typeof m[i] === 'string' ? decodeURIComponent(m[i]) : m[i]
    if (key) {
      // Fix #1994: using * with props: true generates a param named 0
      params[key.name || 'pathMatch'] = val
    }
  }

  return true
}

function resolveRecordPath (path: string, record: RouteRecord): string {
  return resolvePath(path, record.parent ? record.parent.path : '/', true)
}
