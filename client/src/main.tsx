import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import './index.css'

/** 文本域随内容自动增高：保证任何情况下文字完整可见、不被截断 */
function grow(t: HTMLTextAreaElement): void {
  if (!t.classList.contains('sa')) return
  if (t.classList.contains('fixed-h')) return // 固定行高：不随内容增高
  const cs = getComputedStyle(t)
  // 上下边框会占用 border-box 高度，少补这 2px 会裁掉最后一行
  const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
  t.style.height = 'auto'
  t.style.height = `${t.scrollHeight + border}px`
}
document.addEventListener('input', (e) => { if (e.target instanceof HTMLTextAreaElement) grow(e.target) })
document.addEventListener('focusin', (e) => { if (e.target instanceof HTMLTextAreaElement) grow(e.target) })
new MutationObserver((muts) => {
  muts.forEach((m) => m.addedNodes.forEach((n) => {
    if (!(n instanceof HTMLElement)) return
    if (n instanceof HTMLTextAreaElement) { setTimeout(() => grow(n), 0); return }
    n.querySelectorAll?.('textarea.sa').forEach((t) => setTimeout(() => grow(t as HTMLTextAreaElement), 0))
  }))
}).observe(document.body, { childList: true, subtree: true })

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
