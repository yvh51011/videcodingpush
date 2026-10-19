const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = 3000;

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv(path.join(ROOT, ".env"));
const APP_ID = env.oxford_app_id;
const APP_KEY = env.oxford_app_key;
const BASE_URL =
  env.oxford_base_url || "https://od-api-sandbox.oxforddictionaries.com/api/v2";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function proxyOxford(reqPath, res) {
  if (!APP_ID || !APP_KEY) {
    sendJson(res, 500, {
      error: ".env에 oxford_app_id / oxford_app_key가 없습니다.",
    });
    return;
  }

  const target = new URL(BASE_URL.replace(/\/$/, "") + reqPath);
  const options = {
    hostname: target.hostname,
    path: target.pathname + target.search,
    method: "GET",
    headers: {
      Accept: "application/json",
      app_id: APP_ID,
      app_key: APP_KEY,
    },
  };

  https
    .get(options, (upstream) => {
      let raw = "";
      upstream.on("data", (chunk) => {
        raw += chunk;
      });
      upstream.on("end", () => {
        res.writeHead(upstream.statusCode || 502, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(raw);
      });
    })
    .on("error", (err) => {
      sendJson(res, 502, { error: "Oxford API 연결 실패: " + err.message });
    });
}

function serveStatic(reqPath, res) {
  let filePath = reqPath === "/" ? "/dictionary.html" : reqPath;
  filePath = path.normalize(path.join(ROOT, decodeURIComponent(filePath)));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // /api/oxford/entries/en-gb/apple  →  Oxford /entries/en-gb/apple
  if (url.pathname.startsWith("/api/oxford/")) {
    const oxfordPath = url.pathname.replace(/^\/api\/oxford/, "") + url.search;
    proxyOxford(oxfordPath, res);
    return;
  }

  serveStatic(url.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Oxford dictionary server: http://localhost:${PORT}`);
  console.log(`Dictionary UI:            http://localhost:${PORT}/dictionary.html`);
  if (!APP_ID || !APP_KEY) {
    console.warn("경고: .env에 oxford_app_id / oxford_app_key를 넣어 주세요.");
  }
});
