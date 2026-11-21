/** What a form action reports back to the form that called it. */
export interface ActionState {
  error?: string;
  ok?: string;
  /**
   * What the person typed, sent back so the form keeps it. Browsers clear a
   * form once its action finishes; without this a single mistake would wipe
   * every field. Passwords are never echoed.
   */
  values?: Record<string, string>;
}
