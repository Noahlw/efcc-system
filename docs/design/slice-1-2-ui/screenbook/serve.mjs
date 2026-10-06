import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const root = import.meta.dirname;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".md": "text/plain; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname
      );
      const file = path.resolve(
        root,
        `.${pathname === "/" ? "/index.html" : pathname}`
      );
      if (!file.startsWith(root)) {
        throw new Error("outside root");
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4323, "127.0.0.1", () =>
    console.log("Design book: http://127.0.0.1:4323")
  );
