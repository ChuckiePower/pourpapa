/** localStorage tolérant (navigation privée, stockage plein…). */
export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* rien */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* rien */
    }
  },
}
