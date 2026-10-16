import { readFile, realpath } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".md": "text/plain; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function isInside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export function createServer(bookRoot = import.meta.dirname) {
  const root = path.resolve(bookRoot);
  return http.createServer(async (req, res) => {
    try {
      const rawPathname = (req.url || "/").split(/[?#]/, 1)[0];
      if (!rawPathname.startsWith("/")) {
        throw new Error("outside root");
      }
      const pathname = decodeURIComponent(rawPathname);
      const resolvedRoot = await realpath(root);
      const requestedFile = path.resolve(
        resolvedRoot,
        `.${pathname === "/" ? "/index.html" : pathname}`
      );
      if (!isInside(resolvedRoot, requestedFile)) {
        throw new Error("outside root");
      }
      const file = await realpath(requestedFile);
      if (!isInside(resolvedRoot, file)) {
        throw new Error("outside root");
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type":
          types[path.extname(requestedFile)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}

if (import.meta.main) {
  createServer().listen(4323, "127.0.0.1", () =>
    console.log("Design book: http://127.0.0.1:4323")
  );
}
