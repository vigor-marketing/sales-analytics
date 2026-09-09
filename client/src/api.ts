async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: string }
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`)
  return j.data as T
}
export const get = <T>(url: string) => req<T>('GET', url)
export const post = <T>(url: string, body?: unknown) => req<T>('POST', url, body)
