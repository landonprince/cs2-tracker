import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const steamHeaders = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.setHeader(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    proxyReq.setHeader('Referer', 'https://steamcommunity.com/')
    proxyReq.setHeader('Accept', 'text/html,application/json,*/*')
    proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9')
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/steam-inventory': {
        target: 'https://steamcommunity.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steam-inventory/, '/inventory'),
        configure: steamHeaders,
      },
      '/steam-market': {
        target: 'https://steamcommunity.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/steam-market/, '/market'),
        configure: steamHeaders,
      },

      '/csfloat': {
        target: 'https://csfloat.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/csfloat/, '/api/v1'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            proxyReq.setHeader('Accept', 'application/json')
            proxyReq.setHeader('Origin', 'https://csfloat.com')
          })
        },
      },
    },
  },
})
