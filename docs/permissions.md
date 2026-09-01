Permissions should be defined separately from roles.

Organization permissions

organizations:read
organizations:update
organizations:manage_users
organizations:manage_settings

User permissions

users:read
users:create
users:update
users:delete

Document permissions

documents:read
documents:create
documents:update
documents:delete

Credential permissions

credentials:read
credentials:verify
credentials:manage

Compliance permissions

compliance:read
compliance:run
compliance:report

Audit permissions

audit_logs:read

Role → Permission Matrix

| Permission | Admin | Compliance Officer | HR | Clinician |
| :--- | :--- | :--- | :--- | :--- |
| organizations:read | ✓ | ✓ | ✓ | — |
| organizations:update | ✓ | ✓ | — | — |
| organizations:manage_users | ✓ | ✓ | — | — |
| users:read | ✓ | ✓ | ✓ | ✓\* |
| users:create | ✓ | ✓ | ✓ | — |
| users:update | ✓ | ✓ | ✓ | — |
| users:delete | ✓ | ✓ | — | — |
| documents:read | ✓ | ✓ | ✓ | ✓\* |
| documents:create | ✓ | ✓ | ✓ | — |
| documents:update | ✓ | ✓ | ✓ | — |
| documents:delete | ✓ | ✓ | — | — |
| credentials:read | ✓ | ✓ | ✓ | ✓\* |
| credentials:verify | ✓ | ✓ | ✓ | — |
| credentials:manage | ✓ | ✓ | ✓ | — |
| compliance:read | ✓ | ✓ | ✓ | ✓\* |
| compliance:run | ✓ | ✓ | ✓ | — |
| compliance:report | ✓ | ✓ | — | — |
| audit_logs:read | ✓ | ✓ | — | — |

- = resource-scoped access only.
