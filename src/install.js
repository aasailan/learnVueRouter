import View from './components/view'
import Link from './components/link'

export let _Vue

// Vue.use(VueRouter) 调用的install函数
export function install (Vue) {
  if (install.installed && _Vue === Vue) return
  install.installed = true

  _Vue = Vue

  const isDef = v => v !== undefined
  // NOTE: ??
  const registerInstance = (vm, callVal) => {
    let i = vm.$options._parentVnode // _parentVnode有什么用
    if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
      i(vm, callVal)
    }
  }
  // 混入Vue生命钩子
  Vue.mixin({
    beforeCreate () {
      // new Vue({ router: router });
      if (isDef(this.$options.router)) { // 传入了router实例的通常是根组件实例
        this._routerRoot = this
        this._router = this.$options.router
        this._router.init(this) // 调用VueRouter.init方法，传入组件实例
        // NOTE: ??
        Vue.util.defineReactive(this, '_route', this._router.history.current)
      } else {
        // 对于其他的子组件设置routerRoot对象
        this._routerRoot = (this.$parent && this.$parent._routerRoot) || this
      }
      // 注册当前实例？有什么用
      registerInstance(this, this)
    },
    destroyed () {
      // NOTE: 有什么用
      registerInstance(this)
    }
  })
  // 直接将$router定义在Vue.prototype中，使得所有Vue实例都有$router属性
  // 这个处理不如vuex的处理好（vuex会在mixin的钩子中动态添加属性）如果一个vue实例并没有注册router，但是同个项目的其他vue实例注册了
  // router，则会导致没有注册的vue实例也有$router属性
  Object.defineProperty(Vue.prototype, '$router', {
    get () { return this._routerRoot._router }
  })
  Object.defineProperty(Vue.prototype, '$route', {
    get () { return this._routerRoot._route }
  })
  // 注册两个组件 <router-view></router-view> <router-link></router-link>
  Vue.component('RouterView', View)
  Vue.component('RouterLink', Link)
  // 获取vue的options merge策略
  const strats = Vue.config.optionMergeStrategies
  // use the same hook merging strategy for route hooks
  strats.beforeRouteEnter = strats.beforeRouteLeave = strats.beforeRouteUpdate = strats.created
}
