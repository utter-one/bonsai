# Pagination & Filtering

All list endpoints accept a common set of query parameters for pagination, sorting, full-text search, and dynamic filtering.

## Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | `integer` (min 0) | `0` | Starting index for pagination |
| `limit` | `integer` (positive, max 100) | `100` | Maximum number of items to return. Omitted or `null` values fall back to the default |
| `textSearch` | `string` | `null` | Full-text search query string |
| `orderBy` | `string \| string[]` | `null` | Field(s) to sort by. Prefix with `-` for descending |
| `groupBy` | `string \| string[]` | `null` | Field(s) to group results by |
| `filters` | `object` | `null` | Dynamic field filters (see below) |

## Sorting

Use the `orderBy` parameter to sort results. Prefix a field name with `-` for descending order.

```http
GET /api/projects?orderBy=name
GET /api/projects?orderBy=-createdAt
GET /api/projects?orderBy=name&orderBy=-createdAt
```

## Filtering

The `filters` parameter accepts dynamic key-value pairs where keys are field names.

### Direct value filter

```http
GET /api/projects?filters[status]=active
```

### Array filter (IN)

```http
GET /api/projects?filters[status][]=active&filters[status][]=draft
```

### Operator filter

Supported operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `nin`, `between`

```http
GET /api/audit-logs?filters[createdAt][op]=gte&filters[createdAt][value]=2024-01-01
```

## Response Format

All list endpoints return a paginated response:

```json
{
  "items": [...],
  "total": 42,
  "offset": 0,
  "limit": 20
}
```

| Field | Type | Description |
|-------|------|-------------|
| `items` | `array` | Array of matching entities |
| `total` | `integer` | Total number of entities matching the query |
| `offset` | `integer` | Starting index used |
| `limit` | `integer` | Maximum items returned in the current page |
