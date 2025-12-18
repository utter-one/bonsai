# Nexus Backend - Entity Schema Documentation

This document provides an ORM-agnostic description of all database entities used in the Nexus Backend system.

---

## Conversation

Represents a conversation session between a user and an AI persona through various conversation stages.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the conversation |
| `userId` | String | Foreign Key (User), Not Null | Reference to the user (player) participating in the conversation |
| `clientId` | String | Not Null | Client application identifier |
| `stageId` | String | Not Null | Current stage identifier in the conversation flow |
| `state` | JSON Object | Not Null | Session state including variables, actions, data, and events |
| `status` | String | Not Null, Default: `'ongoing'` | Conversation status: 'ongoing', 'onhold', 'aborted' or 'finished' |
| `statusReason` | String | Nullable | Additional info on status |
| `metadata` | JSON Object | Nullable | Additional conversation-specific data |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **Many-to-One** with User (`userId`)
- **One-to-Many** with ConversationEvent

### Indexes
- Primary key on `id`
- Foreign key index on `userId`
- Recommended index on `stageId` for stage-based queries
- Recommended index on `status` for filtering conversations by status

### State Structure
```typescript
{
  variables: Record<string, Record<string, any>>; // Map of stage names to a map of stage variable names to their values (default: {})
  currentActions: string[]; // Array of currently active action identifiers (default: [])
}
```

---

## ConversationEvent

Represents an individual event in a conversation session, such as client actions, messages, classification results, tool calls, etc.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the event |
| `conversationId` | String | Foreign Key (Conversation), Not Null | Reference to the parent conversation |
| `eventType` | String | Not Null | Type of event (e.g., 'speech_signal', 'audio_chunk', 'message', 'classification') |
| `eventData` | JSON Object | Not Null | Event-specific data payload |
| `timestamp` | Timestamp | Not Null | When the event occurred |
| `metadata` | JSON Object | Nullable | Additional event-specific metadata |

### Relationships
- **Many-to-One** with Conversation (`conversationId`)

### Indexes
- Primary key on `id`
- Foreign key index on `conversationId`
- Recommended index on `eventType` for filtering by event type
- Recommended index on `timestamp` for temporal queries

### Event Types
- `user_voice`: User voice received
- `client_action`: Client action received
- `message`: User or AI messages
- `classification`: Classification results from action/variable detection
- `tool_call`: Stage tool called
- `tool_result`: Stage tool returned results
- etc.

---

## User

Represents an application user who can engage in conversations with AI personas.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the user |
| `profile` | JSON Object | Not Null | Player profile data (simple KV store) |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **One-to-Many** with Conversation

### Indexes
- Primary key on `id`

### Profile Structure
The `profile` field contains player information including name, preferences, and custom attributes.

---

## Admin

Represents an administrator user who can manage the system through the administrative interface.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Email address used as unique identifier |
| `displayName` | String | Not Null | Display name of the admin |
| `roles` | JSON Array | Not Null | An array of roles assigned to the user |
| `password` | String | Not Null | Bcrypt-hashed password for authentication |
| `metadata` | JSON Object | Nullable | Additional admin-specific data |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **One-to-Many** with AuditLog (as `userId`)

### Indexes
- Primary key on `id`

### Security Notes
- Passwords must be hashed using bcrypt before storage
- Authentication via email/password combination
- Version field enables optimistic concurrency control

---

## Persona

Represents an AI assistant character/personality with voice and behavior configuration.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the persona |
| `name` | String | Not Null | Display name of the persona |
| `prompt` | String | Not Null | Detailed prompt defining the persona's characteristics and behavior |
| `voiceConfig` | JSON Object | Nullable | Voice configuration settings for text-to-speech |
| `metadata` | JSON Object | Nullable | Additional persona-specific data |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- Referenced by ConversationStage (`personaId`)

### Indexes
- Primary key on `id`

### Voice Configuration Structure
```typescript
{
  voiceProviderId?: string; // ID of a voice provider (e.g. 'eleven-labs')
  voiceId?: string; // Text-to-speech voice identifier
  settings: {
    model?: string; // TTS model ID (e.g., 'eleven_flash_v2_5', 'eleven_multilingual_v2')
    speed?: number; // Range: 0.7-1.2, TTS speech speed (default 1.0)
    stability?: number; // Range: 0.0-1.0, Voice stability (default 0.5)
    similarityBoost?: number; // Range: 0.0-1.0, Voice similarity boost (default 0.75)
    style?: number; // Range: 0.0-1.0, Voice style for V2+ models (default 0)
    useSpeakerBoost?: boolean; // Use speaker boost for V2+ models (default true)
  }
}
```

### Voice Configuration Notes
- Voice settings are specific to ElevenLabs TTS provider and can be different with other providers
- Different models support different features (V2+ models have more options)

---

## ConversationStage

Represents a stage in the conversation flow with prompts, variable extraction, action handling, and transition rules.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `stageId` | String | Primary Key | Unique identifier for the stage |
| `prompt` | Text | Not Null | System prompt template for this stage (supports Handlebars templating) |
| `llmProvider` | String | Nullable | LLM provider override for conversation completion |
| `llmProviderConfig` | JSON Object | Nullable | LLM configuration override (without credentials) |
| `personaId` | String | Foreign Key (Persona), Not Null | Reference to the persona used in this stage |
| `enterBehavior` | JSON Object | Not Null, Default: `{}` | What should happen when entering the stage |
| `useKnowledge` | Boolean | Not Null, Default: `false` | Whether to use knowledge base in this stage |
| `knowledgeSections` | JSON Array | Not Null, Default: `[]` | Array of knowledge section IDs to use |
| `useGlobalActions` | Boolean | Not Null, Default: `true` | Whether global actions are active in this stage |
| `globalActions` | JSON Array | Not Null, Default: `[]` | Which global actions to use ([] for all) |
| `variables` | JSON Object | Not Null, Default: `{}` | Variable definitions for this stage |
| `actions` | JSON Object | Not Null, Default: `{}` | Action definitions for this stage |
| `classifierId` | String | Foreign Key (Classifier), Nullable | Reference to classifier for user input analysis |
| `transformerId` | String | Foreign Key (ContextTransformer), Nullable | Reference to context transformer for data transformation |
| `metadata` | JSON Object | Nullable | Additional stage-specific data |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **Many-to-One** with Persona (`personaId`)
- **Many-to-One** with Classifier (`classifierId`)
- **Many-to-One** with ContextTransformer (`transformerId`)
- Referenced by Conversation (`stageId`)

### Indexes
- Primary key on `stageId`
- Foreign key index on `personaId`
- Foreign key index on `classifierId`
- Foreign key index on `transformerId`

### Variables Structure
Defines variables to extract from user input with definitions and examples.

### Actions Structure
Defines actions recognizable in this stage with trigger descriptions and target stages.

---

## Classifier

Represents a reusable classifier for user input analysis that can be shared across multiple conversation stages.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the classifier |
| `name` | String | Not Null | Display name of the classifier |
| `description` | String | Nullable | Detailed description of the classifier's purpose |
| `prompt` | Text | Not Null | Classification prompt template |
| `llmProvider` | String | Nullable | LLM provider for this classifier |
| `llmProviderConfig` | JSON Object | Nullable | LLM configuration (without credentials) |
| `metadata` | JSON Object | Nullable | Additional classifier-specific data |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **One-to-Many** with ConversationStage (referenced by `classifierId`)

### Indexes
- Primary key on `id`

---

## ContextTransformer

Represents a reusable context transformer for data transformation that can be shared across multiple conversation stages.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the context transformer |
| `name` | String | Not Null | Display name of the context transformer |
| `description` | String | Nullable | Detailed description of the transformer's purpose |
| `prompt` | Text | Not Null | Transformation prompt template |
| `contextFields` | JSON Array | Nullable | Context fields for transformation |
| `llmProvider` | String | Nullable | LLM provider for this transformer |
| `llmProviderConfig` | JSON Object | Nullable | LLM configuration (without credentials) |
| `metadata` | JSON Object | Nullable | Additional transformer-specific data |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **One-to-Many** with ConversationStage (referenced by `transformerId`)

### Indexes
- Primary key on `id`

---

## Tool

Represents a reusable tool that can be invoked during conversation stages for LLM calls.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the tool |
| `name` | String | Not Null | Display name of the tool |
| `description` | String | Nullable | Detailed description of the tool's purpose |
| `prompt` | Text | Not Null | Handlebars template for tool invocation |
| `llmProvider` | String | Nullable | LLM provider for tool execution |
| `llmProviderConfig` | JSON Object | Nullable | LLM configuration (without credentials) |
| `inputType` | String | Not Null | Expected input format ('text', 'json', 'image') |
| `outputType` | String | Not Null | Expected output format ('text', 'json', 'image') |
| `metadata` | JSON Object | Nullable | Additional tool-specific data |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
None (Tools can be referenced by pipeline nodes in ConversationStage)

### Indexes
- Primary key on `id`

---

## KnowledgeSection

Represents a section for categorizing knowledge content.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the knowledge section |
| `name` | String | Not Null | Display name of the section |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- Referenced by KnowledgeCategory (`knowledgeSections`)
- Referenced by ConversationStage (`knowledgeSections`)

### Indexes
- Primary key on `id`

---

## KnowledgeCategory

Represents a category for grouping knowledge items with specific triggers.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the knowledge category |
| `name` | String | Not Null | Display name of the category |
| `promptTrigger` | String | Not Null | Description of when this category should be triggered |
| `knowledgeSections` | JSON Array | Not Null, Default: `[]` | Array of knowledge section IDs this category belongs to |
| `order` | Integer | Not Null, Default: `0` | Display order for the category |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **One-to-Many** with KnowledgeItem

### Indexes
- Primary key on `id`
- Recommended index on `order` for sorting

---

## KnowledgeItem

Represents a knowledge base item with question and answer.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the knowledge item |
| `categoryId` | String | Foreign Key (KnowledgeCategory), Not Null | Reference to the parent category |
| `question` | String | Not Null | The question or topic |
| `answer` | Text | Not Null | The answer or knowledge content |
| `order` | Integer | Not Null, Default: `0` | Display order within the category |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **Many-to-One** with KnowledgeCategory (`categoryId`)

### Indexes
- Primary key on `id`
- Foreign key index on `categoryId`
- Recommended composite index on (`categoryId`, `order`) for efficient retrieval

---

## GlobalAction

Represents global user actions that can be triggered at any point during a conversation.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the action |
| `name` | String | Not Null | Display name of the action |
| `condition` | String | Nullable | Optional condition expression for action activation |
| `promptTrigger` | String | Not Null | Description of when this action should be triggered |
| `operations` | JSON Array | Not Null, Default: `[]` | Array of operations to execute |
| `template` | String | Nullable | Optional message template for the action |
| `examples` | JSON Array | Nullable | Example phrases that trigger this action |
| `metadata` | JSON Object | Nullable | Additional action-specific data |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Action Operations
- 'ai_response' - generate AI response (voice)
- 'modify_variables' - modify one or more stage variables
- 'modify_utterance' - modify user utterance
- 'modify_user_profile' - modify one or more user profile fields
- 'set_visibility' - set visibility for user and/or AI message
- 'go_to_stage' - go to specified stage
- 'abort_converation' - hard stop
- 'finish_conversation' - graceful stop
- 'call_tool' - call specified stage tool

### Relationships
None

### Indexes
- Primary key on `id`

### Action Matching
- Prompt triggers are evaluated by LLM to determine if action matches user input
- Examples provide additional context for action recognition
- Conditions allow runtime checks before action activation
- Message visibility operations control which messages are shown/hidden

---

## Issue

Represents bug reports and issues tracked in the system.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | Integer | Primary Key, Auto-increment | Unique identifier for the issue |
| `environment` | String | Not Null | Environment where issue occurred (e.g., 'production', 'staging') |
| `buildVersion` | String | Not Null | Application build version |
| `beat` | String | Nullable | Beat/sprint identifier |
| `sessionId` | String | Nullable | Reference to related conversation session |
| `eventIndex` | Integer | Nullable | Index of event in session where issue occurred |
| `userId` | String | Nullable | User ID who reported the issue |
| `severity` | String | Not Null | Issue severity level |
| `category` | String | Not Null | Issue category or type |
| `bugDescription` | Text | Not Null | Detailed description of the bug |
| `expectedBehaviour` | Text | Not Null | Description of expected behavior |
| `comments` | Text | Not Null | Additional comments or notes |
| `status` | String | Not Null | Current issue status |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- References Conversation (`sessionId`, optional)

### Indexes
- Primary key on `id`
- Recommended index on `status` for filtering
- Recommended index on `severity` for prioritization
- Foreign key index on `sessionId`

---

## Environment

Represents an environment configuration for data migration between server instances.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the environment |
| `description` | String | Not Null | Human-readable description of the environment |
| `url` | String | Not Null | Base URL of the target server instance |
| `login` | String | Not Null | Authentication login/username |
| `password` | String | Not Null | Authentication password |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
None

### Indexes
- Primary key on `id`

### Security Notes
- Credentials should be encrypted at rest
- Used for automated data synchronization between environments
- Access should be restricted to authorized admins only

---

## AuditLog

Represents an audit log entry for tracking changes to entities.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the audit log entry |
| `userId` | String | Nullable | Admin ID who made the change |
| `action` | String | Not Null | Action type: 'create', 'update', 'delete' |
| `entityId` | String | Not Null | ID of the affected entity |
| `entityType` | String | Not Null | Type of entity (e.g., 'Admin', 'User', 'Persona') |
| `oldEntity` | JSON Object | Nullable | Entity state before change (null for create) |
| `newEntity` | JSON Object | Nullable | Entity state after change (null for delete) |
| `version` | Integer | Not Null | Version number for optimistic locking |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- References Admin (`userId`, optional)

### Indexes
- Primary key on `id`
- Foreign key index on `userId`
- Recommended composite index on (`entityType`, `entityId`) for entity history queries
- Recommended index on `createdAt` for temporal queries

---

## ConversationAsset

Represents a binary asset (image, audio, document, etc.) stored in the database and associated with a conversation.

### Fields

| Field Name | Type | Constraints | Description |
|------------|------|-------------|-------------|
| `id` | String | Primary Key | Unique identifier for the asset |
| `conversationId` | String | Foreign Key (Conversation), Not Null | Reference to the associated conversation |
| `data` | Binary | Not Null | Binary asset data (BYTEA in PostgreSQL) |
| `mimeType` | String | Not Null | MIME type (e.g., 'image/jpeg', 'audio/wav', 'application/pdf') |
| `fileSize` | Integer | Not Null | File size in bytes |
| `metadata` | JSON Object | Nullable | Additional metadata (e.g., width, height, duration, originalFilename, source, compression) |
| `createdAt` | Timestamp | Auto-managed | Record creation timestamp |
| `updatedAt` | Timestamp | Auto-managed | Record last update timestamp |

### Relationships
- **Many-to-One** with Conversation (`conversationId`)

### Indexes
- Primary key on `id`
- Foreign key index on `conversationId`
- Recommended index on `mimeType` for filtering by asset type

### Storage Notes
- Assets stored as binary data in database
- Consider file size limits and database storage capacity
- Metadata can include type-specific fields:
  - Images: width, height, compression
  - Audio: duration, sampleRate, channels
  - Documents: pageCount, originalFilename
  - All: source, uploadedBy, processing status

---

## Optimistic Locking

The following entities use version-based optimistic locking to prevent concurrent update conflicts:
- **Admin** (`version` field)
- **Persona** (`version` field)
- **Classifier** (`version` field)
- **ContextTransformer** (`version` field)
- **Tool** (`version` field)
- **ConversationStage** (`version` field)
- **KnowledgeCategory** (`version` field)
- **KnowledgeItem** (`version` field)
- **GlobalAction** (`version` field)
- **Environment** (`version` field)
- **AuditLog** (`version` field)

When updating these entities, the version number must be incremented atomically to detect conflicting updates.