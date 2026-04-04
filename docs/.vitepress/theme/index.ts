import DefaultTheme from 'vitepress/theme'
import { useData, inBrowser } from 'vitepress'
import { watchEffect } from 'vue'
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
  tertiaryColor: '#1f2937',
  background: '#0d0f14',
  edgeLabelBackground: '#0d0f14',
  fontFamily: 'Lexend, system-ui, sans-serif',
  fontSize: '14px',
}

export default {
  extends: DefaultTheme,
  setup() {
    if (!inBrowser) return
    const { isDark } = useData()
    watchEffect(async () => {
      const mermaid = (await import('mermaid')).default
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: isDark.value ? darkThemeVariables : lightThemeVariables,
      })
    })
  },
}
