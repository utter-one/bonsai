# Secrets

Provides read-only listing, value reveal (emergency use), and deletion of stored secrets. Secrets are created implicitly when provider configs or environment passwords are written.

**Tag:** `Secrets`

For background on how secrets management works, see the [Secrets Management guide](/guide/secrets).

## List Secrets

```http
GET /api/secrets
```

**Required permission:** `secrets:read`

Returns all stored secret references. Secret values are never included. Also reports **orphans** — secrets that exist in the store but are no longer referenced by any provider config or environment.

**Response** `200 OK`

| Field | Type | Description |
|---|---|---|
| `items` | `SecretResponse[]` | All stored secret entries |
| `orphans` | `string[]` | Secret ref strings with no live reference (<code v-pre>@sec:local:sec_xxxx</code> format) |

**SecretResponse**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Secret identifier (e.g. `sec_xxxx`) |
| `ref` | `string` | Full reference string in <code v-pre>@sec:local:id</code> format |
| `createdAt` | `string` | ISO 8601 creation timestamp |
| `updatedAt` | `string` | ISO 8601 last-updated timestamp |

**Example response:**

```json
{
  "items": [
    {
      "id": "sec_a1b2c3d4e5f6",
      "ref": "@sec:local:sec_a1b2c3d4e5f6",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "orphans": []
}
```

## Reveal Secret Value

```http
GET /api/secrets/:id/value
```

**Required permission:** `secrets:reveal` — **super admin only**

Returns the decrypted plaintext value of a secret. Use only in emergency situations such as recovering a lost API key.

**Path Parameters**

| Parameter | Description |
|---|---|
| `id` | Secret ID (the `id` segment of the <code v-pre>@sec:local:id</code> reference) |

**Response** `200 OK`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Secret identifier |
| `value` | `string` | Decrypted plaintext secret value |

**Errors:** `403` Insufficient permissions | `404` Secret not found

## Delete Secret

```http
DELETE /api/secrets/:id
```

**Required permission:** `secrets:delete`

Deletes a secret. Returns `409 Conflict` if the secret is still actively referenced by a provider config or environment — remove or update the referencing entity first.

**Path Parameters**

| Parameter | Description |
|---|---|
| `id` | Secret ID (the `id` segment of the <code v-pre>@sec:local:id</code> reference) |

**Response** `204 No Content`

**Errors:** `404` Secret not found | `409` Secret is still in use
