"use client";

/**
 * The catalogue screens' forms, and where their outcome is said when the form
 * itself is gone.
 *
 * Many catalogue actions change the very row they sit in: hiding a review
 * swaps "Ocultar" for "Mostrar", merging a brand moves it to the merged list,
 * a new address gives a category row a new place. The page is redrawn after
 * the change (refresh()), the form that held the message is replaced, and an
 * ordinary ActionForm's "done" was never seen. `CatalogueForm` behaves like
 * ActionForm and also hands its success message to the page's
 * `CatalogueOutcome`, which shows it at the bottom of the screen only while
 * the form that sent it is no longer there to show it itself.
 *
 * It works without JavaScript, as ActionForm does: until the page has loaded
 * its scripts (or when it never does) the form's action is the server action
 * itself through useActionState, which the browser posts as an ordinary form
 * and whose result the redrawn page shows under the form. Once the scripts
 * are running, the same action is called through a wrapper that also tells
 * the page-level notice; that is the enhancement.
 */

import { type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { Alert, type ButtonSize, type ButtonVariant } from "@yuntera/ui";
import {
  createContext,
  type ReactNode,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

interface Outcomes {
  announce(form: string, message: string): void;
  mount(form: string): () => void;
}

const OutcomeContext = createContext<Outcomes | null>(null);

export function CatalogueOutcome({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<{ form: string; message: string } | null>(null);
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  const outcomes = useMemo<Outcomes>(
    () => ({
      announce: (form, message) => setOutcome({ form, message }),
      mount: (form) => {
        setMounted((now) => new Set(now).add(form));
        return () =>
          setMounted((now) => {
            const next = new Set(now);
            next.delete(form);
            return next;
          });
      },
    }),
    [],
  );
  const shown = outcome && !mounted.has(outcome.form) ? outcome.message : null;
  return (
    <OutcomeContext.Provider value={outcomes}>
      {/* At the bottom of the screen, wherever the person has scrolled to: the
          row they acted on is usually far down the list, and the top is taken
          by the console's sticky header. */}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl"
        data-catalogue-outcome=""
      >
        {shown ? (
          <div className="pointer-events-auto flex flex-wrap items-start gap-2 rounded-md bg-surface p-1 shadow-lg">
            <Alert tone="success" className="min-w-0 flex-1">
              {shown}
            </Alert>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm font-semibold text-link underline"
            >
              Cerrar aviso
            </button>
          </div>
        ) : null}
      </div>
      {children}
    </OutcomeContext.Provider>
  );
}

/**
 * ActionForm (packages/next-kit) for the catalogue screens: a button, any
 * fields passed as children, and the outcome underneath, with what was typed
 * put back after a refusal. Its success also reaches `CatalogueOutcome`.
 */
export function CatalogueForm({
  action,
  children,
  submit,
  pendingLabel,
  variant,
  size,
  className = "flex flex-col gap-3",
}: {
  action: FormAction;
  children?: ReactNode;
  submit: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const id = useId();
  const outcomes = useContext(OutcomeContext);
  const send = useCallback(
    async (previous: ActionState | null, formData: FormData) => {
      const next = await action(previous ?? {}, formData);
      if (next.ok) outcomes?.announce(id, next.ok);
      return next;
    },
    [action, outcomes, id],
  );
  // The server action as it is: the form posts to it without JavaScript, and
  // the page drawn after the post carries its result here.
  const [posted, postAction] = useActionState(action, {});
  // The same action once the page runs scripts, also telling the page's notice.
  const [sent, sendAction] = useActionState(send, null);
  const scripted = useScripted();
  const state = sent ?? posted;
  useEffect(() => outcomes?.mount(id), [outcomes, id]);

  // Browsers clear a form when its action finishes; put back what was typed
  // when the action refused it.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.error || !state.values || !form.current) return;
    for (const [name, value] of Object.entries(state.values)) {
      const field = form.current.elements.namedItem(name);
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      ) {
        field.value = value;
      }
    }
  }, [state]);

  return (
    <form ref={form} action={scripted ? sendAction : postAction} className={className}>
      {children}
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>
          {submit}
        </SubmitButton>
      </div>
    </form>
  );
}

const subscribeNever = () => () => {};

/**
 * False while the server draws the page and while the browser hydrates it,
 * true from then on. The form keeps the server action as its action until
 * then, so what the server sent and what hydration finds are the same.
 */
function useScripted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
