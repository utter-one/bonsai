# Knowledge

The Knowledge API manages a hierarchical knowledge base organized into categories and items. Knowledge is used to provide factual answers during conversations.

**Tag:** `Knowledge` | **Scoped to:** Project

For more information, see the [Knowledge Base](../guide/knowledge) guide.

## Create Category

```http
POST /api/projects/:projectId/knowledge/categories
Content-Type: application/json
```

**Required permission:** `knowledge:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `name` | `string` (min 1) | Yes | Category name |
| `promptTrigger` | `string` (min 1) | Yes | Trigger phrase that activates this category |
| `tags` | `string[]` | No | Knowledge tags for filtering |
| `order` | `integer` (min 0) | No (default: `0`) | Display order |

**Response** `201 Created` — [Category Response](#category-response)

## Get Category

```http
GET /api/projects/:projectId/knowledge/categories/:id
```

**Required permission:** `knowledge:read`

**Response** `200 OK` — [Category Response](#category-response) (includes nested items)

## List Categories

```http
GET /api/projects/:projectId/knowledge/categories
```

**Required permission:** `knowledge:read`

Supports [pagination & filtering](./pagination).

## Update Category

```http
PUT /api/projects/:projectId/knowledge/categories/:id
Content-Type: application/json
```

**Required permission:** `knowledge:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |
| `name` | `string` (min 1) | No | Updated name |
| `promptTrigger` | `string` (min 1) | No | Updated trigger phrase |
| `tags` | `string[]` | No | Updated tags |
| `order` | `integer` (min 0) | No | Updated order |

**Response** `200 OK` — [Category Response](#category-response)

## Delete Category

```http
DELETE /api/projects/:projectId/knowledge/categories/:id
Content-Type: application/json
```

**Required permission:** `knowledge:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

---

## Create Item

```http
POST /api/projects/:projectId/knowledge/items
Content-Type: application/json
```

**Required permission:** `knowledge:write`

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (min 1) | No | Unique identifier (auto-generated if omitted) |
| `categoryId` | `string` (min 1) | Yes | Parent category ID |
| `question` | `string` (min 1) | Yes | Question text |
| `answer` | `string` (min 1) | Yes | Answer text |
| `order` | `integer` (min 0) | No (default: `0`) | Display order |

**Response** `201 Created` — [Item Response](#item-response)

## Get Item

```http
GET /api/projects/:projectId/knowledge/items/:id
```

**Required permission:** `knowledge:read`

**Response** `200 OK` — [Item Response](#item-response)

## List Items

```http
GET /api/projects/:projectId/knowledge/items
```

**Required permission:** `knowledge:read`

Supports [pagination & filtering](./pagination).

## Get Items by Category

```http
GET /api/projects/:projectId/knowledge/categories/:categoryId/items
```

**Required permission:** `knowledge:read`

Returns all items belonging to a specific category.

## Update Item

```http
PUT /api/projects/:projectId/knowledge/items/:id
Content-Type: application/json
```

**Required permission:** `knowledge:write`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |
| `categoryId` | `string` (min 1) | No | Move to different category |
| `question` | `string` (min 1) | No | Updated question |
| `answer` | `string` (min 1) | No | Updated answer |
| `order` | `integer` (min 0) | No | Updated order |

**Response** `200 OK` — [Item Response](#item-response)

## Delete Item

```http
DELETE /api/projects/:projectId/knowledge/items/:id
Content-Type: application/json
```

**Required permission:** `knowledge:delete`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `integer` (min 1) | Yes | Current version for optimistic locking |

**Response** `204 No Content`

---

## Category Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `name` | `string` | No | Category name |
| `promptTrigger` | `string` | No | Trigger phrase |
| `tags` | `string[]` | No | Knowledge tags |
| `order` | `integer` | No | Display order |
| `items` | `KnowledgeItem[]` | Yes | Nested items (when fetching single category) |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |

## Item Response

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Unique identifier |
| `projectId` | `string` | No | Parent project ID |
| `categoryId` | `string` | No | Parent category ID |
| `question` | `string` | No | Question text |
| `answer` | `string` | No | Answer text |
| `order` | `integer` | No | Display order |
| `version` | `integer` | No | Version number |
| `createdAt` | `string` | No | ISO 8601 creation timestamp |
| `updatedAt` | `string` | No | ISO 8601 last update timestamp |
