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
            { text: 'APIs', link: '/guide/apis' },
          ],
        },
        {
          text: 'Entities',
          items: [
            { text: 'Projects', link: '/guide/projects' },
            { text: 'Stages', link: '/guide/stages' },
            { text: 'Agents', link: '/guide/agents' },
            { text: 'Classifiers', link: '/guide/classifiers' },
            { text: 'Context Transformers', link: '/guide/context-transformers' },
            { text: 'Tools', link: '/guide/tools' },
            { text: 'Knowledge Base', link: '/guide/knowledge' },
            { text: 'Global Actions', link: '/guide/global-actions' },
            { text: 'Guardrails', link: '/guide/guardrails' },
            { text: 'Providers', link: '/guide/providers' },
            { text: 'Users', link: '/guide/users' },
            { text: 'Environments', link: '/guide/environments' },
          ],
        },
        {
          text: 'Conversation',
          items: [
            { text: 'Conversations', link: '/guide/conversations' },
            { text: 'Actions & Effects', link: '/guide/actions-and-effects' },
            { text: 'Content Moderation', link: '/guide/moderation' },
            { text: 'WebSocket Channel', link: '/guide/websocket' },
            { text: 'WebRTC Channel', link: '/guide/webrtc' },
            { text: 'Templating', link: '/guide/templating' },
            { text: 'Scripting', link: '/guide/scripting' },
          ],
        },
        {
          text: 'Operations',
          items: [
            { text: 'Issues', link: '/guide/issues' },
            { text: 'Audit Logs', link: '/guide/audit-logs' },
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
            { text: 'Operators', link: '/api/operators' },
            { text: 'Version', link: '/api/version' },
          ],
        },
        {
          text: 'Core Resources',
          items: [
            { text: 'Projects', link: '/api/projects' },
            { text: 'Stages', link: '/api/stages' },
            { text: 'Agents', link: '/api/agents' },
            { text: 'Classifiers', link: '/api/classifiers' },
            { text: 'Context Transformers', link: '/api/context-transformers' },
            { text: 'Tools', link: '/api/tools' },
            { text: 'Global Actions', link: '/api/global-actions' },
            { text: 'Guardrails', link: '/api/guardrails' },
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
            { text: 'Analytics', link: '/api/analytics' },
          ],
        },
        {
          text: 'Real-time',
          items: [
            { text: 'WebSocket', link: '/api/websocket' },
            { text: 'WebRTC', link: '/api/webrtc' },
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
