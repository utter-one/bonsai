# Introduction

Bonsai Backend is a powerful, extensible backend service for building conversational AI applications. It provides a complete platform for designing, deploying, and managing AI-powered voice and text conversations at scale.

## Overview

Bonsai Backend provides:

- **REST API** — Manage projects, agents, stages, classifiers, knowledge bases, and more
- **WebSocket API** — Real-time bidirectional communication for live conversational AI sessions with streaming audio and text support
- **Authentication** — JWT-based authentication with role-based permissions and API keys
- **Multi-Provider Support** — Integrate with OpenAI, Anthropic, Google Gemini, Azure, ElevenLabs, Deepgram, Cartesia, and more
- **Conversation Design** — Build complex multi-stage flows with classifiers, context transformers, knowledge bases, and custom actions
- **Scripting & Extensibility** — Execute custom JavaScript in a sandboxed environment, call external webhooks, and integrate tools

## How It Works

At a high level, Bonsai Backend lets you design **Projects** — self-contained conversational AI experiences. Each project is composed of **Stages** (conversation phases), **Agents** (AI personalities with voice settings), **Classifiers** (intent detectors), **Knowledge** (FAQ data), and **Actions** (behaviors triggered by user input).

When an end user connects via WebSocket and starts a conversation, the system:

1. Transcribes the user's voice input (ASR) or accepts text
2. Classifies user intent using LLM-powered classifiers
3. Populates stage variables via context transformers (data extraction, prompt fragments, flow-control flags)
4. Executes matching actions and their effects (scripts, webhooks, tools, stage navigation)
5. Generates an AI response using the stage prompt and conversation history
6. Synthesizes the response as audio (TTS) and streams it back to the client

All of this happens in real-time, with text and audio streamed incrementally to the client.

## Guide Contents

This guide covers:

| Section | Description |
|---|---|
| [Installation](./installation) | Setting up and running the server |
| [Configuration](./configuration) | Environment variables and server settings |
| [Core Concepts](./concepts) | Architecture overview and entity relationships |
| [APIs](./apis) | REST API, WebSocket API, and schema endpoints |
| [Projects](./projects) | Top-level container for conversational experiences |
| [Stages](./stages) | Conversation phases and flow control |
| [Agents](./agents) | AI personality and voice configuration |
| [Actions & Effects](./actions-and-effects) | Behaviors triggered by user input |
| [Classifiers](./classifiers) | LLM-powered intent classification |
| [Context Transformers](./context-transformers) | LLM-powered variable population: data extraction, prompt fragments, flow control |
| [Tools](./tools) | LLM-powered callable tools |
| [Knowledge Base](./knowledge) | FAQ categories and items |
| [Sample Copies](./sample-copies) | Pre-written scripted responses with variant selection and classifier-driven matching |
| [Global Actions](./global-actions) | Reusable cross-stage action definitions |
| [Guardrails](./guardrails) | Content safety classifiers and moderation |
| [Providers](./providers) | LLM, TTS, ASR, and Storage provider integrations |
| [Users](./users) | End-user profiles and lifecycle |
| [Environments](./environments) | Remote instance connections for migration |
| [Conversations](./conversations) | Conversation lifecycle, states, and events |
| [Content Moderation](./moderation) | Input screening and safety policies |
| [WebSocket Channel](./websocket) | Real-time communication protocol reference |
| [WebRTC Channel](./webrtc) | Lower-latency WebRTC DataChannel protocol reference |
| [Authentication](./authentication) | Operator auth, API keys, and RBAC |
| [Templating](./templating) | Handlebars templates in prompts |
| [Scripting](./scripting) | Sandboxed JavaScript execution in effects |
| [Issues](./issues) | Bug tracking linked to conversations |
| [Audit Logs](./audit-logs) | Change tracking and compliance |

## Quick Start

See the [Installation](./installation) guide to get up and running.
