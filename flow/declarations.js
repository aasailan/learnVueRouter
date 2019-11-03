declare var document: Document;

declare class RouteRegExp extends RegExp {
  keys: Array<{ name: string, optional: boolean }>;
}

declare type PathToRegexpOptions = {
  sensitive?: boolean,
  strict?: boolean,
  end?: boolean
}

declare module 'path-to-regexp' {
  declare module.exports: {
    (path: string, keys?: Array<?{ name: string }>, options?: PathToRegexpOptions): RouteRegExp;
    compile: (path: string) => (params: Object) => string;
  }
}

declare type Dictionary<T> = { [key: string]: T }

// 导航确认前的钩子函数，例如vuerouter.beforeEach()添加的钩子函数
declare type NavigationGuard = (
  to: Route,
  from: Route,
  next: (to?: RawLocation | false | Function | void) => void
) => any

// 导航确认后的钩子函数，例如vuerouter.afterEach() 添加的钩子函数
declare type AfterNavigationHook = (to: Route, from: Route) => any

type Position = { x: number, y: number };
type PositionResult = Position | { selector: string, offset?: Position } | void;

// new VueRouter(RouterOptions)
declare type RouterOptions = {
  routes?: Array<RouteConfig>; // 用户传入的路由配置对象
  mode?: string;
  fallback?: boolean;
  base?: string;
  linkActiveClass?: string;
  linkExactActiveClass?: string;
  parseQuery?: (query: string) => Object;
  stringifyQuery?: (query: Object) => string;
  scrollBehavior?: (
    to: Route,
    from: Route,
    savedPosition: ?Position
  ) => PositionResult | Promise<PositionResult>;
}

declare type RedirectOption = RawLocation | ((to: Route) => RawLocation)

// 暴露给用户配置的对象
declare type RouteConfig = {
  path: string;
  name?: string;
  component?: any; // 路由组件，用户通常使用这个
  components?: Dictionary<any>; // { [name: string]: Component } // 命名视图组件
  redirect?: RedirectOption;
  alias?: string | Array<string>;
  children?: Array<RouteConfig>;
  beforeEnter?: NavigationGuard;
  meta?: any;
  props?: boolean | Object | Function;
  caseSensitive?: boolean;
  pathToRegexpOptions?: PathToRegexpOptions;
}

// 根据RouteConfig创建RouteRecord对象，RouteCOnfig是暴露给用户的
// RouteRecord对象是经由RouteConfig处理后，在框架内使用的对象
declare type RouteRecord = {
  path: string;
  regex: RouteRegExp;
  components: Dictionary<any>; // 当前匹配的组件构造函数或者组件构造option
  instances: Dictionary<any>; // 当前匹配的组件实例
  name: ?string;
  parent: ?RouteRecord;
  redirect: ?RedirectOption;
  matchAs: ?string;
  beforeEnter: ?NavigationGuard;
  meta: any;
  props: boolean | Object | Function | Dictionary<boolean | Object | Function>;
}

// 自定义location类型，作用类似于window.location，用来描述当前页面的位置信息，用户使用this.$router.push时传入的参数对象
// this.$router.push({
//   name: '',
//   params: {

//   },
//   ...
// });
declare type Location = {
  _normalized?: boolean;
  name?: string; // routeConfig.name
  path?: string; // routeConfig.path
  hash?: string; // 当前hash值
  query?: Dictionary<string>; // 当前query对象
  params?: Dictionary<string>; // 当前params对象
  append?: boolean; //
  replace?: boolean;
}

declare type RawLocation = string | Location

// Route声明
declare type Route = {
  path: string;
  name: ?string;
  hash: string;
  query: Dictionary<string>;
  params: Dictionary<string>;
  fullPath: string;
  matched: Array<RouteRecord>;
  redirectedFrom?: string;
  meta?: any;
}
