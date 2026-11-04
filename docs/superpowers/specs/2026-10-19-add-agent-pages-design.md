# Add Agent Multi-Page Workspace Design

Date: 2026-10-19

Status: Design approved, pending written-spec review

## 1. Summary

Create a multi-page Agent editing workspace with persistent left navigation. The entry point creates a durable draft with minimal information, then redirects to independently editable configuration pages for basic details, prompt and model, tools, Skills, channels, and publishing.

This is not a wizard. Pages are not sequentially gated, and users may enter them in any order. Each page saves its own section.

The requested `ui-ux-pro-max-skill` is not installed. The implementation uses the available `web-design-engineer` skill and follows the product's existing sea-glass visual language.

## 2. Goals

- Let a workspace editor create an Agent without a long single form.
- Persist the Agent draft immediately after minimal creation.
- Allow each configuration section to be edited through its own route.
- Preserve Agent version semantics and workspace authorization.
- Show configuration completeness before publishing.
- Provide polished desktop and mobile layouts consistent with the existing TanStack Start application.

## 3. Non-Goals

- Building a linear wizard.
- Editing arbitrary capability code from the browser.
- Exposing unencrypted channel or model credentials.
- Supporting unrestricted tenant plugins.
- Allowing a draft to publish while required sections are invalid.

## 4. Information Architecture

### 4.1 Entry route

`/w/:workspaceSlug/agents/new` collects only:

- Agent name
- Description
- Visibility: workspace or restricted

Submitting creates the database Agent and first draft AgentVersion, then redirects to:

```text
/w/:workspaceSlug/agents/:agentId/basic
```

If creation fails, the form remains populated and shows an inline error.

### 4.2 Editing routes

```text
/w/:workspaceSlug/agents/:agentId/basic
/w/:workspaceSlug/agents/:agentId/prompt
/w/:workspaceSlug/agents/:agentId/tools
/w/:workspaceSlug/agents/:agentId/skills
/w/:workspaceSlug/agents/:agentId/channels
/w/:workspaceSlug/agents/:agentId/publish
```

Routes are independently addressable and do not require previous pages to be completed.

Page responsibilities:

- `basic`: Agent name, description, visibility, owner metadata.
- `prompt`: prompt instructions, model provider/model, thinking level, response policy.
- `tools`: select and configure versioned tools.
- `skills`: select versioned Skills.
- `channels`: configure Web and InfoFlow response behavior and credentials.
- `publish`: validation summary, version summary, publish action, published-version result.

## 5. Desktop Layout

At 1024px and wider, use three regions:

```text
┌───────────────┬────────────────────────────┬──────────────────┐
│ Agent rail    │ Configuration form         │ Status rail       │
│ 232px         │ minmax(0, 1fr)             │ 270px             │
└───────────────┴────────────────────────────┴──────────────────┘
```

### 5.1 Agent rail

- Soft glass surface with the Agent monogram.
- Agent name, draft badge, and workspace name.
- Compact model summary.
- Vertical navigation with icons and section completion indicators.
- Navigation state uses the existing `lagoon` accent and a slim active marker.
- The rail remains sticky below the top header.

### 5.2 Configuration form

- Maximum readable content width of 820px.
- One page title, one short explanatory sentence, then form content.
- Primary action is repeated only at the bottom of the form.
- Cards are used for selectable tools, Skills, and channels, not for every input group.
- Inputs retain the existing shadcn styling and spacing.

### 5.3 Status rail

Shows:

- Draft/published status.
- Model and thinking level.
- Number of selected tools and Skills.
- Enabled channels and connection health.
- Publication readiness tasks.
- Save draft button.
- Publish button.

Publishing is enabled only on the publish page after all blocking checks pass.

## 6. Mobile Layout

Below 768px:

- Hide the desktop Agent rail and status rail.
- Show Agent name and draft status in a compact page header.
- Convert section navigation to a horizontally scrollable tab row.
- Show a sticky bottom action bar containing Save draft and Publish.
- Stack all form grids into one column.
- Publication checks appear after the current page content.

## 7. Visual System

### 7.1 Color

Use existing project tokens:

- Ink: `#173a40`
- Muted ink: `#416166`
- Lagoon: `#4fb8b2`
- Lagoon deep: `#328f97`
- Palm: `#2f6a4a`
- Sand: `#e7f0e8`
- Foam: `#f3faf5`

Use at most one status color per state:

- Success: palm
- Informational: lagoon deep
- Warning: warm amber
- Error: existing destructive color

### 7.2 Typography

- Display and Agent name: Fraunces.
- Body and controls: Manrope.
- Model IDs, Agent IDs, counts, and technical metadata: system monospace.
- Page title size: 30–34px desktop, 26px mobile.
- Form body: 14px.
- Supporting copy: 12–13px.

### 7.3 Spacing and shape

- Base unit: 4px.
- Main vertical rhythm: 8px multiples.
- Inputs: 40px height.
- Cards: 14–18px radius.
- Side rails: 18px radius.
- Page padding: 32px desktop, 16px mobile.

### 7.4 Elevation

Use the existing soft glass hierarchy:

- Level 0: page background.
- Level 1: form and side rail surfaces.
- Level 2: selected capability cards and sticky actions.
- No heavy drop shadows.

### 7.5 Motion

- Page entry: 220ms opacity + 8px rise.
- Navigation and button hover: 160–180ms.
- Selection and status transitions: 180ms.
- Respect `prefers-reduced-motion`; disable transform animations when set.

## 8. Component Structure

```text
src/components/agents/
  agent-workspace-layout.tsx
  agent-rail.tsx
  agent-status-rail.tsx
  agent-page-header.tsx
  agent-section-card.tsx
  agent-create-form.tsx
  capability-picker.tsx
  infoflow-channel-form.tsx
  publish-checklist.tsx
```

Route files:

```text
src/routes/w.$workspaceSlug.agents.new.tsx
src/routes/w.$workspaceSlug.agents.$agentId.basic.tsx
src/routes/w.$workspaceSlug.agents.$agentId.prompt.tsx
src/routes/w.$workspaceSlug.agents.$agentId.tools.tsx
src/routes/w.$workspaceSlug.agents.$agentId.skills.tsx
src/routes/w.$workspaceSlug.agents.$agentId.channels.tsx
src/routes/w.$workspaceSlug.agents.$agentId.publish.tsx
src/routes/w.$workspaceSlug.agents.$agentId.tsx
```

`agents.$agentId.tsx` is the shared layout route. It loads identity, workspace, Agent, and draft version data once, then renders nested pages.

## 9. Page States

Every editing page supports:

- Loading skeleton for shell and form.
- Loaded and editable.
- Saving.
- Saved with timestamp.
- Validation error.
- Request error with retry.
- Forbidden.

Unsaved changes:

- Show an `unsaved` badge in the page header.
- Warn before navigation away when the form is dirty.
- Successful save clears the warning.

## 10. Creation Page Content

Fields:

- Name: required, 1–120 characters.
- Description: optional, 0–500 characters.
- Visibility: two selectable cards, workspace or restricted.

Actions:

- Primary: Create draft.
- Secondary: Cancel, returning to Agent list.

Right-side creation hint:

- What happens after creation.
- Draft is private until published.
- Channels and capabilities can be configured later.

## 11. Basic Page Content

- Name.
- Description.
- Visibility.
- Read-only Agent ID and creator.
- Read-only created and updated timestamps.
- Save draft.

## 12. Prompt and Model Page

- Prompt textarea with character count.
- Model provider selector.
- Model ID selector or text field, depending on provider data.
- Thinking level segmented control: off, minimal, low, medium, high.
- Response policy preview:
  - allowed text/Markdown,
  - attachments,
  - maximum text length.
- Save draft.

## 13. Tools Page

- Search field.
- Filter chips for source type: all, built-in, HTTP, OpenAPI, MCP.
- Capability cards show name, description, source badge, version, and enable toggle.
- Selecting a card opens an inline configuration panel.
- Validation errors appear inside the selected card.
- Save draft.

If capability catalog data is not yet available from the backend, this page renders a clear empty state and does not fabricate tools.

## 14. Skills Page

- Search and source filters.
- Skill cards show name, description, version, and prompt contribution.
- Multi-select card grid.
- Selected order is visible and reorderable.
- Save draft.

If no Skills exist, render a clear empty state with a link to the future capability catalog.

## 15. Channels Page

Channel cards:

- Web: enabled by default; output profile summary.
- InfoFlow: disabled by default; expandable configuration.

InfoFlow fields:

- Agent ID.
- App Key.
- App Secret.
- Trigger mode displayed as read-only `group_mention`.
- Connection state.

Secret behavior:

- Existing secret displays as masked text.
- Leaving secret blank during edit preserves the previous secret.
- The API never returns plaintext.

Save draft does not establish a live connection. A separate Test connection action validates credentials and reports status.

## 16. Publish Page

Checks:

- Name present.
- Prompt present.
- Model and thinking level valid.
- At least one usable channel.
- InfoFlow credentials complete when enabled.
- Capability versions resolve.
- Required capability configuration valid.

Summary:

- Version number.
- Prompt excerpt.
- Model.
- Tool count.
- Skill count.
- Channels.

Actions:

- Publish creates an immutable published version.
- On success, replace the page with a confirmation panel showing version number and published time.
- Publishing errors remain inline and preserve draft state.

## 17. API Dependencies

Existing APIs support minimal creation and Agent draft updates.

This UI requires additional APIs before it can be fully functional:

- Agent list and detail reads with descriptions.
- Capability catalog list.
- Agent draft capability bindings.
- Skill catalog list and bindings.
- Agent channel read/update.
- Encrypted InfoFlow credential update and connection test.
- Publication readiness query and publish.

The v0 visual checkpoint may use static empty states, but the final implementation must connect every action to an API and database mutation.

## 18. Accessibility

- Every input has an associated label and error description.
- Navigation uses real links.
- Selected cards expose `aria-pressed` or checkbox semantics.
- Focus rings use the existing token and remain visible against glass surfaces.
- Status changes use `aria-live="polite"`.
- Color is never the only completion indicator.
- Mobile tabs support keyboard navigation.
- Motion respects reduced-motion settings.

## 19. Verification

- Desktop at 1440×900 and 1024×768.
- Mobile at 390×844.
- Light and dark themes.
- Long Agent name and long prompt.
- Dirty, saving, saved, error, forbidden, and loading states.
- Creating a draft redirects only after the database write succeeds.
- Refreshing any edit route restores persisted values.
- Publishing an incomplete draft shows the exact blocking checks.
- Cross-workspace Agent ID returns forbidden or not-found without data leakage.

## 20. Delivery Checkpoints

1. Visual v0: shell, navigation, creation page, and placeholder content using the approved design system.
2. User reviews v0.
3. Backend gaps are implemented for real creation and section persistence.
4. Full pages, responsive states, validation, accessibility, and tests are completed.
