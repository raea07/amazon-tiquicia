import { describe, expect, it } from "vitest";
import { stoppedParcelHistory, stoppedParcelLabel } from "./parcel-words";

describe("stoppedParcelLabel", () => {
  it("says a stopped parcel is in our warehouse, never that it came back", () => {
    expect(stoppedParcelLabel("returning", { recalled: true, stoppedBeforeLeaving: true })).toBe(
      "Detenido en la bodega",
    );
    expect(stoppedParcelLabel("returned", { recalled: true, stoppedBeforeLeaving: true })).toBe(
      "No salió de la bodega",
    );
  });

  it("keeps the usual words for a parcel that went out and came back", () => {
    expect(stoppedParcelLabel("returning", { recalled: false, stoppedBeforeLeaving: false })).toBe(
      null,
    );
    expect(stoppedParcelLabel("returned", { recalled: false, stoppedBeforeLeaving: false })).toBe(
      null,
    );
    // Stopped after an earlier attempt at the door: it did leave once.
    expect(stoppedParcelLabel("returned", { recalled: true, stoppedBeforeLeaving: false })).toBe(
      null,
    );
    expect(stoppedParcelLabel("delivered", { recalled: false, stoppedBeforeLeaving: false })).toBe(
      null,
    );
  });
});

describe("stoppedParcelHistory", () => {
  it("tells the history of a parcel that never left", () => {
    expect(stoppedParcelHistory("returning", true)).toBe("Paquete: detenido en nuestra bodega");
    expect(stoppedParcelHistory("returned", true)).toBe("Paquete: no salió de nuestra bodega");
    expect(stoppedParcelHistory("packed", true)).toBe(null);
  });

  it("leaves every other history line to the usual words", () => {
    expect(stoppedParcelHistory("returned", false)).toBe(null);
    expect(stoppedParcelHistory(null, true)).toBe(null);
  });
});
