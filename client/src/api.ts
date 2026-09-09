async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  let r: Response
  try {
    r = await fetch(url, { method, signal: ctrl.signal, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch (e) {
    throw new Error(`无法连接后端（${(e as Error).name === 'AbortError' ? '超时' : '请确认服务已启动'}），当前地址 ${location.origin}`)
  } finally { clearTimeout(timer) }
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: string }
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`)
  return j.data as T
}
export const get = <T>(url: string) => req<T>('GET', url)
export const post = <T>(url: string, body?: unknown) => req<T>('POST', url, body)
export const put = <T>(url: string, body?: unknown) => req<T>('PUT', url, body)
export const del = <T>(url: string) => req<T>('DELETE', url)
