# Secrets Management

Bonsai Backend includes a built-in secrets manager that automatically encrypts sensitive credentials before storing them in the database. Provider API keys, access tokens, and environment passwords are never persisted in plaintext.

## How It Works

When you create or update a provider with a sensitive field (such as `apiKey`), the backend:

1. Encrypts the plaintext value using AES-256-GCM with a master key derived from the `MASTER_ENCRYPTION_KEY` environment variable
2. Stores the ciphertext, IV, and authentication tag in a dedicated `secrets` table
3. Replaces the plaintext value in the provider config with an opaque reference string — <code v-pre>@sec:local:sec_xxxx</code>

At runtime, when a provider client is instantiated to handle a conversation, the reference is resolved and the plaintext value is decrypted in memory. Secrets never leave the server.

## Setting Up

### 1. Generate a master key

The master key must be a 32-byte random value encoded as a 64-character hex string. Generate one with:

```bash
openssl rand -hex 32
```

### 2. Set the environment variable

Add the generated key to your environment configuration:

```env
MASTER_ENCRYPTION_KEY=<64-char hex string>
```

In Docker deployments, set this in your `docker-compose.yml` or `.env` file alongside `JWT_SECRET`.

::: warning
The `MASTER_ENCRYPTION_KEY` is required for the server to start. Without it, any attempt to store or resolve secrets will fail with a startup error.
:::

::: danger
Keep the master key secret and backed up. If it is lost, all stored secrets become unrecoverable and every provider must be reconfigured. Never commit the key to version control.
:::

### 3. Migrate existing plaintext credentials (optional)

If you have an existing deployment with provider credentials stored in plaintext, run the migration script to encrypt them in-place:

```bash
npm run secrets:migrate
```

This scans all provider configs and environment passwords for any remaining plaintext values and encrypts them using the current `MASTER_ENCRYPTION_KEY`. The script is idempotent — it is safe to run repeatedly and skips values that are already encrypted.

### 4. Start the server

On startup, the server verifies that `MASTER_ENCRYPTION_KEY` is configured and the secrets subsystem is ready.

## Secret References

Encrypted secrets are identified by an opaque reference string in the format:

```
@sec:<manager>:<id>
```

For example: `@sec:local:sec_a1b2c3d4e5f6`. The `local` segment identifies the secrets manager backend (currently only the database-backed local manager is available). The `id` segment is a unique identifier generated when the secret is stored.

These references appear in provider config objects returned by the API in place of the original plaintext values:

```json
{
  "config": {
    "apiKey": "@sec:local:sec_a1b2c3d4e5f6",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```

## Secretized Fields

The following provider config fields are automatically encrypted when a provider is created or updated:

| Field | Typical use |
|---|---|
| `apiKey` | LLM, TTS, ASR provider API keys |
| `subscriptionKey` | Azure Cognitive Services |
| `accountKey` | Azure storage accounts |
| `secretAccessKey` | AWS credentials |
| `authToken` | Generic bearer tokens |
| `accessToken` | OAuth access tokens |
| `appSecret` | WhatsApp / Meta app secret |
| `verifyToken` | WhatsApp webhook verify token |
| `keyFileJson` | Google Cloud service account JSON |
| `accountSid` | Twilio account SID |

In addition, the `password` field of [Environments](/guide/environments) is stored as a secret reference.

## Managing Secrets

Secrets are managed indirectly — they are created and deleted automatically when provider configs or environment passwords are written. Direct management is available through the Secrets API for administrative purposes.

### Listing secrets

`GET /api/secrets` returns all stored secret references and flags any **orphans** — secrets that exist in the store but are no longer referenced by any provider config or environment. Orphans can safely be deleted.

**Required permission:** `secrets:read`

### Deleting a secret

`DELETE /api/secrets/:id` removes a secret. The request is blocked with `409 Conflict` if the secret is still actively referenced.

**Required permission:** `secrets:delete`

### Revealing a secret value

`GET /api/secrets/:id/value` returns the decrypted plaintext value of a secret. This endpoint is restricted to **super admin** operators only and should be used exclusively in emergency situations (e.g., recovering a lost API key).

**Required permission:** `secrets:reveal` (super admin only)

See the [Secrets API reference](/api/secrets) for full endpoint documentation.

## Rotating the Master Key

There is no built-in automated key rotation. To rotate the master key:

1. Use `GET /api/secrets/:id/value` to read each stored secret value
2. Stop the server
3. Replace `MASTER_ENCRYPTION_KEY` with the new key
4. Re-create each provider (or update provider configs) so that the new key is used to encrypt fresh secrets
5. Delete the old secret entries once the new ones are in place
6. Restart the server

## Security Considerations

- The master key is the single point of protection for all stored secrets. Secure it with the same care as a private key or database root password.
- Secret values are never included in API list responses or audit log records.
- AES-256-GCM provides both confidentiality and integrity — tampered ciphertext will fail authentication and raise an error rather than silently returning garbage.
- Each secret uses a unique random 12-byte IV, so encrypting the same value twice produces different ciphertext.
