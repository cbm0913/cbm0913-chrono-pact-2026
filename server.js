const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const rooms = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function makeCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function makeToken() {
  return crypto.randomBytes(18).toString("hex");
}

function lanAddresses() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

function sendEvent(res, payload) {
  if (!res || res.writableEnded) return;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (error) {
    // The client is gone; the close handler will clean up.
  }
}

function notify(room, role, payload) {
  const res = role === "host" ? room.hostRes : room.guestRes;
  sendEvent(res, payload);
}

function relay(room, from, message) {
  const target = from === "host" ? room.guestRes : room.hostRes;
  if (from === "host" && message && message.type === "state") {
    room.lastState = message;
  }
  if (target) sendEvent(target, { type: "message", from, payload: message });
}

function findRole(room, token) {
  if (!room || !token) return null;
  if (token === room.hostToken) return "host";
  if (token === room.guestToken) return "guest";
  return null;
}

function createRoom() {
  const code = makeCode();
  const room = {
    code,
    hostToken: makeToken(),
    guestToken: null,
    hostRes: null,
    guestRes: null,
    lastState: null,
    createdAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch (error) {
    return json(res, 400, { error: "bad url" });
  }
  let file;
  if (pathname === "/" || pathname === "/index.html") file = "index.html";
  else if (pathname === "/pvp" || pathname === "/pvp.html") file = "pvp.html";
  else return json(res, 404, { error: "not found" });

  const full = path.join(ROOT, file);
  fs.readFile(full, (error, data) => {
    if (error) return json(res, 404, { error: "not found" });
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(data);
  });
}

function handleEvents(req, res, query) {
  const code = query.get("code");
  const token = query.get("token");
  const room = rooms.get(code);
  const role = findRole(room, token);
  if (!room || !role) return json(res, 403, { error: "invalid room or token" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 3000\n\n");
  sendEvent(res, { type: "hello", role, code });

  if (role === "host") {
    if (room.hostRes && room.hostRes !== res) {
      try { room.hostRes.end(); } catch (error) {}
    }
    room.hostRes = res;
    if (room.guestToken) notify(room, "host", { type: "guest-joined" });
  } else {
    if (room.guestRes && room.guestRes !== res) {
      try { room.guestRes.end(); } catch (error) {}
    }
    room.guestRes = res;
    notify(room, "host", { type: "guest-joined" });
    if (room.lastState) sendEvent(res, { type: "message", from: "host", payload: room.lastState });
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    if (role === "host") {
      if (room.hostRes === res) room.hostRes = null;
      notify(room, "guest", { type: "host-left" });
    } else {
      if (room.guestRes === res) room.guestRes = null;
      notify(room, "host", { type: "guest-left" });
    }
  });
}

async function handleCreate(req, res) {
  const room = createRoom();
  json(res, 200, { code: room.code, token: room.hostToken });
}

async function handleJoin(req, res) {
  const body = await readBody(req);
  const room = rooms.get(String(body.code || "").trim());
  if (!room) return json(res, 404, { error: "房间不存在" });
  if (room.guestToken) return json(res, 409, { error: "房间已满" });
  room.guestToken = makeToken();
  notify(room, "host", { type: "guest-joined" });
  json(res, 200, { code: room.code, token: room.guestToken });
}

async function handleSend(req, res) {
  const body = await readBody(req);
  const room = rooms.get(String(body.code || "").trim());
  const role = findRole(room, body.token);
  if (!room || !role) return json(res, 403, { error: "invalid room or token" });
  if (!body.message || typeof body.message !== "object") return json(res, 400, { error: "missing message" });
  relay(room, role, body.message);
  json(res, 200, { ok: true });
}

async function handleLeave(req, res) {
  const body = await readBody(req);
  const room = rooms.get(String(body.code || "").trim());
  const role = findRole(room, body.token);
  if (room && role) {
    notify(room, role === "host" ? "guest" : "host", { type: role === "host" ? "host-left" : "guest-left" });
  }
  json(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/api/create") return handleCreate(req, res);
    if (req.method === "POST" && url.pathname === "/api/join") return handleJoin(req, res);
    if (req.method === "POST" && url.pathname === "/api/send") return handleSend(req, res);
    if (req.method === "POST" && url.pathname === "/api/leave") return handleLeave(req, res);
    if (req.method === "GET" && url.pathname === "/api/events") return handleEvents(req, res, url.searchParams);
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, rooms: rooms.size });
    if (req.method === "GET" && url.pathname === "/api/network") {
      return json(res, 200, {
        ips: lanAddresses(),
        port: PORT,
        publicUrl: process.env.PUBLIC_URL || ""
      });
    }
    if (req.method === "GET" && url.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    if (req.method === "GET") return serveStatic(req, res);
    json(res, 405, { error: "method not allowed" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "server error" });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.hostRes && !room.guestRes && now - room.createdAt > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanAddresses();
  console.log(`时之契 PvP server: http://localhost:${PORT}`);
  for (const ip of ips) console.log(`LAN: http://${ip}:${PORT}/pvp.html`);
  if (!ips.length) console.log("LAN: no external IPv4 address found");
  console.log(`AI mode: http://localhost:${PORT}/`);
});
