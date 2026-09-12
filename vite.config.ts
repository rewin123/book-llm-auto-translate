import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rolldownOptions: {
      output: {
        // The AI SDK and zod are most of the bundle and change far less often
        // than the app, so splitting them keeps them cached across deploys.
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'sdk', test: /node_modules[\\/](ai|@ai-sdk|zod)[\\/]/ },
            { name: 'zip', test: /node_modules[\\/]jszip[\\/]/ },
          ],
        },
      },
    },
  },
})
