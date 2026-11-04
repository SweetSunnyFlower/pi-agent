# Page Loading Skeletons Design

Date: 2026-10-20

Status: Design approved by user

## 1. Summary

Add layout-matched loading skeletons to every browser-rendered page. Skeletons cover initial page data loading and data-list replacement, such as opening conversation history or switching history conversations. Button-level mutations retain compact inline loading indicators inside the button.

The visual language follows the existing sea-glass interface: translucent surfaces, restrained borders, and a low-contrast shimmer that does not compete with loaded content.

## 2. Goals

- Cover every UI route: home, Agent creation, Agent workspace shell, basic information, prompt, tools, Skills, channels, publishing, chat, and AI providers.
- Match each page's final geometry to minimize layout shift.
- Provide a shared skeleton primitive and accessible loading status.
- Keep desktop and mobile layouts stable.
- Respect reduced-motion preferences.
- Replace current full-panel pulse blocks and full-page spinners where structured content is known.

## 3. Non-Goals

- Replacing button spinners for save, publish, upload, model test, or connection test actions.
- Refactoring route data fetching into TanStack Router loaders.
- Changing API behavior, database models, or authorization.
- Adding artificial delays to make skeletons visible.

## 4. Loading States

### 4.1 Page-level skeletons

Use a page skeleton when required page data is not available yet:

- Home while authentication or the Agent list is initially loading.
- Agent creation page while workspace access is loading.
- Provider page while workspace access is loading.
- Agent workspace while workspace and Agent identity are loading.
- Prompt, tools, Skills, channels, and publishing forms while their required API data is loading.
- Chat while a selected historical conversation is loading.

### 4.2 List-level skeletons

Use compact list skeletons rather than a spinner when:

- Provider records are loading.
- Conversation history is loading.
- Agent cards are loading on the home page.

### 4.3 Inline action loading

Keep loading inside the triggering button for mutations and tests:

- Save draft.
- Publish.
- Test provider.
- Test InfoFlow connection.
- Upload or submit chat input.

The surrounding form remains visible and does not switch to a skeleton.

## 5. Component Architecture

Create a small shared primitive in `src/components/ui/skeleton.tsx`:

- `Skeleton` renders a decorative, layout-sized placeholder using the existing CSS tokens.
- The primitive is hidden from assistive technology.
- A parent loading region exposes `role="status"` and a visually hidden Chinese loading message.
- Shimmer animation uses CSS and is disabled by `prefers-reduced-motion`.

Create semantic skeleton compositions in `src/components/loading/`:

- `HomePageSkeleton`
- `AgentWorkspaceShellSkeleton`
- `AgentFormSkeleton`
- `ProviderPageSkeleton`
- `ChatPageSkeleton`

Route and feature components compose these patterns instead of duplicating markup.

## 6. Visual Rules

- Skeleton bars use a neutral surface tint derived from existing CSS variables.
- Heights mirror the actual text, controls, cards, and panels they replace.
- Agent workspace loading preserves the breadcrumb and three-column grid geometry.
- Mobile layouts collapse using the same breakpoints as loaded pages.
- Shimmer is subtle: a moving highlight across a static neutral base.
- No skeleton uses saturated accent colors or implies completed status.

## 7. Error Handling

Errors continue to replace loading content with the existing alert or empty-error panels. Skeletons are rendered only for loading states, never as a permanent fallback after a failed request.

## 8. Accessibility

- Loading regions use `aria-busy="true"` and `role="status"`.
- Each region includes a visually hidden message such as “正在加载 Agent 配置”.
- Decorative skeleton blocks use `aria-hidden="true"`.
- Buttons expose their existing disabled state and text during actions.
- Animations respect `prefers-reduced-motion`.

## 9. Verification

- Component tests verify that initial loading states expose accessible skeleton status.
- Tests verify loaded content replaces skeleton content after API resolution.
- Existing page and form tests remain green.
- Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- Check desktop and mobile rendering with browser automation where available.
