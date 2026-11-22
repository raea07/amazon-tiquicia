/**
 * Two catalogue changes at the same moment (20261121083700_console_catalogue.sql).
 * The SQL suites run in one transaction each and cannot show a race, so these
 * open two real sessions against the database: the first holds its
 * transaction open, the second starts and waits behind it, then the first
 * commits. What is checked is what both leave behind together.
 *
 *   - Two staff hiding two reviews of one product: the product's rating and
 *     count must count neither (the rating trigger used to read the reviews
 *     before waiting for the product row, and kept a stale count).
 *   - A category created under a branch that is being moved deeper: the
 *     three-level limit must still hold.
 *
 * What these tests change they undo: the reviews are shown again and the
 * categories they create are removed.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractDatabase } from "./contract.helpers";

const db = contractDatabase();
const STAFF = "central@yuntera.example";

describe.skipIf(!db.enabled)(
  "catalogue changes at the same time (against a seeded database)",
  () => {
    let pool: pg.Pool;
    let staffId = "";

    beforeAll(async () => {
      await db.connect();
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
      const { rows } = await db.query<{ id: string }>(
        "select id from auth.users where email = $1",
        [STAFF],
      );
      staffId = rows[0]?.id ?? "";
      expect(staffId, "database is not seeded — run pnpm db:local:reset").not.toBe("");
    });

    afterAll(async () => {
      // Deepest first: a category with sub-categories cannot go.
      for (const slug of ["nieta", "hoja", "rama", "arriba"]) {
        await db.query("delete from public.categories where slug = $1", [
          `contrato-carrera-${slug}`,
        ]);
      }
      await pool?.end();
      await db.close();
    });

    /** A session acting as catalogue staff, inside a transaction it keeps open. */
    async function staffSession() {
      const client = await pool.connect();
      await client.query("begin");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: staffId, role: "authenticated", aal: "aal2" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      return { client, pid: rows[0]?.pid ?? 0 };
    }

    /** Waits (up to `ms`) until the session is waiting for a lock; says whether it did. */
    async function waitsForLock(pid: number, ms = 3000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const { rows } = await db.query<{ waiting: boolean }>(
          "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
          [pid],
        );
        if (rows[0]?.waiting) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }

    it("keeps a product's rating right when two of its reviews are hidden at once", async () => {
      const { rows: picked } = await db.query<{ product_id: string; reviews: string[] }>(
        // A product no other contract suite reads, so suites running alongside
        // never see its reviews hidden for a moment.
        `select r.product_id, (array_agg(r.id order by r.id))[1:2] as reviews
         from public.reviews r
         join public.products p on p.id = r.product_id
        where r.status = 'published' and p.slug = 'cafe-grano-tarrazu-1kg'
        group by r.product_id
       having count(*) >= 2`,
      );
      const target = picked[0];
      expect(target, "the seed has no product with two published reviews").toBeDefined();
      if (!target) return;
      const [first, second] = target.reviews;
      const rating = async () =>
        (
          await db.query<{ stored: string; counted: string }>(
            `select p.rating_sum || '/' || p.rating_count as stored,
                  coalesce(sum(r.rating), 0) || '/' || count(r.id) as counted
             from public.products p
             left join public.reviews r on r.product_id = p.id and r.status = 'published'
            where p.id = $1
            group by p.id`,
            [target.product_id],
          )
        ).rows[0];
      const before = await rating();
      expect(before?.stored).toBe(before?.counted);

      const a = await staffSession();
      const b = await staffSession();
      try {
        await a.client.query("select public.ops_hide_review($1, 'spam')", [first]);
        const later = b.client.query("select public.ops_hide_review($1, 'offensive')", [second]);
        expect(await waitsForLock(b.pid)).toBe(true);
        await a.client.query("commit");
        await later;
        await b.client.query("commit");

        const after = await rating();
        expect(after?.stored, "the stored rating counts a hidden review").toBe(after?.counted);
      } finally {
        await a.client.query("rollback").catch(() => undefined);
        await b.client.query("rollback").catch(() => undefined);
        a.client.release();
        b.client.release();
        const staff = db.as(STAFF, "aal2");
        for (const review of [first, second]) {
          if (review) await staff.opsShowReview(review).catch(() => undefined);
        }
      }
      expect((await rating())?.stored).toBe(before?.stored);
    });

    it("keeps the depth limit when a category is created under a branch being moved", async () => {
      const staff = db.as(STAFF, "aal2");
      const top = await staff.opsCreateCategory({
        nameEs: "Contrato carrera arriba",
        slug: "contrato-carrera-arriba",
      });
      const branch = await staff.opsCreateCategory({
        nameEs: "Contrato carrera rama",
        slug: "contrato-carrera-rama",
      });
      const leaf = await staff.opsCreateCategory({
        nameEs: "Contrato carrera hoja",
        slug: "contrato-carrera-hoja",
        parentId: branch.id,
      });

      const a = await staffSession();
      const b = await staffSession();
      let refusal = "";
      try {
        // The branch (two levels) goes under a department: its leaf is then at level 3.
        await a.client.query("select public.ops_move_category($1, $2)", [branch.id, top.id]);
        const later = b.client
          .query(
            "select public.ops_create_category('Contrato carrera nieta', null, 'contrato-carrera-nieta', $1)",
            [leaf.id],
          )
          .then(
            () => "",
            (error: Error) => error.message,
          );
        await waitsForLock(b.pid, 1500);
        await a.client.query("commit");
        refusal = await later;
        await b.client.query(refusal ? "rollback" : "commit");
      } finally {
        await a.client.query("rollback").catch(() => undefined);
        await b.client.query("rollback").catch(() => undefined);
        a.client.release();
        b.client.release();
      }
      expect(refusal).toBe("category_too_deep");
      const { rows } = await db.query<{ slug: string }>(
        "select slug from public.categories where slug = 'contrato-carrera-nieta'",
      );
      expect(rows).toEqual([]);
    });
  },
);
