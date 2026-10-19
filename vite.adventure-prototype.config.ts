import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 独立示例页面：不加载 Worker、账户配置或业务 API。
export default defineConfig({
  root: 'src/adventure', publicDir: false, envDir: false, plugins: [react()],
  server: { host: '127.0.0.1', port: 5186, strictPort: true, open: false, watch: { usePolling: true } },
})
