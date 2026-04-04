import DefaultTheme from 'vitepress/theme'
import { useData, useRouter, inBrowser } from 'vitepress'
import { watch, onMounted, nextTick } from 'vue'
import './style.css'

const lightThemeVariables = {
  primaryColor: '#ecfdf5',
  primaryTextColor: '#064e3b',
  primaryBorderColor: '#059669',
  lineColor: '#059669',
  secondaryColor: '#d1fae5',
  tertiaryColor: '#f3f4f6',
  background: '#f9fafb',
  fontFamily: 'Lexend, system-ui, sans-serif',
  fontSize: '14px',
}

const darkThemeVariables = {
  darkMode: true,
  primaryColor: '#064e3b',
  primaryTextColor: '#6ee7b7',
  primaryBorderColor: '#34d399',
  lineColor: '#34d399',
  secondaryColor: '#065f46',
  tertiaryColor: '#090b0c',
  background: '#090b0c',
  edgeLabelBackground: '#090b0c',
  fontFamily: 'Lexend, system-ui, sans-serif',
  fontSize: '14px',
}

export default {
  extends: DefaultTheme,
  setup() {
    if (!inBrowser) return
    const { isDark } = useData()
    const router = useRouter()

    const renderDiagrams = async () => {
      const mermaid = (await import('mermaid')).default
      mermaid.initialize({
        startOnLoad: false,
        htmlLabels: false,
        theme: 'base',
        themeVariables: isDark.value ? darkThemeVariables : lightThemeVariables,
      })
      await nextTick()
      // Preserve original source before first render so theme toggle can restore it
      document.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])').forEach(el => {
        if (!el.dataset.mermaidSrc) {
          el.dataset.mermaidSrc = el.textContent?.trim() ?? ''
        }
      })
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'))
      if (nodes.length > 0) {
        await mermaid.run({ nodes })
      }
    }

    onMounted(() => {
      renderDiagrams()
    })

    // Re-render on SPA navigation
    router.onAfterRouteChanged = () => {
      renderDiagrams()
    }

    // Re-render with new theme on dark/light toggle
    watch(isDark, () => {
      document.querySelectorAll<HTMLElement>('.mermaid[data-processed]').forEach(el => {
        const src = el.dataset.mermaidSrc
        if (src) {
          el.textContent = src
          el.removeAttribute('data-processed')
        }
      })
      renderDiagrams()
    })
  },
}
