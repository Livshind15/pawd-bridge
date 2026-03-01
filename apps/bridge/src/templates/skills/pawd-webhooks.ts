/**
 * Default "pawd-webhooks" skill template.
 *
 * Auto-synced to every agent's workspace so agents can create, list,
 * update, delete, and test webhooks for themselves via the bridge API.
 */

export const PAWD_WEBHOOKS_SKILL_ID = 'pawd-webhooks-0.1.0';
export const PAWD_WEBHOOKS_VERSION = '0.1.0';

/**
 * Build the SKILL.md content for the pawd-webhooks skill.
 * @param bridgePort Port the bridge server listens on (default 3001)
 */
export function buildPawdWebhooksSkillMd(bridgePort: number): string {
  const base = `http://localhost:${bridgePort}`;
  return `---
name: PAWD Webhooks
description: Create, list, update, delete, and test inbound webhooks for yourself. Use when you want external services (GitHub, Stripe, WhatsApp, etc.) to trigger you automatically.
version: ${PAWD_WEBHOOKS_VERSION}
category: workspace
---

# PAWD Webhooks Skill

This skill teaches you how to manage your own inbound webhooks via the bridge
API. Webhooks let external services send you events so you can react
automatically — no polling required.

**Bridge base URL:** \`${base}\`

---

## When to Use This Skill

- You want an **external service** to trigger you (GitHub push, Stripe payment, WhatsApp message, etc.)
- You want to **create a public URL** that accepts POST payloads and wakes you up
- You want to **list** your current webhooks to see what's configured
- You want to **update, pause, or delete** a webhook
- You want to **test** a webhook dry-run to preview template rendering

---

## 1. API Endpoints

All endpoints accept and return JSON. Use \`curl\` or \`fetch\` via the Bash tool.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | \`${base}/api/webhooks\` | List all webhooks |
| POST   | \`${base}/api/webhooks\` | Create a webhook |
| GET    | \`${base}/api/webhooks/:id\` | Get webhook details |
| PUT    | \`${base}/api/webhooks/:id\` | Update a webhook |
| DELETE | \`${base}/api/webhooks/:id\` | Delete a webhook |
| POST   | \`${base}/api/webhooks/:id/test\` | Dry-run test (renders template, does NOT trigger agent) |
| POST   | \`${base}/api/webhooks/trigger/:webhookId\` | Public trigger URL (for external services) |

---

## 2. Webhook Schema

\`\`\`json
{
  "name": "GitHub Push Handler",
  "agentId": "<your agent ID>",
  "sessionTarget": "heartbeat",
  "secret": "optional-hmac-secret",
  "promptTemplate": "New push to {{repository.full_name}} by {{pusher.name}}: {{head_commit.message}}",
  "enabled": true
}
\`\`\`

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| \`name\` | string | yes | Human-readable name for the webhook |
| \`agentId\` | string | yes | Your agent ID — which agent gets triggered |
| \`sessionTarget\` | string | no | Where to deliver: \`"heartbeat"\`, \`"new"\`, or a specific conversation ID (default: \`"heartbeat"\`) |
| \`secret\` | string | no | HMAC-SHA256 signing secret for signature validation |
| \`promptTemplate\` | string | yes | Message template with \`{{field}}\` placeholders |
| \`enabled\` | boolean | no | Whether the webhook is active (default: \`true\`) |

### Session Targets

| Value | Behavior |
|-------|----------|
| \`"heartbeat"\` | Delivers to the agent's heartbeat session (default, recommended) |
| \`"new"\` | Creates a brand-new conversation for each trigger |
| \`"conv_abc123"\` | Delivers to a specific existing conversation |

---

## 3. Template Placeholders

The \`promptTemplate\` field supports \`{{field}}\` syntax to inject values from the incoming payload.

- **Top-level:** \`{{field}}\` — replaced with the value of \`payload.field\`
- **Nested:** \`{{nested.field}}\` — replaced with the value of \`payload.nested.field\`
- **Unknown placeholders** are left as-is (not removed)

### Example

Template:
\`\`\`
New commit to {{repository.full_name}} by {{pusher.name}}: {{head_commit.message}}
\`\`\`

Incoming payload:
\`\`\`json
{
  "repository": { "full_name": "acme/app" },
  "pusher": { "name": "alice" },
  "head_commit": { "message": "fix: resolve login bug" }
}
\`\`\`

Rendered prompt:
\`\`\`
New commit to acme/app by alice: fix: resolve login bug
\`\`\`

---

## 4. Creating a Webhook

\`\`\`bash
curl -s -X POST ${base}/api/webhooks \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "GitHub Push Handler",
    "agentId": "<YOUR_AGENT_ID>",
    "sessionTarget": "heartbeat",
    "promptTemplate": "GitHub push to {{repository.full_name}} by {{pusher.name}}: {{head_commit.message}}",
    "enabled": true
  }'
\`\`\`

The response includes the webhook \`id\` and the public trigger URL:
\`${base}/api/webhooks/trigger/<WEBHOOK_ID>\`

---

## 5. Listing Your Webhooks

\`\`\`bash
curl -s ${base}/api/webhooks | jq '.webhooks[] | select(.agentId == "<YOUR_AGENT_ID>")'
\`\`\`

---

## 6. Getting Webhook Details

\`\`\`bash
curl -s ${base}/api/webhooks/<WEBHOOK_ID>
\`\`\`

---

## 7. Updating a Webhook

\`\`\`bash
# Pause a webhook
curl -s -X PUT ${base}/api/webhooks/<WEBHOOK_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "enabled": false }'

# Change the prompt template
curl -s -X PUT ${base}/api/webhooks/<WEBHOOK_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "promptTemplate": "Updated: {{event}} happened on {{repo}}" }'

# Add an HMAC secret
curl -s -X PUT ${base}/api/webhooks/<WEBHOOK_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "secret": "my-signing-secret-123" }'
\`\`\`

---

## 8. Deleting a Webhook

\`\`\`bash
curl -s -X DELETE ${base}/api/webhooks/<WEBHOOK_ID>
\`\`\`

---

## 9. Testing a Webhook (Dry Run)

Test renders your prompt template with a sample payload **without** triggering any agent.

\`\`\`bash
curl -s -X POST ${base}/api/webhooks/<WEBHOOK_ID>/test \\
  -H 'Content-Type: application/json' \\
  -d '{
    "repository": { "full_name": "acme/app" },
    "pusher": { "name": "alice" },
    "head_commit": { "message": "fix: login bug" }
  }'
\`\`\`

Response:
\`\`\`json
{
  "ok": true,
  "renderedPrompt": "GitHub push to acme/app by alice: fix: login bug",
  "agentId": "<AGENT_ID>",
  "sessionTarget": "heartbeat",
  "note": "Dry-run only — no agent was triggered."
}
\`\`\`

---

## 10. HMAC Signature Validation

For security, you can set a \`secret\` on your webhook. When a secret is set,
incoming requests must include a valid \`X-Webhook-Signature\` header.

### How it works

1. The sender computes \`HMAC-SHA256(secret, rawRequestBody)\`
2. The sender sends the hex digest in the \`X-Webhook-Signature\` header as \`sha256=<hex>\`
3. The bridge validates the signature using timing-safe comparison
4. Requests with invalid signatures are rejected with 401

### Setting a secret

\`\`\`bash
curl -s -X PUT ${base}/api/webhooks/<WEBHOOK_ID> \\
  -H 'Content-Type: application/json' \\
  -d '{ "secret": "whsec_my-secret-key" }'
\`\`\`

### Sending a signed request (example)

\`\`\`bash
BODY='{"event":"push","repo":"acme/app"}'
SECRET="whsec_my-secret-key"
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

curl -s -X POST ${base}/api/webhooks/trigger/<WEBHOOK_ID> \\
  -H 'Content-Type: application/json' \\
  -H "X-Webhook-Signature: sha256=$SIG" \\
  -d "$BODY"
\`\`\`

---

## 11. Common Patterns

### GitHub webhook (push events)

\`\`\`bash
curl -s -X POST ${base}/api/webhooks \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "GitHub Push",
    "agentId": "<YOUR_AGENT_ID>",
    "sessionTarget": "heartbeat",
    "promptTemplate": "GitHub push to {{repository.full_name}} on branch {{ref}} by {{pusher.name}}.\\nCommit: {{head_commit.message}}\\nURL: {{head_commit.url}}\\n\\nPlease review the changes and take any necessary action.",
    "enabled": true
  }'
\`\`\`

Then add the trigger URL as a webhook in your GitHub repo settings.

### Stripe payment webhook

\`\`\`bash
curl -s -X POST ${base}/api/webhooks \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "Stripe Payment",
    "agentId": "<YOUR_AGENT_ID>",
    "sessionTarget": "heartbeat",
    "secret": "whsec_stripe-signing-secret",
    "promptTemplate": "Stripe event {{type}}: {{data.object.id}} — amount {{data.object.amount}} {{data.object.currency}}.\\nCustomer: {{data.object.customer}}\\n\\nProcess this payment event.",
    "enabled": true
  }'
\`\`\`

### WhatsApp-style message handler

\`\`\`bash
curl -s -X POST ${base}/api/webhooks \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "WhatsApp Messages",
    "agentId": "<YOUR_AGENT_ID>",
    "sessionTarget": "new",
    "promptTemplate": "Incoming WhatsApp message from {{from}} ({{profileName}}):\\n\\n{{body}}\\n\\nPlease compose a helpful reply.",
    "enabled": true
  }'
\`\`\`

### Generic alert / monitoring webhook

\`\`\`bash
curl -s -X POST ${base}/api/webhooks \\
  -H 'Content-Type: application/json' \\
  -d '{
    "name": "Alert Monitor",
    "agentId": "<YOUR_AGENT_ID>",
    "sessionTarget": "heartbeat",
    "promptTemplate": "ALERT [{{severity}}]: {{title}}\\nService: {{service}}\\nDetails: {{message}}\\n\\nInvestigate and respond.",
    "enabled": true
  }'
\`\`\`

---

## Quick Reference

| Action | Command |
|--------|---------|
| List all webhooks | \`curl -s ${base}/api/webhooks\` |
| Create webhook | \`curl -s -X POST ${base}/api/webhooks -H 'Content-Type: application/json' -d '{...}'\` |
| Get webhook | \`curl -s ${base}/api/webhooks/<ID>\` |
| Update webhook | \`curl -s -X PUT ${base}/api/webhooks/<ID> -H 'Content-Type: application/json' -d '{...}'\` |
| Delete webhook | \`curl -s -X DELETE ${base}/api/webhooks/<ID>\` |
| Test (dry run) | \`curl -s -X POST ${base}/api/webhooks/<ID>/test -H 'Content-Type: application/json' -d '{...}'\` |
| Trigger URL | \`POST ${base}/api/webhooks/trigger/<ID>\` (give this URL to external services) |
| Pause webhook | Update with \`{ "enabled": false }\` |
| Resume webhook | Update with \`{ "enabled": true }\` |
| Add HMAC secret | Update with \`{ "secret": "your-secret" }\` |
`;
}

/**
 * Build the _meta.json content for the pawd-webhooks skill.
 */
export function buildPawdWebhooksMetaJson(): string {
  return JSON.stringify(
    {
      ownerId: 'pawd-system',
      slug: 'pawd-webhooks',
      version: PAWD_WEBHOOKS_VERSION,
      publishedAt: Date.now(),
    },
    null,
    2
  ) + '\n';
}
