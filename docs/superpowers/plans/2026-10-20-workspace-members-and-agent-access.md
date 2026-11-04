# Workspace Members and Agent Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workspace administrators manage members and assign workspace users to restricted Agents.

**Architecture:** Add workspace member service/API/UI backed by `workspace_members`. Extend Agent draft updates with `memberUserIds`, replace `agent_access_grants` transactionally, and expose a member picker on the basic-information page when visibility is restricted.

**Tech Stack:** TanStack Router/Start, React, Drizzle SQLite, Zod, Vitest, Testing Library.

## Global Constraints

- Workspace administrators and platform administrators can manage members and Agent access.
- Normal editors can edit Agent content but cannot grant restricted access.
- Adding a previously unknown username creates a local `users` row and workspace membership.
- Removing the final `workspace_admin` is forbidden.
- `restricted` Agents remain visible to admins, editors, the creator, and explicitly granted workspace users.
- All new UI copy is Chinese.
- Preserve `fde / 数字人FDE组` initialization behavior.

---

### Task 1: Workspace Member Service and API

**Files:**

- Create: `src/server/platform/workspace-members.server.ts`
- Create: `src/server/platform/workspace-members.server.test.ts`
- Create: `src/server/http/workspace-member-http.server.ts`
- Create: `src/server/http/workspace-member-http.server.test.ts`
- Create: `src/routes/api/workspaces/$workspaceId/members.ts`
- Create: `src/routes/api/workspaces/$workspaceId/members/$userId.ts`
- Modify: `src/lib/api/platform-client.ts`

**Interfaces:**

- Produces: `listWorkspaceMembers(db, principal, workspaceId): Promise<WorkspaceMemberRecord[]>`
- Produces: `saveWorkspaceMember(db, principal, workspaceId, input): Promise<WorkspaceMemberRecord>`
- Produces: `removeWorkspaceMember(db, principal, workspaceId, userId): Promise<void>`
- Produces: `GET/POST /api/workspaces/:workspaceId/members`
- Produces: `DELETE /api/workspaces/:workspaceId/members/:userId`

- [ ] **Step 1: Write service tests**

Test admin-only listing, create-by-username, role updates, non-admin rejection, and last-admin removal rejection.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/server/platform/workspace-members.server.test.ts
```

- [ ] **Step 3: Implement the service and HTTP handlers**

Use `requireWorkspaceAccess` with `workspace_admin` and `platform_admin`. Create unknown users with `name = username`, then upsert the workspace membership role.

- [ ] **Step 4: Test handlers and routes**

```bash
npm test -- src/server/platform/workspace-members.server.test.ts src/server/http/workspace-member-http.server.test.ts
npm run generate-routes
```

- [ ] **Step 5: Commit**

```bash
git add src/server/platform/workspace-members.server.ts src/server/platform/workspace-members.server.test.ts src/server/http/workspace-member-http.server.ts src/server/http/workspace-member-http.server.test.ts 'src/routes/api/workspaces/$workspaceId/members.ts' 'src/routes/api/workspaces/$workspaceId/members/$userId.ts' src/lib/api/platform-client.ts src/routeTree.gen.ts
git commit -m "feat: add workspace member management API"
```

---

### Task 2: Workspace Member Management Page

**Files:**

- Create: `src/components/workspace/workspace-members.tsx`
- Create: `src/components/workspace/workspace-members.test.tsx`
- Create: `src/routes/w.$workspaceSlug.members.tsx`
- Modify: `src/components/home/agent-home-dashboard.tsx`
- Modify: `src/components/home/agent-home-dashboard.test.tsx`
- Modify: `src/routeTree.gen.ts`

**Interfaces:**

- Consumes: workspace member API client functions
- Produces: `/w/$workspaceSlug/members`

- [ ] **Step 1: Write failing component tests**

Verify member list rendering, adding a username/role, role saving, and removal confirmation.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/components/workspace/workspace-members.test.tsx
```

- [ ] **Step 3: Implement the page**

Use cards/rows with username, role selector, save/remove actions, and a small add-member form. Add an admin-only “成员” link on the home page beside “供应商”.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- src/components/workspace/workspace-members.test.tsx src/components/home/agent-home-dashboard.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/workspace-members.tsx src/components/workspace/workspace-members.test.tsx 'src/routes/w.$workspaceSlug.members.tsx' src/components/home/agent-home-dashboard.tsx src/components/home/agent-home-dashboard.test.tsx src/routeTree.gen.ts
git commit -m "feat: add workspace member management page"
```

---

### Task 3: Restricted Agent Grant API

**Files:**

- Modify: `src/server/platform/agent-version.server.ts`
- Modify: `src/server/platform/agent-version.server.test.ts`
- Modify: `src/lib/api/platform-client.ts`
- Create: `src/routes/api/agents/$agentId/access.ts`
- Modify: `src/server/http/agent-http.server.ts`
- Modify: `src/server/http/agent-http.server.test.ts`

**Interfaces:**

- Extends draft input with `memberUserIds?: string[]`
- Produces: `GET /api/agents/:agentId/access?workspaceId=...`
- Produces: selected grants as `{ userIds: string[] }`

- [ ] **Step 1: Write failing service tests**

Test replacing grants, validating workspace membership, clearing grants, and rejecting grant changes by an editor.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- src/server/platform/agent-version.server.test.ts src/server/http/agent-http.server.test.ts
```

- [ ] **Step 3: Implement grant replacement**

In `updateAgentDraft`, require admin for `memberUserIds`, validate all users belong to the workspace, delete old grants, and insert the new set in the same transaction.

- [ ] **Step 4: Implement access read endpoint and test**

```bash
npm test -- src/server/platform/agent-version.server.test.ts src/server/http/agent-http.server.test.ts
npm run generate-routes
```

- [ ] **Step 5: Commit**

```bash
git add src/server/platform/agent-version.server.ts src/server/platform/agent-version.server.test.ts src/server/http/agent-http.server.ts src/server/http/agent-http.server.test.ts src/lib/api/platform-client.ts 'src/routes/api/agents/$agentId/access.ts' src/routeTree.gen.ts
git commit -m "feat: add restricted Agent access grants"
```

---

### Task 4: Restricted Agent Member Picker

**Files:**

- Modify: `src/components/agents/agent-basic-form.tsx`
- Modify: `src/components/agents/agent-basic-form.test.tsx`
- Modify: `src/routes/w.$workspaceSlug.agents.$agentId.basic.tsx`
- Modify: `src/lib/api/platform-client.ts`

**Interfaces:**

- Consumes: workspace members client and Agent access client
- Produces: member checklist shown only for `visibility = restricted`

- [ ] **Step 1: Write failing form test**

Mock members and access APIs, choose “指定成员”, select a user, save, and verify `memberUserIds` is included.

- [ ] **Step 2: Run test and verify RED**

```bash
npm test -- src/components/agents/agent-basic-form.test.tsx -t "restricted"
```

- [ ] **Step 3: Implement the picker**

Workspace admins load workspace members and current grants. Show selectable `user`-role members when restricted. Editors cannot change restricted access.

- [ ] **Step 4: Run full gates**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 5: Visual verification**

Verify `/w/fde/members` and the Agent basic edit page in the Codex browser.

- [ ] **Step 6: Commit**

```bash
git add src/components/agents/agent-basic-form.tsx src/components/agents/agent-basic-form.test.tsx 'src/routes/w.$workspaceSlug.agents.$agentId.basic.tsx' src/lib/api/platform-client.ts
git commit -m "feat: choose members for restricted Agents"
```
