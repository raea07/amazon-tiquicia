import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_DESCRIPTION_MAX,
  COMPLAINT_DESCRIPTION_MIN,
  checkComplaint,
  complaintFiledText,
  myCaseDueText,
  myCaseStatusWord,
} from "./complaints";

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

/** The last definition of public.file_complaint across the migrations. */
function fileComplaintSql(): string {
  let body = "";
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(`${MIGRATIONS}${file}`, "utf8");
    const match = /create or replace function public\.file_complaint\([\s\S]*?\n\$\$;/.exec(sql);
    if (match) body = match[0];
  }
  return body;
}

describe("checkComplaint", () => {
  it("asks for a category, a description and a well-formed order number", () => {
    expect(checkComplaint({ category: "", description: "Algo pasó con mi pedido." })).toMatchObject(
      {
        field: "category",
      },
    );
    expect(checkComplaint({ category: "delivery", description: " corto " })).toMatchObject({
      field: "description",
    });
    expect(checkComplaint({ category: "delivery", description: "x".repeat(4001) })).toMatchObject({
      field: "description",
    });
    expect(
      checkComplaint({ category: "delivery", description: "Llegó tarde.", orderNumber: "123" }),
    ).toMatchObject({ field: "orderNumber" });
  });

  it("trims and normalises what it passes on", () => {
    expect(
      checkComplaint({
        category: "product",
        description: "  El producto llegó roto.  ",
        orderNumber: " yt-100123 ",
      }),
    ).toEqual({
      input: {
        category: "product",
        description: "El producto llegó roto.",
        orderNumber: "YT-100123",
      },
    });
    expect(checkComplaint({ category: "other", description: "Sin pedido de por medio." })).toEqual({
      input: { category: "other", description: "Sin pedido de por medio.", orderNumber: null },
    });
  });

  it("follows file_complaint's rules", () => {
    const sql = fileComplaintSql();
    const categories = /p_category not in \(([^)]*)\)/.exec(sql)?.[1] ?? "";
    expect(categories.split(",").map((value) => value.trim().replace(/'/g, ""))).toEqual(
      COMPLAINT_CATEGORIES.map(([value]) => value),
    );
    expect(sql).toContain(
      `char_length(v_description) not between ${COMPLAINT_DESCRIPTION_MIN} and ${COMPLAINT_DESCRIPTION_MAX}`,
    );
  });
});

describe("complaintFiledText", () => {
  it("is the acknowledgement: the reference and the date of the written answer", () => {
    const text = complaintFiledText({
      reference: "0D3DE240",
      answerBy: "lunes 7 de diciembre",
    });
    expect(text).toContain("0D3DE240");
    expect(text).toContain("Este mensaje es la confirmación");
    expect(text).toContain("a más tardar el lunes 7 de diciembre");
    // No second confirmation is promised.
    expect(text.match(/a más tardar/g)).toHaveLength(1);
  });
});

describe("myCaseDueText", () => {
  it("promises an answer by the due day only for a complaint", () => {
    expect(myCaseDueText("complaint", "2 de diciembre")).toBe(
      "le respondemos a más tardar el 2 de diciembre",
    );
    for (const kind of ["return", "contact", "report", "other"]) {
      expect(myCaseDueText(kind, "2 de diciembre")).not.toContain("respondemos");
    }
    expect(myCaseDueText("return", "2 de diciembre")).toBe(
      "lo resolvemos a más tardar el 2 de diciembre",
    );
    expect(myCaseDueText("report", "2 de diciembre")).toBe(
      "lo revisamos a más tardar el 2 de diciembre",
    );
  });
});

describe("myCaseStatusWord", () => {
  it("says where a shopper's case stands in the case words of status-words.ts", () => {
    expect(myCaseStatusWord({ status: "open", answers: [] })).toBe("Por responder");
    expect(myCaseStatusWord({ status: "open", answers: [{}] })).toBe("En revisión");
    expect(myCaseStatusWord({ status: "closed", answers: [] })).toBe("Respondido");
    // A value the module does not know is shown as it came.
    expect(myCaseStatusWord({ status: "archived", answers: [] })).toBe("archived");
  });
});
