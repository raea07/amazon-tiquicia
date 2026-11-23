import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { refreshShopCatalog } = await import("./shop");

const answer = (status: number, headers: Record<string, string> = {}, body: string | null = null) =>
  new Response(body, { status, headers });

describe("refreshShopCatalog", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // A local run (the API on this machine): readable keys are accepted.
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SHOP_URL", "https://shop.example");
    vi.stubEnv("SHOP_REFRESH_KEY", "a-shared-key");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks the shop with the key, and does not follow redirects", async () => {
    fetchMock.mockResolvedValue(answer(204));
    await refreshShopCatalog();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://shop.example/api/catalogo/refrescar");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({ "x-refresh-key": "a-shared-key" });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("asks for the category menu too, only when categories changed", async () => {
    fetchMock.mockResolvedValue(answer(204));
    await refreshShopCatalog({ categories: true });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.headers).toEqual({
      "x-refresh-key": "a-shared-key",
      "x-refresh-scope": "categories",
    });
  });

  it("asks for the district list too, only when zones or districts changed", async () => {
    fetchMock.mockResolvedValue(answer(204));
    await refreshShopCatalog({ districts: true });
    const [, first] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(first.headers).toEqual({
      "x-refresh-key": "a-shared-key",
      "x-refresh-scope": "districts",
    });
    await refreshShopCatalog({ categories: true, districts: true });
    const [, both] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(both.headers).toEqual({
      "x-refresh-key": "a-shared-key",
      "x-refresh-scope": "categories,districts",
    });
  });

  it("counts a redirect to a login page as a failure, and says where it led", async () => {
    fetchMock.mockResolvedValue(
      answer(302, { location: "https://vercel.com/sso-api?url=https%3A%2F%2Fshop&nonce=secret" }),
    );
    await expect(refreshShopCatalog()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledOnce();
    const message = String(errorLog.mock.calls[0]?.[0]);
    expect(message).toContain("HTTP 302, redirected to vercel.com");
    expect(message).not.toContain("nonce");
  });

  it.each([
    ["a login page answered with 200", answer(200, { "content-type": "text/html" }, "<html>")],
    ["a wrong key", answer(401)],
    ["a shop without the key set", answer(404)],
    ["a server error", answer(500)],
    ["a browser-style opaque redirect", answer(307, { location: "/ingresar" })],
  ])("logs %s and does not throw", async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    await expect(refreshShopCatalog()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("logs a network failure or a timeout and does not throw", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    await expect(refreshShopCatalog()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("is not fooled by a real redirect to a login page that answers 200", async () => {
    // What Vercel Authentication does to a server-to-server call: 302 to a
    // sign-in page, which answers 200 with HTML.
    vi.unstubAllGlobals();
    const { createServer } = await import("node:http");
    const server = createServer((request, response) => {
      if (request.url === "/login") {
        response.writeHead(200, { "content-type": "text/html" }).end("<html>Log in</html>");
      } else {
        response.writeHead(302, { location: "/login" }).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    vi.stubEnv("NEXT_PUBLIC_SHOP_URL", `http://127.0.0.1:${port}`);
    try {
      await refreshShopCatalog();
    } finally {
      server.close();
    }
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0]?.[0])).toContain("HTTP 302");
  });

  it("does nothing without the shop's address or the key", async () => {
    vi.stubEnv("SHOP_REFRESH_KEY", "");
    await refreshShopCatalog();
    vi.stubEnv("SHOP_REFRESH_KEY", "a-shared-key");
    vi.stubEnv("NEXT_PUBLIC_SHOP_URL", "");
    await refreshShopCatalog();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("WEB-8: deployed, refuses an example or short key and asks nothing", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
    for (const key of ["local-development-only", "a-shared-key"]) {
      vi.stubEnv("SHOP_REFRESH_KEY", key);
      await refreshShopCatalog();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("local-development-only");
    fetchMock.mockResolvedValue(answer(204));
    vi.stubEnv("SHOP_REFRESH_KEY", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822c");
    await refreshShopCatalog();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
