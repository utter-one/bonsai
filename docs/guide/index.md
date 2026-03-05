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
3. Extracts structured data via context transformers
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
| [Projects](./projects) | Top-level container for conversational experiences |
| [Stages](./stages) | Conversation phases and flow control |
| [Agents](./agents) | AI personality and voice configuration |
| [Actions & Effects](./actions-and-effects) | Behaviors triggered by user input |
| [Classifiers](./classifiers) | LLM-powered intent classification |
| [Context Transformers](./context-transformers) | Structured data extraction from conversations |
| [Tools](./tools) | LLM-powered callable tools |
| [Knowledge Base](./knowledge) | FAQ categories and items |
| [Global Actions](./global-actions) | Reusable cross-stage action definitions |
| [Providers](./providers) | LLM, TTS, ASR, and Storage provider integrations |
| [Conversations](./conversations) | Conversation lifecycle, states, and events |
| [WebSocket Protocol](./websocket) | Real-time communication protocol reference |
| [Authentication](./authentication) | Operator auth, API keys, and RBAC |
| [Templating](./templating) | Handlebars templates in prompts |
| [Scripting](./scripting) | Sandboxed JavaScript execution in effects |

## Quick Start

See the [Installation](./installation) guide to get up and running.
