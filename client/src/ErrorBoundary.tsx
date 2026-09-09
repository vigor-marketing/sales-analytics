import { Component, type ErrorInfo, type ReactNode } from 'react'
export default class ErrorBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? e.message : String(e) } }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error('[boundary]', e, info) }
  render() {
    if (this.state.err) return (
      <div style={{ maxWidth: 720, margin: '40px auto', padding: 20, fontFamily: 'system-ui' }}>
        <h2>页面出错（已捕获）</h2>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#ffeded', padding: 12, borderRadius: 8 }}>{this.state.err}</pre>
        <button onClick={() => location.reload()}>刷新重试</button>
      </div>
    )
    return this.props.children
  }
}
