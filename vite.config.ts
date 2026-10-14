import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Accepte les noms de variables posés par Vercel, Supabase ou à la main. */
function pick(env: Record<string, string | undefined>, names: string[], fallback?: RegExp): string {
  for (const n of names) if (env[n]) return env[n]!.trim()
  // Variables posées avec un préfixe personnalisé (ex. MONPREFIXE_SUPABASE_URL).
  if (fallback) {
    const k = Object.keys(env).sort().find((n) => fallback.test(n) && !/SERVICE_ROLE|SECRET|JWT/.test(n) && env[n])
    if (k) return env[k]!.trim()
  }
  return ''
}

/** Garde-fou : jamais de clé secrète dans le code envoyé aux navigateurs. */
function assertPublicKey(key: string) {
  if (!key) return
  if (key.startsWith('sb_secret_')) throw new Error('Clé Supabase SECRÈTE détectée : utilise la clé publique (anon / publishable).')
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (payload.role === 'service_role') throw new Error('Clé service_role détectée : utilise la clé anon / publishable.')
    } catch (e) {
      if (e instanceof Error && e.message.includes('service_role')) throw e
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const url = pick(env, ['VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'], /SUPABASE_URL$/)
  const key = pick(env, [
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
  ], /SUPABASE_(PUBLISHABLE|ANON)_KEY$/)
  assertPublicKey(key)

  return {
    define: {
      __SUPABASE_URL__: JSON.stringify(url),
      __SUPABASE_KEY__: JSON.stringify(key),
      __REALTIME__: JSON.stringify(env.VITE_REALTIME !== 'off'),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'script-defer',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'robots.txt'],
        manifest: {
          name: 'Visites',
          short_name: 'Visites',
          description: 'Qui vient, et quand.',
          lang: 'fr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#F7F2EA',
          theme_color: '#F7F2EA',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  }
})
