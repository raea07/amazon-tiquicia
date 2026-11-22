import {
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Api } from "@yuntera/db";
import { useApi, useSession } from "../auth/session";

/**
 * Reads from the API through the cache. Keys that depend on who is signed in
 * are prefixed with the user id, so one person's answers are never served to
 * another (the cache is also cleared at sign-out).
 */
export function useApiQuery<T>(
  key: QueryKey,
  read: (api: Api) => Promise<T>,
  options: Omit<UseQueryOptions<T, Error, T, QueryKey>, "queryKey" | "queryFn"> & {
    /** Per-user data: keyed by the user and skipped while signed out. */
    personal?: boolean;
  } = {},
) {
  const api = useApi();
  const { viewer, status } = useSession();
  const { personal = false, enabled = true, ...rest } = options;
  return useQuery({
    queryKey: personal ? ["user", viewer?.id ?? "anonymous", ...key] : key,
    queryFn: () => read(api),
    // Only once fully signed in: halfway through the second step the
    // database refuses everything but the second step's own calls.
    enabled: personal ? enabled !== false && Boolean(viewer) && status === "signedIn" : enabled,
    ...rest,
  });
}

/** Changes something through the API, then refreshes the keys it affects. */
export function useApiMutation<TInput, TResult>(
  write: (api: Api, input: TInput) => Promise<TResult>,
  options: Omit<UseMutationOptions<TResult, Error, TInput>, "mutationFn"> & {
    /** Keys (as given to useApiQuery, without the user prefix) to refresh afterwards. */
    invalidates?: QueryKey[];
  } = {},
) {
  const api = useApi();
  const client = useQueryClient();
  const { viewer } = useSession();
  const { invalidates = [], onSuccess, ...rest } = options;
  return useMutation({
    mutationFn: (input: TInput) => write(api, input),
    ...rest,
    onSuccess: async (...args) => {
      await Promise.all(
        invalidates.flatMap((key) => [
          client.invalidateQueries({ queryKey: key }),
          client.invalidateQueries({ queryKey: ["user", viewer?.id ?? "anonymous", ...key] }),
        ]),
      );
      await onSuccess?.(...args);
    },
  });
}
