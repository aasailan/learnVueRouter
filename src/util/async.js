/* @flow */

/**
 * 负责运行queue数组的函数
 * @param {Array<?NavigationGuard>} queue 需要被运行的路由钩子数组
 * @param {*} fn 实际负责运行queue内钩子的函数
 * @param {Function} cb 回调函数
 */
export function runQueue (queue: Array<?NavigationGuard>, fn: Function, cb: Function) {
  const step = index => {
    if (index >= queue.length) {
      cb()
    } else {
      if (queue[index]) {
        fn(queue[index], () => {
          step(index + 1)
        })
      } else {
        step(index + 1)
      }
    }
  }
  step(0)
}
