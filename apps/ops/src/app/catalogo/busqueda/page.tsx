import { ApiError, type SearchPreview } from "@yuntera/db";
import { messageOf, sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Alert, buttonClass, EmptyState, Skeleton, TextAreaField, TextField } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { addSynonym, removeSynonym } from "@/app/catalogue-actions";
import { CatalogueNav } from "@/components/catalogue-nav";
import { CatalogueForm, CatalogueOutcome } from "@/components/catalogue-outcome";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Búsqueda" };

export default function SearchToolsPage({ searchParams }: PageProps<"/catalogo/busqueda">) {
  return (
    <div className="shell py-8">
      <CatalogueNav current="/catalogo/busqueda" />
      <PageHeader title="Sinónimos de búsqueda">
        Palabras que la gente escribe y que el catálogo dice de otra forma: quien busca «refri»
        también encuentra «refrigeradora». Se guardan como las lee la búsqueda: en minúsculas, sin
        tildes y con un solo espacio.
      </PageHeader>
      <div className="mt-6">
        <CatalogueOutcome>
          <Suspense fallback={<Skeleton className="h-96" />}>
            <SearchTools searchParams={searchParams} />
          </Suspense>
        </CatalogueOutcome>
      </div>
    </div>
  );
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function SearchTools({
  searchParams,
}: Pick<PageProps<"/catalogo/busqueda">, "searchParams">) {
  await requireStaff("/catalogo/busqueda", ["catalog"]);
  const api = await sessionApi();
  const query = (one((await searchParams).q) ?? "").trim().slice(0, 200);
  const synonyms = await api.opsSearchSynonyms();
  let preview: SearchPreview | null = null;
  let problem: string | null = null;
  if (query) {
    try {
      preview = await api.opsSearchPreview(query);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem = messageOf(error);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="probar">
        <h2 id="probar" className="text-xl font-bold">
          Probar una búsqueda
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Lo que encuentra un comprador ahora mismo, y qué sinónimos la amplían.
        </p>
        <form action="/catalogo/busqueda" className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="q" className="text-sm font-semibold">
              Lo que escribiría el comprador
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={200}
              className="min-h-11 w-80 max-w-full rounded-md border border-border-strong bg-surface px-3"
            />
          </div>
          <button type="submit" className={buttonClass({ variant: "secondary" })}>
            Probar la búsqueda
          </button>
        </form>
        {problem ? (
          <Alert tone="danger" className="mt-3">
            {problem}
          </Alert>
        ) : null}
        {preview ? (
          <div
            className="mt-4 rounded-lg border border-border bg-surface p-5 text-sm"
            id="vista-previa"
            data-testid="search-preview"
          >
            <p>
              La búsqueda lee «<span className="font-semibold">{preview.query}</span>» y encuentra{" "}
              <span className="font-semibold">
                {preview.total} {preview.total === 1 ? "producto" : "productos"}
              </span>
              .
            </p>
            <p className="mt-1 text-ink-muted">
              {preview.synonyms.length === 0
                ? "Ningún sinónimo la amplía."
                : `La amplían: ${preview.synonyms
                    .map((synonym) => `«${synonym.term}» → ${synonym.expansions.join(", ")}`)
                    .join("; ")}.`}
            </p>
            {preview.results.length > 0 ? (
              <ol className="mt-3 list-decimal space-y-1 pl-5">
                {preview.results.map((result) => (
                  <li key={result.slug}>
                    {result.title}
                    <span className="text-ink-muted">
                      {" "}
                      · {result.brand_name ?? "sin marca"} · {result.category_slug}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="nuevo-sinonimo" className="max-w-xl">
        <h2 id="nuevo-sinonimo" className="text-xl font-bold">
          Nuevo sinónimo
        </h2>
        <div className="mt-3 rounded-lg border border-border bg-surface p-5">
          <CatalogueForm action={addSynonym} submit="Agregar sinónimo" pendingLabel="Guardando…">
            <TextField
              label="Palabra que la gente busca"
              name="term"
              maxLength={60}
              autoComplete="off"
              placeholder="refri"
              hint="Una palabra o una frase corta, hasta cuatro palabras."
            />
            <TextAreaField
              label="Que también encuentre"
              name="expansions"
              rows={2}
              maxLength={600}
              placeholder="refrigeradora"
              hint="Una o varias, separadas por comas, hasta ocho. Palabras como «de» o «la», o que salen en casi todos los productos, no sirven."
            />
          </CatalogueForm>
        </div>
      </section>

      <section aria-labelledby="sinonimos">
        <h2 id="sinonimos" className="text-xl font-bold">
          Sinónimos ({synonyms.length})
        </h2>
        {synonyms.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Todavía no hay sinónimos">
              Agregue el primero con el formulario de arriba.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {synonyms.map((synonym) => (
              <li
                key={synonym.term}
                className="rounded-lg border border-border bg-surface p-4"
                data-synonym={synonym.term}
              >
                <p className="break-words">
                  <span className="font-semibold">{synonym.term}</span> →{" "}
                  {synonym.expansions.join(", ")}
                </p>
                <details className="mt-1">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-link underline">
                    Quitar
                  </summary>
                  <div className="mt-2">
                    <CatalogueForm
                      action={removeSynonym}
                      submit={`Quitar «${synonym.term}»`}
                      variant="danger"
                      size="sm"
                    >
                      <input type="hidden" name="term" value={synonym.term} />
                      <p className="text-ink-muted">
                        Quien busque «{synonym.term}» deja de encontrar lo que solo trae el
                        sinónimo.
                      </p>
                    </CatalogueForm>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
