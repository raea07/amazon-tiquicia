import { COMPLAINT_ANSWER_TIME, returnAnswerTime } from "@yuntera/core";
import { describe, expect, it } from "vitest";
import { COMPLAINT_ANSWER_WORDS, RETURN_ANSWER_WORDS, TEMPLATES } from "./catalog.ts";

// The messages promise the answer times of packages/core/src/service-times.ts,
// which a parity test there keeps equal to private.case_targets and to
// docs/06-operations/customer-service.md.
const vars = {
  order_number: "YT-100123",
  order_id: "00000000-0000-4000-8000-000000000001",
  return_ref: "ABCD1234",
  return_title: "Libreta",
  complaint_ref: "EFGH5678",
};
const links = { shop: "https://yuntera.example", seller: "https://vendedores.yuntera.example" };

describe("answer times in messages", () => {
  it("are the shopper's words of core", () => {
    expect(COMPLAINT_ANSWER_WORDS).toBe(COMPLAINT_ANSWER_TIME);
    for (const kind of ["withdrawal", "damaged", "wrong_item", "warranty"]) {
      expect(RETURN_ANSWER_WORDS[kind], kind).toBe(returnAnswerTime(kind));
    }
  });

  it("are what the return and complaint e-mails say", () => {
    const damaged = TEMPLATES.return_received!({
      vars: { ...vars, return_kind: "damaged" },
      name: "Ana",
      links,
    } as never);
    expect(damaged.paragraphs.join(" ")).toContain("en un máximo de 2 horas hábiles");
    expect(damaged.preheader).toContain("2 horas hábiles");
    const withdrawal = TEMPLATES.return_received!({
      vars: { ...vars, return_kind: "withdrawal" },
      name: "Ana",
      links,
    } as never);
    expect(withdrawal.paragraphs.join(" ")).toContain("en un máximo de 1 día hábil");
    const complaint = TEMPLATES.complaint_received!({ vars, name: "Ana", links } as never);
    expect(complaint.paragraphs.join(" ")).toContain("en un máximo de 5 días hábiles");
    expect(JSON.stringify([damaged, withdrawal, complaint])).not.toMatch(/3 días hábiles/);
  });
});
