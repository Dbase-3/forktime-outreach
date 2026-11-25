import type { ActionKind } from "./types";

// Plain labels for actions, shared by pure code (practice runs) and the UI.
export const ACTION_LABELS: Record<ActionKind, string> = {
  book: "Books on calendar",
  transfer: "Transfers to a person",
  text: "Sends a text",
  crm: "Updates the CRM",
  webhook: "Sends to webhook",
};
