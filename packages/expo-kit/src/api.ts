/**
 * The typed API (packages/db) over the app's Supabase client, and the words to
 * show when a call fails.
 */
export { useApi } from "./auth/session";
export {
  GENERIC_ERROR,
  messageOf,
  SIGN_IN_FAILED,
  signInMessage,
  signUpMessage,
  validateSignIn,
  validateSignUp,
} from "./errors";
