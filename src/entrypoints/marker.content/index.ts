// 注入页面主世界标记：云笈站点据此检测扩展是否已安装，
// 用于跨域开关开启失败时的诊断提示（区分"未安装"与"已安装未放行"）。
// 内容脚本默认在隔离世界运行，window 标记需通过内联 script 注入主世界。
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    const script = document.createElement('script')
    script.textContent =
      'Object.defineProperty(window,"__yunjiCollection",{value:{installed:true},configurable:true});'
    ;(document.head || document.documentElement).appendChild(script)
    script.remove()
  },
})
