/**
 * File storage: the part of `/storage/v1/*` that the apps and storage-js use.
 *
 * Every operation on a file is decided the way the real storage service
 * decides it: by running the matching statement on storage.objects inside a
 * transaction, as the caller's role (`anon` or `authenticated`) with their
 * claims, the operation's name in `storage.operation` and the request's
 * headers in `request.headers` (as the service's scope.ts sets them), so the
 * rules written in the migrations really are what allows or refuses it. A
 * signed upload address asked for with `x-upsert: true` is probed with an
 * upsert, as the real service does. Bucket limits (size, declared type) come
 * from storage.buckets.
 * The bytes are kept on local disk, one folder per database (so per lane),
 * and written only after the row operation succeeded.
 *
 * Implemented (request and answer shapes as in
 * docs/research/supabase-auth-storage-wire-format.md, section 4.4 and 7.4):
 *   POST   /object/{bucket}/{path}               upload (raw body or multipart), x-upsert
 *   PUT    /object/{bucket}/{path}               replace an existing file
 *   POST   /object/upload/sign/{bucket}/{path}   signed upload URL (checks INSERT as the caller)
 *   PUT    /object/upload/sign/{bucket}/{path}   upload with that URL's token, no session
 *   GET    /object/public/{bucket}/{path}        public bucket only; a private one is "no such bucket"
 *   GET    /render/image/public/{bucket}/{path}  the original bytes (no transformation here, as on the free plan)
 *   GET    /object/{bucket}/{path}               download as the caller (also /object/authenticated/…)
 *   GET    /object/info/{bucket}/{path}          metadata as the caller
 *   POST   /object/sign/{bucket}/{path}          signed download URL (SELECT as the caller)
 *   POST   /object/sign/{bucket}                 several signed download URLs
 *   GET    /object/sign/{bucket}/{path}?token=   download with a signed URL
 *   POST   /object/copy                          copy, also between buckets (SELECT source, INSERT target)
 *   DELETE /object/{bucket}                      remove several files (DELETE and SELECT as the caller)
 * Not implemented: list, move, bucket administration, resumable (TUS) uploads,
 * image transformations, CDN behaviour, the storage service's own triggers.
 *
 * Errors are answered as the real service does: HTTP 400 (500 only for
 * internal errors) with the real status as a string in the body, and a stable
 * `code`: {"statusCode":"404","code":"NoSuchKey","error":"not_found","message":…}.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import type { PoolClient } from "pg";
import {
  authenticate,
  DATABASE_URL,
  HttpError,
  KEY_ID,
  keys,
  pool,
  type Routes,
  readBody,
  send,
  sendBytes,
} from "../context.ts";
import type { Claims } from "../rpc.ts";

const PREFIX = "/storage/v1";
/** Largest upload the platform accepts at all (free plan: 50 MB). */
const GLOBAL_LIMIT = 50 * 1024 * 1024;
/** Hosted platform: two hours (the open-source server's default is 60 s). */
const SIGNED_UPLOAD_SECONDS = Number(process.env.DEV_STORAGE_SIGNED_UPLOAD_SECONDS ?? 7200);

/** Where the bytes live: one folder per database, so each lane keeps its own. */
const STORAGE_DIR = resolve(
  process.env.DEV_STORAGE_DIR ??
    join(
      fileURLToPath(new URL("../../.storage/", import.meta.url)),
      new URL(DATABASE_URL).pathname.replace(/^\//, "") || "default",
    ),
);

// ── Errors ─────────────────────────────────────────────────────────────────

const ERRORS = {
  NoSuchBucket: ["404", "Bucket not found", "Bucket not found"],
  NoSuchKey: ["404", "not_found", "Object not found"],
  AccessDenied: ["403", "Unauthorized", "new row violates row-level security policy"],
  KeyAlreadyExists: ["409", "Duplicate", "The resource already exists"],
  EntityTooLarge: ["413", "Payload too large", "The object exceeded the maximum allowed size"],
  InvalidMimeType: ["415", "invalid_mime_type", "mime type is not supported"],
  InvalidKey: ["400", "InvalidKey", "Invalid key"],
  InvalidJWT: ["400", "InvalidJWT", "jwt malformed"],
  InvalidSignature: ["400", "InvalidSignature", "The url and token do not match"],
  ExpiredToken: ["400", "ExpiredToken", "The provided token has expired."],
  InvalidRequest: ["400", "InvalidRequest", "Invalid request"],
} as const;

type StorageCode = keyof typeof ERRORS;

function fail(code: StorageCode, message?: string): never {
  const [statusCode, error, defaultMessage] = ERRORS[code];
  throw new HttpError(400, { statusCode, code, error, message: message ?? defaultMessage });
}

/** The caller, with a bad token reported the way storage reports it. */
async function caller(req: IncomingMessage): Promise<Claims | null> {
  try {
    return await authenticate(req);
  } catch {
    fail("InvalidJWT", "Invalid Compact JWS");
  }
}

// ── Keys, paths and bytes ───────────────────────────────────────────────────

// Object names the real service accepts (its own validation, simplified).
const VALID_KEY = /^[\w/!\-.*'() &$@=;:+,?]+$/;

function checkKey(name: string) {
  if (
    !name ||
    !VALID_KEY.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail("InvalidKey", `Invalid key: ${name}`);
  }
}

function filePath(bucket: string, name: string): string {
  const path = resolve(STORAGE_DIR, bucket, name);
  if (!path.startsWith(`${STORAGE_DIR}/`)) fail("InvalidKey");
  return path;
}

/** "/a/b%20c/d" → ["a", "b c", "d"] */
function segments(path: string): string[] {
  try {
    return path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    fail("InvalidKey");
  }
}

interface Bucket {
  id: string;
  public: boolean;
  file_size_limit: string | null;
  allowed_mime_types: string[] | null;
}

async function bucketById(id: string): Promise<Bucket> {
  const { rows } = await pool.query<Bucket>(
    "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1",
    [id],
  );
  if (!rows[0]) fail("NoSuchBucket");
  return rows[0];
}

const limitOf = (bucket: Bucket) =>
  Math.min(GLOBAL_LIMIT, bucket.file_size_limit ? Number(bucket.file_size_limit) : GLOBAL_LIMIT);

function checkFile(bucket: Bucket, size: number, contentType: string) {
  if (size > limitOf(bucket)) fail("EntityTooLarge");
  const allowed = bucket.allowed_mime_types;
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (allowed && allowed.length > 0 && !allowed.some((type) => type.toLowerCase() === base)) {
    fail("InvalidMimeType", `mime type ${contentType} is not supported`);
  }
}

interface Upload {
  bytes: Buffer;
  contentType: string;
  cacheControl: string;
  userMetadata: unknown;
}

/** The file in an upload request: a raw body, or storage-js's multipart form. */
async function readUpload(req: IncomingMessage, bucket: Bucket): Promise<Upload> {
  // A little room for the multipart envelope; the file itself is checked below.
  const body = await readLimited(req, limitOf(bucket) + 64 * 1024);
  const type = req.headers["content-type"] ?? "text/plain;charset=UTF-8";
  const boundary = /^multipart\/form-data;.*boundary=("?)([^";]+)\1/i.exec(type)?.[2];
  if (!boundary) {
    const metadata = req.headers["x-metadata"];
    return {
      bytes: body,
      contentType: type,
      cacheControl: String(req.headers["cache-control"] ?? "no-cache"),
      userMetadata: typeof metadata === "string" ? decodeMetadata(metadata) : null,
    };
  }

  const parts = splitMultipart(body, boundary);
  const field = (name: string) => parts.find((p) => p.name === name && p.filename === null);
  const file = parts.find((p) => p.filename !== null) ?? parts.find((p) => p.name === "");
  if (!file) fail("InvalidRequest", "No file in the form");
  const seconds = field("cacheControl")?.data.toString("utf8") ?? "3600";
  const metadata = field("metadata")?.data.toString("utf8");
  return {
    bytes: file.data,
    contentType: file.contentType ?? field("contentType")?.data.toString("utf8") ?? "text/plain",
    cacheControl: `max-age=${seconds}`,
    userMetadata: metadata ? safeJson(metadata) : null,
  };
}

/**
 * The body, or "too large" once it passes `limit`. The rest is still read (and
 * dropped) before answering, so the connection can carry the next request.
 */
async function readLimited(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  if (size > limit) fail("EntityTooLarge");
  return Buffer.concat(chunks);
}

function decodeMetadata(value: string): unknown {
  return safeJson(Buffer.from(value, "base64").toString("utf8"));
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface Part {
  name: string | null;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
}

function splitMultipart(body: Buffer, boundary: string): Part[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    // Between "--boundary\r\n" and "\r\n--boundary".
    const chunk = body.subarray(start + delimiter.length + 2, next - 2);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = chunk.subarray(0, headerEnd).toString("utf8");
      const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
      parts.push({
        name: /\bname="([^"]*)"/i.exec(disposition)?.[1] ?? null,
        filename: /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null,
        contentType: /content-type:\s*([^\r\n]*)/i.exec(headers)?.[1]?.trim() ?? null,
        data: chunk.subarray(headerEnd + 4),
      });
    }
    start = next;
  }
  return parts;
}

function metadataFor(upload: Upload) {
  const now = new Date().toISOString();
  return {
    eTag: `"${createHash("md5").update(upload.bytes).digest("hex")}"`,
    size: upload.bytes.length,
    mimetype: upload.contentType,
    cacheControl: upload.cacheControl,
    lastModified: now,
    contentLength: upload.bytes.length,
    httpStatusCode: 200,
  };
}

// ── Running a statement as the caller ───────────────────────────────────────

/**
 * Runs `work` in a transaction as the caller, exactly as the real service
 * does, so row-level security decides. `afterRows` runs inside the
 * transaction once the rows are settled, to write or delete the bytes: if it
 * fails, the row change is rolled back too.
 */
/** What the real service tells the rules about a request. */
interface Scope {
  /** Its operation name (supabase/storage, src/http/routes/operations.ts). */
  operation: string;
  req: IncomingMessage;
}

async function asCaller<T>(
  claims: Claims | null,
  scope: Scope,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      await client.query(`set local role ${claims ? "authenticated" : "anon"}`);
      await client.query(
        `select set_config('request.jwt.claims', $1, true),
                set_config('request.headers', $2, true),
                set_config('request.method', $3, true),
                set_config('storage.operation', $4, true)`,
        [
          claims ? JSON.stringify(claims) : "",
          JSON.stringify(scope.req.headers),
          scope.req.method ?? "",
          scope.operation,
        ],
      );
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw translate(error);
    }
  } finally {
    client.release();
  }
}

/** Database errors as the storage service reports them. */
function translate(error: unknown): unknown {
  const code = (error as { code?: string }).code;
  if (code === "42501") return httpError("AccessDenied");
  if (code === "23505") return httpError("KeyAlreadyExists");
  if (code === "23503") return httpError("NoSuchBucket");
  return error;
}

function httpError(code: StorageCode): HttpError {
  try {
    fail(code);
  } catch (error) {
    return error as HttpError;
  }
}

interface ObjectRow {
  id: string;
  name: string;
  bucket_id: string;
  owner_id: string | null;
  created_at: Date;
  updated_at: Date;
  last_accessed_at: Date | null;
  metadata: Record<string, unknown> | null;
  user_metadata: unknown;
  version: string | null;
}

const OBJECT_COLUMNS =
  "id, name, bucket_id, owner_id, created_at, updated_at, last_accessed_at, metadata, user_metadata, version";

/** Inserts (or, with upsert, replaces) a row as whoever `client` is, then writes the bytes. */
async function store(
  client: PoolClient,
  bucket: Bucket,
  name: string,
  upload: Upload,
  owner: string | null,
  upsert: boolean,
): Promise<{ id: string }> {
  const id = randomUUID();
  const version = randomUUID();
  // No RETURNING: the real service does not need the row to be readable after an upload.
  await client.query(
    `insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata, version)
     values ($1, $2, $3, $4::uuid, $4::text, $5, $6, $7)
     ${upsert ? "on conflict (bucket_id, name) do update set metadata = excluded.metadata, user_metadata = excluded.user_metadata, version = excluded.version, updated_at = now()" : ""}`,
    [id, bucket.id, name, owner, metadataFor(upload), upload.userMetadata, version],
  );
  const path = filePath(bucket.id, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, upload.bytes);
  return { id };
}

async function readVisible(client: PoolClient, bucket: string, name: string): Promise<ObjectRow> {
  const { rows } = await client.query<ObjectRow>(
    `select ${OBJECT_COLUMNS} from storage.objects where bucket_id = $1 and name = $2`,
    [bucket, name],
  );
  if (!rows[0]) fail("NoSuchKey");
  return rows[0];
}

async function sendObject(res: Parameters<typeof sendBytes>[0], row: ObjectRow) {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath(row.bucket_id, row.name));
  } catch {
    fail("NoSuchKey");
  }
  const meta = row.metadata ?? {};
  sendBytes(res, 200, bytes, {
    "content-type": String(meta.mimetype ?? "application/octet-stream"),
    "cache-control": String(meta.cacheControl ?? "no-cache"),
    "content-length": String(bytes.length),
    etag: String(meta.eTag ?? ""),
    "last-modified": new Date(String(meta.lastModified ?? row.updated_at)).toUTCString(),
  });
}

// ── Signed URLs ──────────────────────────────────────────────────────────────

async function signToken(payload: Record<string, unknown>, seconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID, typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(seconds)))
    .sign(keys.privateKey);
}

async function checkToken(token: string | null, url: string, scope: "upload" | "download") {
  if (!token) fail("InvalidJWT", "Missing token");
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, keys.publicKey, { algorithms: ["ES256"] }));
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) fail("ExpiredToken");
    fail("InvalidJWT");
  }
  if (payload.url !== url || (payload.scope ?? "download") !== scope) fail("InvalidSignature");
  return payload;
}

const encodePath = (name: string) => name.split("/").map(encodeURIComponent).join("/");

// ── Routes ────────────────────────────────────────────────────────────────────

export const storageRoutes: Routes = async ({ req, res, url }) => {
  if (!url.pathname.startsWith(`${PREFIX}/`)) return false;
  const parts = segments(url.pathname.slice(PREFIX.length));
  const method = req.method ?? "GET";
  const [area, first, ...rest] = parts;

  // Public files and "transformed" ones (served as they are, as on the free plan).
  if (
    method === "GET" &&
    ((area === "object" && first === "public") ||
      (area === "render" && first === "image" && rest[0] === "public"))
  ) {
    const [bucketId, ...path] = area === "object" ? rest : rest.slice(1);
    const name = path.join("/");
    const { rows } = await pool.query<Bucket>(
      "select id, public from storage.buckets where id = $1 and public",
      [bucketId],
    );
    // A private bucket is not found at its public address.
    if (!rows[0]) fail("NoSuchBucket");
    const found = await pool.query<ObjectRow>(
      `select ${OBJECT_COLUMNS} from storage.objects where bucket_id = $1 and name = $2`,
      [bucketId, name],
    );
    if (!found.rows[0]) fail("NoSuchKey");
    await sendObject(res, found.rows[0]);
    return true;
  }

  if (area !== "object") {
    fail("InvalidRequest", `The local stand-in does not serve ${method} ${url.pathname}`);
  }

  // Signed upload URL: created with the caller's rights, used without a session.
  if (first === "upload" && rest[0] === "sign") {
    const [, bucketId = "", ...path] = rest;
    const name = path.join("/");
    checkKey(name);
    const bucket = await bucketById(bucketId);
    const upsert = req.headers["x-upsert"] === "true";

    if (method === "POST") {
      const claims = await caller(req);
      // The real service probes the upload as the caller when the URL is made:
      // an insert, or an upsert when the address may replace an existing file.
      await asCaller(
        claims,
        { operation: "storage.object.sign_upload_url", req },
        async (client) => {
          await client.query("savepoint probe");
          await client.query(
            `insert into storage.objects (bucket_id, name, owner, owner_id, metadata, version)
           values ($1, $2, $3::uuid, $3::text, '{}', $4)
           ${upsert ? "on conflict (bucket_id, name) do update set metadata = excluded.metadata, version = excluded.version" : ""}`,
            [bucket.id, name, claims?.sub ?? null, randomUUID()],
          );
          await client.query("rollback to savepoint probe");
        },
      );
      const token = await signToken(
        { url: `${bucket.id}/${name}`, owner: claims?.sub, upsert, scope: "upload" },
        SIGNED_UPLOAD_SECONDS,
      );
      send(res, 200, {
        url: `/object/upload/sign/${bucket.id}/${encodePath(name)}?token=${token}`,
        token,
      });
      return true;
    }
    if (method === "PUT") {
      const payload = await checkToken(
        url.searchParams.get("token"),
        `${bucket.id}/${name}`,
        "upload",
      );
      const upload = await readUpload(req, bucket);
      checkFile(bucket, upload.bytes.length, upload.contentType);
      const owner = typeof payload.owner === "string" ? payload.owner : null;
      // The token is the permission: the row is written by the service itself.
      const client = await pool.connect();
      try {
        await client.query("begin");
        await store(client, bucket, name, upload, owner, payload.upsert === true);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw translate(error);
      } finally {
        client.release();
      }
      send(res, 200, { Key: `${bucket.id}/${name}` });
      return true;
    }
  }

  // Signed download URLs.
  if (first === "sign") {
    const [bucketId = "", ...path] = rest;
    if (method === "GET") {
      const name = path.join("/");
      await checkToken(url.searchParams.get("token"), `${bucketId}/${name}`, "download");
      const found = await pool.query<ObjectRow>(
        `select ${OBJECT_COLUMNS} from storage.objects where bucket_id = $1 and name = $2`,
        [bucketId, name],
      );
      if (!found.rows[0]) fail("NoSuchKey");
      await sendObject(res, found.rows[0]);
      return true;
    }
    if (method === "POST") {
      const claims = await caller(req);
      await bucketById(bucketId);
      const body = safeJson((await readBody(req)).toString("utf8")) as {
        expiresIn?: number;
        paths?: string[];
      } | null;
      const expiresIn = Number(body?.expiresIn ?? 60);
      const sign = async (name: string) => {
        const token = await signToken({ url: `${bucketId}/${name}`, scope: "download" }, expiresIn);
        return `/object/sign/${bucketId}/${encodePath(name)}?token=${token}`;
      };
      if (path.length > 0) {
        const name = path.join("/");
        await asCaller(claims, { operation: "storage.object.sign", req }, (client) =>
          readVisible(client, bucketId, name),
        );
        send(res, 200, { signedURL: await sign(name) });
        return true;
      }
      const names = Array.isArray(body?.paths) ? body.paths.map(String) : [];
      const visible = await asCaller(
        claims,
        { operation: "storage.object.sign_many", req },
        async (client) => {
          const { rows } = await client.query<{ name: string }>(
            "select name from storage.objects where bucket_id = $1 and name = any($2)",
            [bucketId, names],
          );
          return new Set(rows.map((r) => r.name));
        },
      );
      send(
        res,
        200,
        await Promise.all(
          names.map(async (name) =>
            visible.has(name)
              ? { error: null, path: name, signedURL: await sign(name) }
              : {
                  error: "Either the object does not exist or you do not have access to it",
                  path: name,
                  signedURL: null,
                },
          ),
        ),
      );
      return true;
    }
  }

  if (first === "copy" && method === "POST") {
    const claims = await caller(req);
    const body = (safeJson((await readBody(req)).toString("utf8")) ?? {}) as Record<
      string,
      unknown
    >;
    const sourceBucket = String(body.bucketId ?? "");
    const targetBucket = await bucketById(String(body.destinationBucket ?? sourceBucket));
    const sourceKey = String(body.sourceKey ?? "");
    const targetKey = String(body.destinationKey ?? "");
    checkKey(sourceKey);
    checkKey(targetKey);
    await bucketById(sourceBucket);
    const id = await asCaller(claims, { operation: "storage.object.copy", req }, async (client) => {
      const source = await readVisible(client, sourceBucket, sourceKey);
      const meta = source.metadata ?? {};
      checkFile(targetBucket, Number(meta.size ?? 0), String(meta.mimetype ?? ""));
      const newId = randomUUID();
      await client.query(
        `insert into storage.objects (id, bucket_id, name, owner, owner_id, metadata, user_metadata, version)
         values ($1, $2, $3, $4::uuid, $4::text, $5, $6, $7)`,
        [
          newId,
          targetBucket.id,
          targetKey,
          claims?.sub ?? null,
          meta,
          source.user_metadata,
          randomUUID(),
        ],
      );
      const target = filePath(targetBucket.id, targetKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(filePath(sourceBucket, sourceKey)));
      return newId;
    });
    send(res, 200, { Id: id, Key: `${targetBucket.id}/${targetKey}` });
    return true;
  }

  if (first === "info" && method === "GET") {
    const [bucketId = "", ...path] = rest;
    const claims = await caller(req);
    const row = await asCaller(
      claims,
      { operation: "object.get_authenticated_info", req },
      (client) => readVisible(client, bucketId, path.join("/")),
    );
    const meta = row.metadata ?? {};
    send(res, 200, {
      id: row.id,
      version: row.version,
      name: row.name,
      bucket_id: row.bucket_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_accessed_at: row.last_accessed_at,
      size: meta.size ?? null,
      cache_control: meta.cacheControl ?? null,
      content_type: meta.mimetype ?? null,
      etag: meta.eTag ?? null,
      last_modified: meta.lastModified ?? null,
      metadata: row.user_metadata ?? null,
    });
    return true;
  }

  // Remove several files: only those the caller may delete go.
  if (method === "DELETE" && first && rest.length === 0) {
    const claims = await caller(req);
    await bucketById(first);
    const body = safeJson((await readBody(req)).toString("utf8")) as { prefixes?: string[] } | null;
    const names = Array.isArray(body?.prefixes) ? body.prefixes.map(String) : [];
    const removed = await asCaller(
      claims,
      { operation: "storage.object.delete_many", req },
      async (client) => {
        const { rows } = await client.query<ObjectRow>(
          `delete from storage.objects where bucket_id = $1 and name = any($2) returning ${OBJECT_COLUMNS}`,
          [first, names],
        );
        for (const row of rows) await rm(filePath(row.bucket_id, row.name), { force: true });
        return rows;
      },
    );
    send(res, 200, removed);
    return true;
  }

  // Download as the caller; upload and replace.
  const authenticatedRead = first === "authenticated";
  const [bucketId = "", ...path] = authenticatedRead ? rest : [first ?? "", ...rest];
  const name = path.join("/");
  if (!bucketId || !name) fail("InvalidRequest");

  if (method === "GET") {
    const claims = await caller(req);
    const row = await asCaller(
      claims,
      { operation: "storage.object.get_authenticated", req },
      (client) => readVisible(client, bucketId, name),
    );
    await sendObject(res, row);
    return true;
  }

  if (method === "POST" || method === "PUT") {
    checkKey(name);
    const claims = await caller(req);
    const bucket = await bucketById(bucketId);
    const upload = await readUpload(req, bucket);
    checkFile(bucket, upload.bytes.length, upload.contentType);
    const operation = method === "PUT" ? "storage.object.upload_update" : "storage.object.upload";
    const result = await asCaller(claims, { operation, req }, async (client) => {
      if (method === "PUT") {
        // Replacing needs the row to exist and the UPDATE rule to allow it.
        const updated = await client.query(
          `update storage.objects set metadata = $3, user_metadata = $4, version = $5, updated_at = now()
           where bucket_id = $1 and name = $2`,
          [bucket.id, name, metadataFor(upload), upload.userMetadata, randomUUID()],
        );
        if (updated.rowCount === 0) fail("NoSuchKey");
        const target = filePath(bucket.id, name);
        await writeFile(target, upload.bytes);
        return { id: "" };
      }
      return store(
        client,
        bucket,
        name,
        upload,
        claims?.sub ?? null,
        req.headers["x-upsert"] === "true",
      );
    });
    send(res, 200, { Id: result.id, Key: `${bucket.id}/${name}` });
    return true;
  }

  fail("InvalidRequest", `The local stand-in does not serve ${method} ${url.pathname}`);
};
