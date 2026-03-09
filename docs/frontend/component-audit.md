# Frontend Component Audit

## Summary

The frontend now uses:
- `components/ui` for primitives
- `components/layout` for shell concerns
- `components/shared` for cross-feature composites
- `features/*` for domain-owned containers, hooks, types, api modules, and feature-only components

This audit records the main reorganization decisions that were implemented in this pass.

## Move To Shared

- `AuthCardShell` and `AuthField`: shared auth framing used by sign-in and sign-up
- `ConfirmDeleteDialog`: shared destructive confirmation used by profiles and lists
- `LogsViewer`: shared log surface used by logs and VNC flows
- `ErrorBoundary`: app-wide error wrapper

## Move To Layout

- `app-sidebar`
- `theme-toggle`
- `user-menu`
- `AuthGuard`
- `ConvexClientProvider`

## Move To Features

- All former `tabs/*` domains now live under `features/*`
- `useProfiles` moved into `features/profiles/hooks`
- `useLists` moved into `features/lists/hooks`
- `useDataUploader` moved into `features/accounts/hooks`
- VNC viewer/runtime helpers moved into `features/vnc`
- Workflow activity input/rendering UI moved into `features/workflows/activity-ui`

## Merge Or Remove

- Deleted duplicate list/profile delete-confirmation components in favor of `ConfirmDeleteDialog`
- Removed the local dense-button implementation from `LogsViewer` in favor of the shared `dense-button`
- Replaced direct `tabs/*` imports with feature-owned boundaries

## Split Into Smaller Units

- Sign-in and sign-up pages now route through feature containers and share the same auth shell
- Feature page entry files now delegate to container files
- Large feature pages are now separated into page wrappers and container modules

## Keep In Place

- `components/ui/*` primitives remain centralized
- `features/workflows/activities` now owns the activity registry, activity definitions, and workflow-specific domain metadata
- `hooks/useAuthenticatedFetch`, `hooks/useWebSocket`, `hooks/use-theme`, `hooks/use-mobile`, and related app-global hooks remain top-level

## Follow-Up Candidates

- Extract the remaining container-local helper components from `accounts` and `monitoring` into dedicated component files if further decomposition is needed
- Continue pruning any empty legacy directories left behind by the reorganization
