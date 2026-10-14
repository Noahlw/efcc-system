import { spawnSync } from "node:child_process";
import path from "node:path";

export const git = (
  root: string,
  args: string[],
  env: Record<string, string | undefined> = process.env
): Buffer => {
  // The app augments ProcessEnv with required NODE_ENV; native Git does not require that key.
  const result = spawnSync("git", args, {
    cwd: root,
    env: env as NodeJS.ProcessEnv,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git ${args[0]} failed`, { cause: result.error });
  }
  return result.stdout;
};

const privatePath =
  /(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.wrangler|\.scratch|\.cache|\.state|\.auth|\.d1|playwright-report|test-results|blob-report|storage-state|storageState|auth-state|artifacts|traces|sessions)(?:\/|$)/iu;
const privateExtension = /\.(?:sqlite(?:3)?|db|db-wal|db-shm|har|zip|trace)$/iu;
const sqliteMagic = Buffer.from("SQLite format 3\0");
const archiveMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const opaqueByteOrders = [Buffer.from([0xff, 0xfe]), Buffer.from([0xfe, 0xff])];

const containsPrivateRecords = (node: unknown): boolean => {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(containsPrivateRecords);
  }
  if (
    "cookies" in node ||
    ("suites" in node && "stats" in node && "config" in node)
  ) {
    return true;
  }
  if (
    Object.entries(node).some(
      ([key, entry]) =>
        /^(?:access_?token|refresh_?token|session_?token|id_?token|password_?hash|password|secret|cookie|authorization)$/iu.test(
          key
        ) &&
        typeof entry === "string" &&
        entry.length > 0
    )
  ) {
    return true;
  }
  if (
    "token" in node &&
    typeof node.token === "string" &&
    Object.keys(node).some((key) => /^(?:user_?id|expires_?at)$/iu.test(key))
  ) {
    return true;
  }
  const contact = Object.entries(node).some(
    ([key, entry]) =>
      /^(?:email|phone|phone_?number|hkid|member_?id)$/iu.test(key) &&
      typeof entry === "string"
  );
  const person = Object.keys(node).some((key) =>
    /^(?:name|full_?name|first_?name|last_?name|id|address|date_?of_?birth)$/iu.test(
      key
    )
  );
  return (
    (contact && person) || Object.values(node).some(containsPrivateRecords)
  );
};

const placeholderLine = (line: string): boolean => {
  if (!line.trim() || line.trimStart().startsWith("#")) {
    return true;
  }
  const value = line.slice(line.indexOf("=") + 1).trim();
  return (
    line.includes("=") &&
    (/^(?:replace-with-|YOUR_|<[^>]+>$)/u.test(value) ||
      /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(value))
  );
};

const persistedText = (text: string): boolean => {
  const structuredAuth =
    /^(?:cookies|origins|access_token|refresh_token|session_token):/imu.test(
      text
    );
  const rawReport =
    /^\s*<!doctype html/iu.test(text) && /playwrightReportBase64/u.test(text);
  const sqlDump =
    /^\s*(?:--[^\n]*\n\s*)*(?:CREATE|BEGIN|INSERT|PRAGMA)\b/iu.test(text) &&
    /INSERT\s+INTO\s+["`']?(?:session|member|user)["`']?\s*\([^;]*\)\s*VALUES/iu.test(
      text
    );
  const [header = ""] = text.split(/\r?\n/u, 1);
  const columns = header
    .split(/[,;\t]/u)
    .map((column) => column.trim().replaceAll(/^"|"$/gu, ""));
  const csv =
    columns.length > 1 &&
    columns.every((column) => /^[a-z][a-z_ ]*$/iu.test(column)) &&
    /(?:email|phone|member.?id)/iu.test(header) &&
    /(?:full.?name|name|address)/iu.test(header);
  return structuredAuth || rawReport || sqlDump || csv;
};

const inspectStructuredSource = (name: string, text: string): void => {
  // Inspect data, not executable TS inputs. JSONC config must work before dependency bootstrap.
  const candidate = text.replace(
    /^\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)\s*)*/u,
    ""
  );
  if (
    !/^\s*(?:\{|\[(?=\s*(?:["{[\]\d-]|true\b|false\b|null\b)))/u.test(candidate)
  ) {
    return;
  }
  // Keep lexical strings intact: URLs, escaped private values and string commas are data.
  const structured = candidate
    .replaceAll(
      /"(?:\\[\s\S]|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/gu,
      (token: string) => (token.startsWith('"') ? token : "")
    )
    .replaceAll(/"(?:\\[\s\S]|[^"\\])*"|,\s*(?=[}\]])/gu, (token: string) =>
      token.startsWith('"') ? token : ""
    );
  let record: unknown;
  try {
    record = JSON.parse(structured);
  } catch {
    throw new Error(`Unclassified structured source: ${name}`);
  }
  if (containsPrivateRecords(record)) {
    throw new Error(`Private structured source: ${name}`);
  }
};

export const assertSourcePrivacy = (
  name: string,
  bytes: Buffer,
  mode = "100644"
): void => {
  if (
    mode === "120000" ||
    path.isAbsolute(name) ||
    name.split(/[\\/]/u).some((part) => part === ".." || part === ".git")
  ) {
    throw new Error(`Unsafe source path: ${name}`);
  }
  if (bytes.subarray(0, sqliteMagic.length).equals(sqliteMagic)) {
    throw new Error(`Private database source: ${name}`);
  }
  if (bytes.subarray(0, archiveMagic.length).equals(archiveMagic)) {
    throw new Error(`Private archive source: ${name}`);
  }
  if (
    opaqueByteOrders.some((magic) =>
      bytes.subarray(0, magic.length).equals(magic)
    )
  ) {
    throw new Error(`Unsupported opaque source encoding: ${name}`);
  }
  const text = bytes.toString("utf-8").replace(/^\uFEFF/u, "");
  if (
    /^\s*(?:\/\/[^\s]*:)?_auth(?:Token)?\s*=/imu.test(text) ||
    /^Authorization:\s*(?:Bearer|Basic)\s+\S+/imu.test(text)
  ) {
    throw new Error(`Private credential source: ${name}`);
  }
  if (
    name.endsWith(".npmrc") &&
    (/^\s*(?:\/\/[^\s]*:)?(?:_password|password|username)\s*=/imu.test(text) ||
      /https?:\/\/[^/\s]+:[^@\s]+@/u.test(text) ||
      /\$\{[^}]+\}/u.test(text))
  ) {
    throw new Error(`Private registry configuration: ${name}`);
  }
  if (
    privatePath.test(name) &&
    !(name.endsWith(".example") && text.split(/\r?\n/u).every(placeholderLine))
  ) {
    throw new Error(`Private variable or state source: ${name}`);
  }
  if (privateExtension.test(name) || persistedText(text)) {
    throw new Error(`Private artifact source: ${name}`);
  }
  inspectStructuredSource(name, text);
};

export const indexIdentity = (
  root: string,
  env: Record<string, string | undefined> = process.env
): string => git(root, ["write-tree"], env).toString().trim();

export const assertIndexUnchanged = (
  root: string,
  identity: string,
  env: Record<string, string | undefined> = process.env
): void => {
  if (indexIdentity(root, env) !== identity) {
    throw new Error(
      "Git index drifted during qualification; rerun the staged gate"
    );
  }
};
