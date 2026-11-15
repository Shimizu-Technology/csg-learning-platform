# Messaging modules

`../Messages.tsx` is the route entry point and keeps the earlier public exports for tests and other consumers. It lays out the inbox, the collapsed rail, the conversation pane and the main composer, and passes each component only the hook groups it reads.

## Hooks

Each hook owns its state and effects and returns a narrow surface. `useMessagesController.ts` only composes them and returns them as groups (`route`, `conversation`, `directory`, `feed`, `realtime`, `mutations`, `attachments`, `lightbox`, `overlays`, `search`, `alerts`).

| Hook | Owns |
| --- | --- |
| `useMessagesRoute.ts` | URL params, the routed message/thread/offset, requested workspace, the source record a staff member came from |
| `useConversationState.ts` | Shared conversation state: the open target, its loaded and pinned messages, unread divider, open thread, pins view, desktop/phone panes, the message being edited, temporary ids. Derived maps (by id, thread replies, root messages). `selectTarget` and `clearConversation` |
| `useWorkspaceDirectory.ts` | Workspaces, channels, DMs and people; summary freshness and unread counts; workspace selection kept in step with the cohort; mentionable people; mute; create channel/workspace/DM and member dialogs |
| `useConversationWindow.ts` | The message window: following the route, cached views, loading around a linked message, older/newer paging, the thread window and its paging, queued messages behind a historical window, scroll anchoring and stick-to-bottom, read cursors, and applying realtime message events |
| `useMessagesRealtime.ts` | The Cable subscription, who is typing here, this person's typing presence, polling and focus refresh while realtime is down |
| `useMessageMutations.ts` | Send (optimistic rows, stored failures, the once-per-conversation source), retry, discard, restore, edit, delete, react, pin, copy text and links, report, block |
| `useComposerAttachments.ts` | Pending files per draft, uploads, optimistic preview URLs |
| `useAttachmentLightbox.ts` | The image viewer, its keyboard and swipe paging, download |
| `useMessageOverlays.ts` | Author context, reaction details, the message actions sheet, delete confirmation |
| `useMessageSearch.ts` | Inbox search: open state, query, debounced results |
| `useBrowserAlerts.ts` | Browser push alerts on this device |

`failedSends.ts` reads and writes failed sends in localStorage and turns them back into retryable rows. Both the window (restoring a conversation) and mutations (saving and clearing a failure) use it.

### Call order is effect order

React runs effects in the order hooks are called. The controller calls the directory before the window, so the list load (`loadLists`) starts before the first conversation load, as it did before the split. Summary freshness depends on that request order. The window's route effect must run before its "open the selected target" effect, which reads the load options the route effect leaves behind. Both live in `useConversationWindow` in that order. Realtime subscribes after the window. If you add a hook or move an effect, keep effects that share refs or state in their current relative order.

### Dependencies

Every hook dependency array is complete; run `npx eslint --rule '{"react-hooks/exhaustive-deps":"warn"}' src/pages/shared/messages` to check. When an effect must re-run only on a trigger (the conversation key, the route) but also reads other values, it reads those through `useEffectEvent`. Do not add the extra values to the dependency array: some of them, like `toast` and `setSelectedCohort`, get a new identity on every render in tests, and a re-run would cancel in-flight loads.

Cross-hook handlers stay ordinary functions passed as arguments: the window gets the directory's summary updaters, mutations get the window's `trackOwnSend` and `queueHistoricalSend`, and realtime gets the window's `applyRealtimeEvent` and `refreshInBackground`. Realtime calls the event handler through `useEffectEvent`, so the subscription doesn't restart when the handler changes.

## Components

| Module | Responsibility |
| --- | --- |
| `messagesPresentation.tsx` | View derivations, the shared `MessageRow` wiring for feed and thread rows, thread paging buttons, and composer placement with attachment previews |
| `ConversationList.tsx` | Inbox, search results and channel browsing |
| `ConversationHeader.tsx` | Title, record links, mute, conversation options, source context, alert status |
| `ConversationFeed.tsx` | Feed or pins (or a phone's thread), paging, unread divider, jump to latest, the desktop thread pane |
| `ThreadPanel.tsx` | Desktop thread pane |
| `MessagesDialogs.tsx` | Reactions, workspace switcher, workspace and channel forms, members, delete confirmation, message actions, new DM, author context, image lightbox |
| `MessageActionsSheet.tsx` | Message action-sheet contents |
| `MessageRow.tsx` | Individual message, attachments, receipts, reactions and actions |
| `MessageComposer.tsx` | Memoized editor, unsaved draft map, mentions and send handling |
| `MessageEditSurface.tsx` | Inline editor and edit validation |
| `FormattedMessage.tsx` | Message blocks, inline formatting and code blocks |
| `mentions.tsx` | Mention matching, rendering and editor highlighting extension |
| `helpers.ts` | Target/cache/window/arrival tracking, grouping, labels and formatting |
| `ConversationControls.tsx` | Conversation row link and member identity |
| `MessageLink.tsx` | Links inside messages: same-origin links route in place, others open a new tab |
| `MessageSourceLine.tsx` | "About …" line for a message sent from a lesson, submission or help request (L-1.8) |
| `types.ts` | Internal message, target, attachment and mention types |

Components add no DOM wrappers; markup and classes are the same as before the split.

## Contracts to keep

- Typing must not update page state or re-render message rows. Keep the composer's `memo(forwardRef(...))` boundary, its module-private unsaved draft map, and the stable `reportComposerTyping` callback (`useCallback` over refs). `MessagesTypingPerformance.test.tsx` guards this.
- A failed send keeps its source reservation while it can be retried; discarding it or restoring its text releases the source for the next message. `useMessageMutations.test.tsx` covers this.
- Keyboard and focus behavior, draft persistence, Enter-to-send settings, mention-by-id, copy link, realtime updates, and the 390px and 1280px layouts behave as they did with the single controller. The page tests (`../Messages*.test.tsx`, `../MessageComposer*.test.ts(x)`) cover most of these; check the two layouts in a browser after changing pane or composer placement.
