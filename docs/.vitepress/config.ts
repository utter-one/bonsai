import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Bonsai Backend',
  description: 'Documentation for the Bonsai Backend API',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'API Reference', link: '/api/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Core Concepts', link: '/guide/concepts' },
          ],
        },
        {
          text: 'Entities',
          items: [
            { text: 'Projects', link: '/guide/projects' },
            { text: 'Stages', link: '/guide/stages' },
            { text: 'Personas', link: '/guide/personas' },
            { text: 'Classifiers', link: '/guide/classifiers' },
            { text: 'Context Transformers', link: '/guide/context-transformers' },
            { text: 'Tools', link: '/guide/tools' },
            { text: 'Knowledge Base', link: '/guide/knowledge' },
            { text: 'Global Actions', link: '/guide/global-actions' },
            { text: 'Providers', link: '/guide/providers' },
          ],
        },
        {
          text: 'Conversation',
          items: [
            { text: 'Conversations', link: '/guide/conversations' },
            { text: 'Actions & Effects', link: '/guide/actions-and-effects' },
            { text: 'WebSocket Protocol', link: '/guide/websocket' },
            { text: 'Templating', link: '/guide/templating' },
            { text: 'Scripting', link: '/guide/scripting' },
          ],
        },
        {
          text: 'Security',
          items: [
            { text: 'Authentication', link: '/guide/authentication' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Overview', link: '/api/' },
            { text: 'Pagination & Filtering', link: '/api/pagination' },
          ],
        },
        {
          text: 'System & Auth',
          items: [
            { text: 'Setup', link: '/api/setup' },
            { text: 'Authentication', link: '/api/authentication' },
            { text: 'Admins', link: '/api/admins' },
            { text: 'Version', link: '/api/version' },
          ],
        },
        {
          text: 'Core Resources',
          items: [
            { text: 'Projects', link: '/api/projects' },
            { text: 'Stages', link: '/api/stages' },
            { text: 'Personas', link: '/api/personas' },
            { text: 'Classifiers', link: '/api/classifiers' },
            { text: 'Context Transformers', link: '/api/context-transformers' },
            { text: 'Tools', link: '/api/tools' },
            { text: 'Global Actions', link: '/api/global-actions' },
          ],
        },
        {
          text: 'Data & Content',
          items: [
            { text: 'Knowledge', link: '/api/knowledge' },
            { text: 'Conversations', link: '/api/conversations' },
            { text: 'Users', link: '/api/users' },
            { text: 'Issues', link: '/api/issues' },
          ],
        },
        {
          text: 'Infrastructure',
          items: [
            { text: 'Providers', link: '/api/providers' },
            { text: 'Provider Catalog', link: '/api/provider-catalog' },
            { text: 'API Keys', link: '/api/api-keys' },
            { text: 'Environments', link: '/api/environments' },
            { text: 'Migration', link: '/api/migration' },
            { text: 'Audit Logs', link: '/api/audit-logs' },
          ],
        },
        {
          text: 'Real-time',
          items: [
            { text: 'WebSocket', link: '/api/websocket' },
          ],
        },
      ],
    },
    socialLinks: [],
    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright © utter.one & contributors',
    },
  },
})
