# LLM Provider Settings Guide

This guide explains the configuration options for LLM providers, with a focus on reasoning/thinking capabilities that enable deeper analysis and problem-solving.

## Table of Contents

- [OpenAI Provider](#openai-provider)
- [OpenAI Legacy Provider](#openai-legacy-provider)
- [Anthropic Provider](#anthropic-provider)
- [Gemini Provider](#gemini-provider)
- [Best Practices](#best-practices)

---

## OpenAI Provider

Uses the modern OpenAI Responses API with support for reasoning models like GPT-5, O1, and O3 series.

### Basic Settings

| Setting | Type | Description |
|---------|------|-------------|
| `model` | string | Model name (e.g., `gpt-4.1`, `gpt-5.2`, `gpt-5-mini`, `o1`) |
| `defaultMaxTokens` | number | Maximum output tokens (includes reasoning tokens for reasoning models) |
| `defaultTemperature` | number (0-2) | Sampling temperature. **Not used with reasoning models** |
| `defaultTopP` | number (0-1) | Nucleus sampling parameter. **Not used with reasoning models** |
| `timeout` | number | Request timeout in milliseconds |

### Reasoning Settings (GPT-5, O1, O3 models)

#### `reasoningEffort`

Controls how much internal reasoning the model performs before generating a response.

**Values:** `'none'`, `'minimal'`, `'low'`, `'medium'`, `'high'`, `'xhigh'`

- **`low`**: Faster, more economical. Best for simple tasks.
- **`medium`**: Balanced (default for most reasoning models)
- **`high`**: Maximum reasoning depth. Best for complex problems.
- **`xhigh`**: Extreme reasoning (supported on newer models like gpt-5.1-codex-max)

**When to use:**
- `low`: Simple questions, classification, fact retrieval
- `medium`: Most tasks with moderate complexity
- `high`: Complex math, advanced coding, multi-step planning
- `xhigh`: Extremely difficult problems requiring extensive analysis

⚠️ **Note:** When `reasoningEffort` is set, `temperature` and `topP` are automatically disabled.

#### `reasoningSummary`

Generates a summary of the model's reasoning process for debugging.

**Values:** `'auto'`, `'concise'`, `'detailed'`

- **`auto`**: Adapts to the model's capabilities (recommended)
- **`concise`**: Brief summary of reasoning steps
- **`detailed`**: Comprehensive breakdown of the thinking process

**Use case:** Helpful for understanding how the model arrived at its answer, debugging unexpected outputs, or providing transparency.

### Example Configurations

**Standard GPT-4.1 (non-reasoning):**
```json
{
  "model": "gpt-4.1",
  "defaultMaxTokens": 4096,
  "defaultTemperature": 0.7,
  "defaultTopP": 1.0
}
```

**GPT-5 with reasoning:**
```json
{
  "model": "gpt-5.2",
  "defaultMaxTokens": 25000,
  "reasoningEffort": "high",
  "reasoningSummary": "auto"
}
```

**O1 model (optimized for coding):**
```json
{
  "model": "o1",
  "defaultMaxTokens": 32000,
  "reasoningEffort": "high"
}
```

---

## OpenAI Legacy Provider

Uses the legacy Chat Completions API. Compatible with OpenAI and OpenAI-compatible providers (Groq, etc.).

### Settings

| Setting | Type | Description |
|---------|------|-------------|
| `model` | string | Model name (e.g., `gpt-4.1`, `gpt-4o`, `gpt-3.5-turbo`) |
| `defaultMaxTokens` | number | Maximum tokens for generation |
| `defaultTemperature` | number (0-2) | Sampling temperature for randomness |
| `defaultTopP` | number (0-1) | Nucleus sampling parameter |
| `timeout` | number | Request timeout in milliseconds |

**Note:** Legacy API does not support reasoning parameters. Use the main OpenAI provider for reasoning models.

### Example Configuration

```json
{
  "model": "gpt-4.1",
  "defaultMaxTokens": 4096,
  "defaultTemperature": 0.7,
  "defaultTopP": 0.95
}
```

---

## Anthropic Provider

Uses Claude models with Extended Thinking capability for complex reasoning tasks.

### Basic Settings

| Setting | Type | Description |
|---------|------|-------------|
| `model` | string | Model name (e.g., `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`) |
| `defaultMaxTokens` | number | Maximum tokens (includes thinking tokens when extended thinking is enabled) |
| `defaultTemperature` | number (0-1) | Sampling temperature. **Not compatible with extended thinking** |
| `defaultTopP` | number (0-1) | Top-p sampling. Limited to 0.95-1.0 when thinking is enabled |
| `timeout` | number | Request timeout in milliseconds |
| `anthropicVersion` | string | Anthropic API version (optional) |

### Extended Thinking Settings

#### `thinkingMode`

Enables Claude's extended thinking capability for internal reasoning.

**Values:** `'enabled'`, `'adaptive'`

- **`enabled`**: Manual mode with explicit token budget (for earlier Claude models)
- **`adaptive`**: Automatically adjusts thinking depth (recommended for Claude Opus 4.6+)

⚠️ **Important:** When thinking is enabled, `temperature` parameter is disabled and `topP` is limited to 0.95-1.0.

#### `thinkingBudgetTokens`

Maximum tokens allocated for internal reasoning (only used with `thinkingMode: 'enabled'`).

**Minimum:** 1024 tokens

**Recommended ranges:**
- **1024-4096**: Simple reasoning tasks
- **4096-16384**: Moderate complexity (most common use case)
- **16384-32768**: Complex problems requiring deep analysis
- **32768+**: Very complex tasks (may cause long response times)

**Note:** Higher budgets improve reasoning quality but increase latency and cost. The model may not use the entire budget.

### Supported Models

- Claude Opus 4.6 (use `thinkingMode: 'adaptive'`)
- Claude Opus 4.5
- Claude Sonnet 4.5
- Claude Haiku 4.5
- Claude Sonnet 4
- Claude Sonnet 3.7 (deprecated)

### Example Configurations

**Standard Claude (no thinking):**
```json
{
  "model": "claude-sonnet-4-5",
  "defaultMaxTokens": 4096,
  "defaultTemperature": 0.7
}
```

**Claude with Extended Thinking (earlier models):**
```json
{
  "model": "claude-sonnet-4-5",
  "defaultMaxTokens": 16000,
  "thinkingMode": "enabled",
  "thinkingBudgetTokens": 10000
}
```

**Claude Opus 4.6 with Adaptive Thinking:**
```json
{
  "model": "claude-opus-4-6",
  "defaultMaxTokens": 32000,
  "thinkingMode": "adaptive"
}
```

---

## Gemini Provider

Uses Google Gemini models with thinking capabilities for enhanced reasoning.

### Basic Settings

| Setting | Type | Description |
|---------|------|-------------|
| `model` | string | Model name (e.g., `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-flash`, `gemini-3-pro`) |
| `defaultMaxTokens` | number | Maximum output tokens (includes thinking tokens for thinking models) |
| `defaultTemperature` | number (0-2) | Sampling temperature |
| `defaultTopP` | number (0-1) | Top-p sampling parameter |
| `defaultTopK` | number | Top-k sampling parameter |
| `timeout` | number | Request timeout in milliseconds |
| `safetySettings` | array | Safety configuration (optional) |

### Thinking Settings

Gemini has two different thinking modes depending on the model series:

#### `thinkingLevel` (for Gemini 3 models)

Controls reasoning depth using predefined levels.

**Values:** `'minimal'`, `'low'`, `'medium'`, `'high'`

- **`minimal`**: Minimal/no thinking. Best for chat and high-throughput applications
- **`low`**: Basic reasoning for simple instruction following
- **`medium`**: Balanced thinking for most tasks
- **`high`**: Maximum reasoning depth (default for Gemini 3 models)

**Use with:** `gemini-3-pro`, `gemini-3-flash`

#### `thinkingBudget` (for Gemini 2.5 models)

Explicit token budget for thinking (similar to Anthropic's approach).

**Values:**
- **`-1`**: Dynamic thinking (default) - model adjusts automatically
- **`0`**: Disable thinking completely
- **`128-32768`**: Specific token count for reasoning

**Use with:** `gemini-2.5-pro`, `gemini-2.5-flash`

#### `includeThoughts`

Include thought summaries in the response for debugging and transparency.

**Type:** boolean

**When to enable:**
- Debugging unexpected model behavior
- Understanding the reasoning process
- Providing transparency in critical applications
- Prompt engineering and optimization

### Model Compatibility

| Model Series | Thinking Parameter | Default Behavior |
|--------------|-------------------|------------------|
| Gemini 3 Pro | `thinkingLevel` | Dynamic high |
| Gemini 3 Flash | `thinkingLevel` | Dynamic high |
| Gemini 2.5 Pro | `thinkingBudget` | Dynamic (-1) |
| Gemini 2.5 Flash | `thinkingBudget` | Dynamic (-1) |
| Gemini 2.5 Flash-Lite | `thinkingBudget` | No thinking by default |

### Example Configurations

**Gemini 3 Flash with High Thinking:**
```json
{
  "model": "gemini-3-flash",
  "defaultMaxTokens": 8192,
  "thinkingLevel": "high",
  "includeThoughts": true
}
```

**Gemini 3 Pro for Chat (minimal thinking):**
```json
{
  "model": "gemini-3-pro",
  "defaultMaxTokens": 2048,
  "thinkingLevel": "minimal"
}
```

**Gemini 2.5 Pro with Dynamic Thinking:**
```json
{
  "model": "gemini-2.5-pro",
  "defaultMaxTokens": 16384,
  "thinkingBudget": -1,
  "includeThoughts": false
}
```

**Gemini 2.5 Flash with Fixed Budget:**
```json
{
  "model": "gemini-2.5-flash",
  "defaultMaxTokens": 8192,
  "thinkingBudget": 5000,
  "includeThoughts": true
}
```

---

## Best Practices

### When to Use Reasoning/Thinking

✅ **Good use cases:**
- Complex mathematical problems
- Advanced coding and debugging
- Multi-step planning and analysis
- Scientific reasoning
- Legal document analysis
- Complex decision-making with multiple factors

❌ **Not recommended for:**
- Simple fact retrieval
- Basic classification
- Casual conversation
- Real-time chat applications (latency concerns)
- High-throughput batch processing

### Token Management

1. **Reserve adequate tokens**: For reasoning models, allocate at least 25,000 tokens (input + output + reasoning) when first experimenting
2. **Monitor usage**: Reasoning tokens are billed as output tokens but may be significantly higher than visible output
3. **Start conservative**: Begin with lower reasoning budgets and increase only if needed
4. **Use dynamic modes**: Let the model decide reasoning depth when possible (adaptive/dynamic settings)

### Performance Considerations

- **Latency**: Reasoning models take significantly longer to respond
  - Low effort/budget: Faster responses
  - High effort/budget: Much slower but higher quality
- **Cost**: Reasoning tokens are charged as output tokens
  - More reasoning = higher cost
  - Use only when quality justifies the cost
- **Streaming**: Use streaming for better user experience with long reasoning times

### Debugging and Optimization

1. **Enable thought summaries** during development to understand model behavior
2. **Disable summaries** in production to reduce latency slightly
3. **Experiment with different effort levels** to find the optimal balance
4. **Monitor incomplete responses**: If hitting token limits, increase `maxTokens`

### Provider-Specific Tips

**OpenAI:**
- `reasoningEffort` values scale well - start with `medium`
- GPT-5 models have best reasoning capabilities
- O1 models optimized for coding tasks

**Anthropic:**
- Start with 10,000 token budget for most tasks
- Use `adaptive` mode on Claude Opus 4.6+ for best results
- Extended thinking works well with tool use/function calling

**Gemini:**
- Gemini 3 models: Use `thinkingLevel` for simplicity
- Gemini 2.5 models: Use `thinkingBudget` for fine control
- Dynamic thinking (`-1`) is usually optimal
- Very large context windows make Gemini suitable for document analysis

### Temperature and Reasoning

**Important:** Most reasoning/thinking features are incompatible with temperature/sampling parameters:

- **OpenAI**: `temperature` and `topP` automatically disabled with reasoning
- **Anthropic**: `temperature` not allowed, `topP` limited to 0.95-1.0
- **Gemini**: Standard sampling parameters still work

This is by design - reasoning models work best with deterministic behavior.

---

## Quick Reference

### Choose Reasoning Settings

| Task Complexity | OpenAI | Anthropic | Gemini 3 | Gemini 2.5 |
|-----------------|--------|-----------|----------|------------|
| Simple | `low` | 1024-4096 tokens | `minimal` | 0 or 512 |
| Moderate | `medium` | 4096-10000 tokens | `low` or `medium` | 2048-8192 |
| Complex | `high` | 10000-20000 tokens | `high` | 8192-16384 |
| Very Complex | `xhigh` | 20000+ tokens | `high` | 16384-32768 |

### Token Budget Guidelines

- **Minimum viable**: 1024 tokens
- **Recommended starting point**: 5000-10000 tokens
- **High quality**: 16000-32000 tokens
- **Maximum (some providers)**: 64000+ tokens

Remember: Higher budgets = better quality but slower and more expensive.
