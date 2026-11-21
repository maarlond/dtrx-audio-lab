"use strict";
// Local static server for browser checks. Supports HTTP ranges for seeking MP3 files.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".mp3": "audio/mpeg",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".lrc": "text/plain",
};
http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const headers = {
        "Content-Type":
          types[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Accept-Ranges": "bytes",
      };
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
      let start = 0,
        end = stat.size - 1,
        code = 200;
      if (match) {
        start = Number(match[1]);
        end = match[2] ? Math.min(end, Number(match[2])) : end;
        code = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      }
      if (start > end) {
        res.writeHead(416).end();
        return;
      }
      headers["Content-Length"] = end - start + 1;
      res.writeHead(code, headers);
      fs.createReadStream(file, { start, end }).pipe(res);
    });
  })
  .listen(Number(process.env.DTRX_TEST_PORT || 8765), "127.0.0.1");
