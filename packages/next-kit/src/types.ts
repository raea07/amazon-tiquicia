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
  /**
   * Which step a multi-step form should show next, when the answer is not just
   * success or failure: "confirm-email" after a sign-up that needs the e-mail
   * confirmed, "code" once a reset e-mail is on its way, "done" at the end.
   */
  step?: string;
  /** Values the next step needs that are not form fields (an enrolment's QR code). */
  data?: Record<string, string>;
}
