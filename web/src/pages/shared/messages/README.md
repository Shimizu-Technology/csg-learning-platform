# Messaging modules

`../Messages.tsx` is the route entry point and preserves the previous public exports for tests and other consumers. This split changes no behavior, markup, classes, copy, or API calls.

| Module | Responsibility |
| --- | --- |
| `useMessagesState.ts` | Page state, refs, workspace/conversation selectors |
| `useMessagesController.tsx` | Loading, realtime reconciliation, mutations, read cursors, scroll anchoring and thread pagination |
| `useMessageSearch.ts` | Search query, deferred query, debounce and results |
| `messagesPresentation.tsx` | View derivations and composer placement with attachment previews |
| `ConversationList.tsx` | Inbox, search results and channel browsing |
| `ThreadPanel.tsx` | Desktop thread pane |
| `MessageActionsSheet.tsx` | Message action-sheet contents |
| `MessageRow.tsx` | Individual message, attachments, receipts, reactions and actions |
| `MessageComposer.tsx` | Memoized editor, draft map, mentions and send handling |
| `MessageEditSurface.tsx` | Inline editor and edit validation |
| `FormattedMessage.tsx` | Message blocks, inline formatting and code blocks |
| `mentions.tsx` | Mention matching, rendering and editor highlighting extension |
| `helpers.ts` | Target/cache/window/arrival tracking, grouping, labels and formatting |
| `ConversationControls.tsx` | Conversation button, header action and member identity |
| `types.ts` | Internal message, target, attachment and mention types |

The route still renders the main conversation feed and workspace/member/channel/DM dialogs. Those use the same controller state and handlers as the extracted panes. The controller deliberately keeps presence, typing, optimistic sends, realtime events, pagination and scroll restoration together: they share live refs and call each other's handlers. Moving those closures to independent hooks would require a separate change to their ownership and dependency contracts.

Keep the composer's `memo(forwardRef(...))` boundary, module-level unsaved draft map and ref-backed typing callback intact. Typing must not update route state or re-render message rows. `MessagesTypingPerformance.test.tsx` guards this contract.

`MessagesViewContext` and pane `Pick` types describe internal dependencies. Components add no DOM wrappers; the existing conditional markup stays inside each extracted pane.
