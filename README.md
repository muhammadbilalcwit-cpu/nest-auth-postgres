# NestJS Backend — Core Platform API

Production backend handling authentication, user/company/department management, real-time notifications, multi-device session management, chat message queuing, and activity audit logging.

## Tech Stack

- **NestJS 11** + TypeScript
- **PostgreSQL** (TypeORM — Database First)
- **MongoDB** (Mongoose — chat message/conversation schemas)
- **Redis** (online presence + Socket.IO Pub/Sub adapter)
- **RabbitMQ** (async chat message processing)
- **Socket.IO** (real-time WebSocket — chat + notifications)
- **Passport JWT** (httpOnly cookie auth)

## Quick Start

```bash
npm install

# Create .env (see below)

# Seed database (first time)
npm run seed

# Run
npm run start:dev       # development (watch mode)
npm run start:prod      # production
```

Runs on **port 3001**. Swagger docs at `http://localhost:3001/api`.

## Environment Variables

```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=auth_crud
REDIS_HOST=localhost
REDIS_PORT=6379
MONGODB_URI=mongodb://localhost:27017/chat_db
RABBITMQ_URL=amqp://guest:guest@localhost:5672
JWT_SECRET=your_jwt_secret
JWT_EXPIRATION=1d
```

## API Endpoints

### Auth (`/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login — sets httpOnly cookies (access 15m + refresh 30d) |
| POST | `/auth/refresh` | Refresh access token using refresh cookie |
| POST | `/auth/logout` | Clear cookies, invalidate session |

### Users (`/users`)

| Method | Path | Roles |
|--------|------|-------|
| GET | `/users/getAll` | super_admin, company_admin, manager |
| GET | `/users/getById/:id` | super_admin, company_admin, manager, user |
| GET | `/users/getByEmail/:email` | super_admin, company_admin, manager |
| POST | `/users/create` | super_admin, company_admin |
| PUT | `/users/update/:id` | super_admin, company_admin |
| DELETE | `/users/delete/:id` | super_admin, company_admin |
| POST | `/users/:id/assignRoles` | super_admin, company_admin |
| DELETE | `/users/:id/removeRoles/:slug` | super_admin, company_admin |
| PATCH | `/users/:id/status` | super_admin, company_admin |
| GET | `/users/profile` | Any authenticated |
| PUT | `/users/profile` | Any authenticated |
| POST | `/users/profile/avatar` | Any authenticated |
| DELETE | `/users/profile/avatar` | Any authenticated |

### Companies (`/companies`)

| Method | Path | Roles |
|--------|------|-------|
| GET | `/companies/getAll` | super_admin, company_admin |
| GET | `/companies/getById/:id` | super_admin |
| POST | `/companies/create` | super_admin |
| PUT | `/companies/update/:id` | super_admin |
| DELETE | `/companies/delete/:id` | super_admin |

### Departments (`/departments`)

| Method | Path | Roles |
|--------|------|-------|
| GET | `/departments/getAll` | super_admin, company_admin, manager |
| GET | `/departments/getByCompany/:companyId` | super_admin, company_admin, manager |
| POST | `/departments/create` | super_admin, company_admin |
| PUT | `/departments/update/:id` | super_admin, company_admin |
| DELETE | `/departments/delete/:id` | super_admin, company_admin |

### Chat (`/chat`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/chat/users` | Chatable users with online status |
| GET | `/chat/conversations` | All 1:1 conversations + unread counts |
| POST | `/chat/conversations/:userId` | Get/create conversation |
| GET | `/chat/conversations/:id/messages` | Paginated messages |
| POST | `/chat/conversations/:id/read` | Mark as read |
| DELETE | `/chat/conversations/:id` | Soft-delete |
| DELETE | `/chat/messages/:id` | Delete message |
| GET | `/chat/unread-count` | Unread count (direct + groups) |
| POST | `/chat/attachments` | Upload attachment |
| POST | `/chat/attachments/voice` | Upload voice note |
| POST | `/chat/groups` | Create group |
| GET | `/chat/groups` | All groups |
| PATCH | `/chat/groups/:id` | Update group |
| POST | `/chat/groups/:id/avatar` | Upload group avatar |
| POST | `/chat/groups/:id/members` | Add members |
| DELETE | `/chat/groups/:id/members/:memberId` | Remove member |
| POST | `/chat/groups/:id/leave` | Leave group |
| DELETE | `/chat/groups/:id` | Delete group |
| GET | `/chat/groups/:id/messages` | Group messages |
| POST | `/chat/groups/:id/read` | Mark group read |
| GET | `/chat/messages/:id/info` | Message delivery/read info |

### Notifications & Sessions (`/notifications`)

| Method | Path | Roles | Description |
|--------|------|-------|-------------|
| GET | `/notifications` | Any | Paginated notifications |
| GET | `/notifications/unread` | Any | Unread notifications |
| GET | `/notifications/unread/count` | Any | Unread count |
| PATCH | `/notifications/:id/read` | Any | Mark as read |
| PATCH | `/notifications/read/all` | Any | Mark all read |
| GET | `/notifications/admin/users-status` | company_admin | Online users with sessions |
| POST | `/notifications/admin/revoke-session/:userId` | company_admin | Revoke all user sessions |
| POST | `/notifications/admin/revoke-specific-session/:sessionId` | company_admin | Revoke one session |
| POST | `/notifications/admin/revoke-all-sessions` | company_admin | Revoke all company sessions |
| GET | `/notifications/admin/companies-status` | super_admin | All companies status |
| GET | `/notifications/admin/company/:id/users-status` | super_admin | Company users status |

### Activity Logs (`/activity-logs`)

| Method | Path | Roles |
|--------|------|-------|
| GET | `/activity-logs/getAll` | super_admin, company_admin |
| GET | `/activity-logs/user/:userId` | super_admin, company_admin |

### Roles (`/roles`)

| Method | Path | Roles |
|--------|------|-------|
| GET | `/roles/getAll` | super_admin, company_admin, manager |

## WebSocket Events (Socket.IO)

### Chat Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `chat:send` | Client -> Server | Send 1:1 message (queued to RabbitMQ) |
| `chat:receive` | Server -> Client | Message delivery |
| `chat:message_confirmed` | Server -> Client | tempId -> realId mapping |
| `chat:typing` | Bidirectional | Typing indicator |
| `chat:read` | Client -> Server | Mark messages read |
| `chat:status_updated` | Server -> Client | Delivered/read status |
| `chat:message_deleted` | Server -> Client | Deleted for everyone |
| `chat:group_send` | Client -> Server | Send group message |
| `chat:group_message` | Server -> Client | Group message delivery |
| `chat:group_typing` | Bidirectional | Group typing |
| `chat:group_messages_read` | Server -> Client | Read by member |
| `chat:group_message_delivered` | Server -> Client | Delivered to member |
| `chat:group_member_added` | Server -> Client | Added to group |
| `chat:group_member_removed` | Server -> Client | Removed from group |
| `chat:group_member_left` | Server -> Client | Member left |
| `chat:group_updated` | Server -> Client | Group info changed |
| `chat:group_system_message` | Server -> Client | System message |

### Notification Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `notification` | Server -> Client | New notification |
| `user_status_changed` | Server -> Client | Online/offline status |
| `session_revoked` | Server -> Client | Force logout |
| `user_disconnected_by_admin` | Server -> Client | Admin revoked sessions |

## Key Features

- **Multi-Device Sessions** — Track each login separately (browser, OS, IP), revoke individually or all
- **RabbitMQ Chat Queue** — Messages queued atomically before DB write, reliable delivery
- **Redis Socket.IO Adapter** — Scales WebSocket across multiple NestJS instances
- **Notification System** — Company-scoped notifications with read tracking
- **Online Status** — Redis-based presence with real-time broadcasting
- **Profile Pictures** — Upload/delete user avatars
- **User Activation** — Activate/deactivate users (deactivated users auto-rejected by JWT)
- **Activity Logging** — All CRUD operations and forbidden access logged
- **WhatsApp-Style Groups** — System messages, admin transfer, per-member read receipts
- **Force Disconnect** — Admin can revoke sessions and drop WebSocket connections

## Role-Based Access Control

```
super_admin          — Full system access (all companies)
  └── company_admin  — Manage own company's users/departments/sessions
       └── manager   — View/manage own department
            └── user — Access own profile only
```

## Database

### PostgreSQL Tables

`users` · `sessions` · `roles` · `user_roles` · `companies` · `departments` · `notifications` · `user_notifications` · `activity_logs`

### MongoDB Collections

`messages` · `conversations` (chat data stored separately from PostgreSQL)

## Related Projects

| Project | Purpose |
|---------|---------|
| [fastapi-chat](../fastapi-chat) | Chat microservice (shares PostgreSQL + JWT secret) |
| [nest-frontend](../nest-frontend) | Admin dashboard UI |
| [support-chat-widget](../support-chat-widget) | Embeddable customer chat widget |
