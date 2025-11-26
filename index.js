// index.js
// index.js
// Backend with posts, upload, likes, comments, Google reader sign-in, projects CRUD.
// Backend with posts, upload, likes, comments, Google reader sign-in, projects CRUD.


require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env.local" });
const express = require("express");
const express = require("express");
const cors = require("cors");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const { neon } = require("@neondatabase/serverless");
const { put } = require("@vercel/blob");
const { put } = require("@vercel/blob");
const { OAuth2Client } = require("google-auth-library");
const { OAuth2Client } = require("google-auth-library");


const connectionString = process.env.DATABASE_URL;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set in .env.local");
if (!connectionString) throw new Error("DATABASE_URL is not set in .env.local");


const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set in .env.local");
if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set in .env.local");


const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const isProd = process.env.NODE_ENV === "production";
const isProd = process.env.NODE_ENV === "production";


// ----- DB -----
// ----- DB -----
const sql = neon(connectionString);
const sql = neon(connectionString);


// ----- App -----
// ----- App -----
const app = express();
const app = express();
const PORT = process.env.PORT || 8080;
const PORT = process.env.PORT || 8080;


// ----- CORS (multi origin + optional vercel previews) -----
// ----- CORS (multi origin + optional vercel previews) -----
const RAW_ORIGINS =
const RAW_ORIGINS =
  (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "")
  (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .split(",")
    .map((s) => s.trim())
    .map((s) => s.trim())
    .filter(Boolean);
    .filter(Boolean);


const DEFAULTS = ["http://localhost:3000"];
const DEFAULTS = ["http://localhost:3000"];
const ALLOWED_SET = new Set([...DEFAULTS, ...RAW_ORIGINS]);
const ALLOWED_SET = new Set([...DEFAULTS, ...RAW_ORIGINS]);
const ALLOW_VERCEL_PREVIEWS =
const ALLOW_VERCEL_PREVIEWS =
  String(process.env.ALLOW_VERCEL_PREVIEWS || "true").toLowerCase() === "true";
  String(process.env.ALLOW_VERCEL_PREVIEWS || "true").toLowerCase() === "true";


app.use(
app.use(
  cors({
  cors({
    origin(origin, cb) {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (!origin) return cb(null, true);
      try {
      try {
        const u = new URL(origin);
        const u = new URL(origin);
        const norm = u.origin;
        const norm = u.origin;
        if (ALLOWED_SET.has(norm)) return cb(null, true);
        if (ALLOWED_SET.has(norm)) return cb(null, true);
        if (ALLOW_VERCEL_PREVIEWS && u.hostname.endsWith(".vercel.app"))
        if (ALLOW_VERCEL_PREVIEWS && u.hostname.endsWith(".vercel.app"))
          return cb(null, true);
          return cb(null, true);
        console.log(`CORS blocked origin: ${origin}`);
        console.log(`CORS blocked origin: ${origin}`);
        return cb(new Error("Not allowed by CORS"), false);
        return cb(new Error("Not allowed by CORS"), false);
      } catch {
      } catch {
        console.log(`CORS bad origin format: ${origin}`);
        console.log(`CORS bad origin format: ${origin}`);
        return cb(new Error("Not allowed by CORS"), false);
        return cb(new Error("Not allowed by CORS"), false);
      }
      }
    },
    },
    credentials: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
  })
);
);


// ----- Parsers -----
// ----- Parsers -----
app.use(cookieParser());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.raw({ type: "image/*", limit: "10mb" }));
app.use(express.raw({ type: "image/*", limit: "10mb" }));


// ----- Health -----
// ----- Health -----
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/health", (req, res) => res.json({ ok: true }));


// ----- Reader cookie helpers -----
// ----- Reader cookie helpers -----
function setReaderCookie(res, userId) {
function setReaderCookie(res, userId) {
  const secs = 7 * 24 * 60 * 60;
  const secs = 7 * 24 * 60 * 60;
  const cookie = [
  const cookie = [
    `reader-id=${encodeURIComponent(String(userId))}`,
    `reader-id=${encodeURIComponent(String(userId))}`,
    "Path=/",
    "Path=/",
    "HttpOnly",
    "HttpOnly",
    "Secure",
    "Secure",
    "SameSite=None",
    "SameSite=None",
    "Partitioned",
    "Partitioned",
    `Max-Age=${secs}`,
    `Max-Age=${secs}`,
  ].join("; ");
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
  res.setHeader("Set-Cookie", cookie);
}
}
function clearReaderCookie(res) {
function clearReaderCookie(res) {
  const cookie = [
  const cookie = [
    "reader-id=;",
    "reader-id=;",
    "Path=/",
    "Path=/",
    "HttpOnly",
    "HttpOnly",
    "Secure",
    "Secure",
    "SameSite=None",
    "SameSite=None",
    "Partitioned",
    "Partitioned",
    "Max-Age=0",
    "Max-Age=0",
  ].join("; ");
  ].join("; ");
  res.setHeader("Set-Cookie", cookie);
  res.setHeader("Set-Cookie", cookie);
}
}
async function getCurrentReaderId(req) {
async function getCurrentReaderId(req) {
  const raw = req.cookies["reader-id"];
  const raw = req.cookies["reader-id"];
  if (!raw) return null;
  if (!raw) return null;
  const id = Number(raw);
  const id = Number(raw);
  if (Number.isNaN(id)) return null;
  if (Number.isNaN(id)) return null;
  return id;
  return id;
}
}
function isAdmin(req) {
function isAdmin(req) {
  return Boolean(req.cookies["auth-token"]);
  return Boolean(req.cookies["auth-token"]);
}
}


// ---------------- Admin auth ----------------
// ---------------- Admin auth ----------------
app.post("/api/auth/login", async (req, res) => {
app.post("/api/auth/login", async (req, res) => {
  try {
  try {
    const { password } = req.body || {};
    const { password } = req.body || {};
    if (password === ADMIN_PASSWORD) {
    if (password === ADMIN_PASSWORD) {
      const token = crypto.randomBytes(32).toString("hex");
      const token = crypto.randomBytes(32).toString("hex");
      res.cookie("auth-token", token, {
      res.cookie("auth-token", token, {
        httpOnly: true,
        httpOnly: true,
        secure: isProd,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        sameSite: isProd ? "none" : "lax",
        maxAge: 24 * 60 * 60 * 1000,
        maxAge: 24 * 60 * 60 * 1000,
      });
      });
      return res.status(200).json({ success: true, message: "Login successful" });
      return res.status(200).json({ success: true, message: "Login successful" });
    }
    }
    return res.status(401).json({ success: false, error: "Invalid credentials" });
    return res.status(401).json({ success: false, error: "Invalid credentials" });
  } catch (e) {
  } catch (e) {
    console.error("Admin login error:", e);
    console.error("Admin login error:", e);
    res.status(500).json({ error: "An internal server error occurred" });
    res.status(500).json({ error: "An internal server error occurred" });
  }
  }
});
});
app.post("/api/auth/logout", (req, res) => {
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("auth-token", {
  res.clearCookie("auth-token", {
    httpOnly: true,
    httpOnly: true,
    secure: isProd,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    sameSite: isProd ? "none" : "lax",
  });
  });
  res.json({ success: true, message: "Logged out successfully" });
  res.json({ success: true, message: "Logged out successfully" });
});
});


// --------------- Reader auth (Google) ---------------
// --------------- Reader auth (Google) ---------------
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;


app.post("/api/auth/reader/google", async (req, res) => {
app.post("/api/auth/reader/google", async (req, res) => {
  try {
  try {
    if (!googleClient) return res.status(500).json({ error: "Missing GOOGLE_CLIENT_ID" });
    if (!googleClient) return res.status(500).json({ error: "Missing GOOGLE_CLIENT_ID" });
    const { idToken } = req.body || {};
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: "idToken required" });
    if (!idToken) return res.status(400).json({ error: "idToken required" });


    const ticket = await googleClient.verifyIdToken({
    const ticket = await googleClient.verifyIdToken({
      idToken,
      idToken,
      audience: GOOGLE_CLIENT_ID,
      audience: GOOGLE_CLIENT_ID,
    });
    });
    const payload = ticket.getPayload();
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return res.status(400).json({ error: "Invalid Google token" });
    if (!payload || !payload.sub) return res.status(400).json({ error: "Invalid Google token" });


    const google_id = payload.sub;
    const google_id = payload.sub;
    const email = payload.email || "";
    const email = payload.email || "";
    const name = payload.name || null;
    const name = payload.name || null;
    const avatar_url = payload.picture || null;
    const avatar_url = payload.picture || null;


    const existing = await sql`SELECT id FROM users WHERE google_id = ${google_id} LIMIT 1`;
    const existing = await sql`SELECT id FROM users WHERE google_id = ${google_id} LIMIT 1`;
    let userId;
    let userId;
    if (existing.length > 0) {
    if (existing.length > 0) {
      userId = existing[0].id;
      userId = existing[0].id;
      await sql`UPDATE users SET name = ${name}, avatar_url = ${avatar_url} WHERE id = ${userId}`;
      await sql`UPDATE users SET name = ${name}, avatar_url = ${avatar_url} WHERE id = ${userId}`;
    } else {
    } else {
      const inserted = await sql`
      const inserted = await sql`
        INSERT INTO users (google_id, email, name, avatar_url)
        INSERT INTO users (google_id, email, name, avatar_url)
        VALUES (${google_id}, ${email}, ${name}, ${avatar_url})
        VALUES (${google_id}, ${email}, ${name}, ${avatar_url})
        RETURNING id
        RETURNING id
      `;
      `;
      userId = inserted[0].id;
      userId = inserted[0].id;
    }
    }


    setReaderCookie(res, userId);
    setReaderCookie(res, userId);
    res.json({ user: { id: userId, name, email, avatar_url } });
    res.json({ user: { id: userId, name, email, avatar_url } });
  } catch (e) {
  } catch (e) {
    console.error("Reader Google sign-in error:", e);
    console.error("Reader Google sign-in error:", e);
    res.status(500).json({ error: "Failed to sign in" });
    res.status(500).json({ error: "Failed to sign in" });
  }
  }
});
});
app.get("/api/auth/reader/me", async (req, res) => {
app.get("/api/auth/reader/me", async (req, res) => {
  try {
  try {
    const readerId = await getCurrentReaderId(req);
    const readerId = await getCurrentReaderId(req);
    if (!readerId) return res.json({ user: null });
    if (!readerId) return res.json({ user: null });
    const rows = await sql`SELECT id, name, email, avatar_url FROM users WHERE id = ${readerId} LIMIT 1`;
    const rows = await sql`SELECT id, name, email, avatar_url FROM users WHERE id = ${readerId} LIMIT 1`;
    res.json({ user: rows[0] || null });
    res.json({ user: rows[0] || null });
  } catch (e) {
  } catch (e) {
    console.error("Reader me error:", e);
    console.error("Reader me error:", e);
    res.status(500).json({ error: "Failed to get current user" });
    res.status(500).json({ error: "Failed to get current user" });
  }
  }
});
});
app.post("/api/auth/reader/logout", async (req, res) => {
app.post("/api/auth/reader/logout", async (req, res) => {
  clearReaderCookie(res);
  clearReaderCookie(res);
  res.json({ success: true });
  res.json({ success: true });
});
});


// ---------------- Posts (with filters) ----------------
// ---------------- Posts (with filters) ----------------
function parseLimit(v, d = 20, max = 50) {
function parseLimit(v, d = 20, max = 50) {
  const n = parseInt(v, 10);
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return d;
  if (!Number.isFinite(n) || n <= 0) return d;
  return Math.min(n, max);
  return Math.min(n, max);
}
}
function parseOffset(v) {
function parseOffset(v) {
  const n = parseInt(v, 10);
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
  return n;
}
}


app.get("/api/posts", async (req, res) => {
app.get("/api/posts", async (req, res) => {
  try {
  try {
    const type = req.query.type ? String(req.query.type).trim() : null;
    const type = req.query.type ? String(req.query.type).trim() : null;
    const limit = parseLimit(req.query.limit, 20, 50);
    const limit = parseLimit(req.query.limit, 20, 50);
    const offset = parseOffset(req.query.offset);
    const offset = parseOffset(req.query.offset);
    let tag = null;
    let tag = null;
    if (req.query.tag) tag = String(req.query.tag).trim();
    if (req.query.tag) tag = String(req.query.tag).trim();
    else if (req.query.tags) {
    else if (req.query.tags) {
      const parts = String(req.query.tags).split(",").map((s) => s.trim()).filter(Boolean);
      const parts = String(req.query.tags).split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length) tag = parts[0];
      if (parts.length) tag = parts[0];
    }
    }
    const includeDrafts = isAdmin(req) && String(req.query.includeDrafts || "false") === "true";
    const includeDrafts = isAdmin(req) && String(req.query.includeDrafts || "false") === "true";


    let rows;
    let rows;
    if (type && tag) {
    if (type && tag) {
      rows = includeDrafts
      rows = includeDrafts
        ? await sql`SELECT * FROM posts WHERE type = ${type} AND (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        ? await sql`SELECT * FROM posts WHERE type = ${type} AND (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        : await sql`SELECT * FROM posts WHERE published = TRUE AND type = ${type} AND (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        : await sql`SELECT * FROM posts WHERE published = TRUE AND type = ${type} AND (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (type) {
    } else if (type) {
      rows = includeDrafts
      rows = includeDrafts
        ? await sql`SELECT * FROM posts WHERE type = ${type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        ? await sql`SELECT * FROM posts WHERE type = ${type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        : await sql`SELECT * FROM posts WHERE published = TRUE AND type = ${type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        : await sql`SELECT * FROM posts WHERE published = TRUE AND type = ${type} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else if (tag) {
    } else if (tag) {
      rows = includeDrafts
      rows = includeDrafts
        ? await sql`SELECT * FROM posts WHERE (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        ? await sql`SELECT * FROM posts WHERE (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        : await sql`SELECT * FROM posts WHERE published = TRUE AND (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        : await sql`SELECT * FROM posts WHERE published = TRUE AND (tags @> ARRAY[${tag}]::text[]) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else {
    } else {
      rows = includeDrafts
      rows = includeDrafts
        ? await sql`SELECT * FROM posts ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        ? await sql`SELECT * FROM posts ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        : await sql`SELECT * FROM posts WHERE published = TRUE ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        : await sql`SELECT * FROM posts WHERE published = TRUE ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    }
    }


    res.json(rows);
    res.json(rows);
  } catch (e) {
  } catch (e) {
    console.error("Error fetching posts:", e);
    console.error("Error fetching posts:", e);
    res.status(500).json({ error: "Failed to fetch posts" });
    res.status(500).json({ error: "Failed to fetch posts" });
  }
  }
});
});


app.get("/api/posts/featured", async (req, res) => {
app.get("/api/posts/featured", async (req, res) => {
  try {
  try {
    const limit = parseLimit(req.query.limit, 3, 12);
    const limit = parseLimit(req.query.limit, 3, 12);
    const rows = await sql`
    const rows = await sql`
      SELECT * FROM posts
      SELECT * FROM posts
      WHERE published = TRUE AND (tags @> ARRAY['home-featured']::text[])
      WHERE published = TRUE AND (tags @> ARRAY['home-featured']::text[])
      ORDER BY created_at DESC
      ORDER BY created_at DESC
      LIMIT ${limit}
      LIMIT ${limit}
    `;
    `;
    res.json(rows);
    res.json(rows);
  } catch (e) {
  } catch (e) {
    console.error("Error fetching featured posts:", e);
    console.error("Error fetching featured posts:", e);
    res.status(500).json({ error: "Failed to fetch featured posts" });
    res.status(500).json({ error: "Failed to fetch featured posts" });
  }
  }
});
});


app.get("/api/posts/:id", async (req, res) => {
app.get("/api/posts/:id", async (req, res) => {
  try {
  try {
    const id = Number(req.params.id);
    const id = Number(req.params.id);
    const rows = await sql`SELECT * FROM posts WHERE id = ${id}`;
    const rows = await sql`SELECT * FROM posts WHERE id = ${id}`;
    if (rows.length === 0) return res.status(404).json({ error: "Post not found" });
    if (rows.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(rows[0]);
    res.json(rows[0]);
  } catch (e) {
  } catch (e) {
    console.error("Error fetching post:", e);
    console.error("Error fetching post:", e);
    res.status(500).json({ error: "Failed to fetch post" });
    res.status(500).json({ error: "Failed to fetch post" });
  }
  }
});
});


app.get("/api/posts/slug/:slug", async (req, res) => {
app.get("/api/posts/slug/:slug", async (req, res) => {
  try {
  try {
    const { slug } = req.params;
    const { slug } = req.params;
    const rows = await sql`SELECT * FROM posts WHERE TRIM(slug) = TRIM(${slug})`;
    const rows = await sql`SELECT * FROM posts WHERE TRIM(slug) = TRIM(${slug})`;
    if (rows.length === 0) return res.status(404).json({ error: "Post not found" });
    if (rows.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(rows[0]);
    res.json(rows[0]);
  } catch (e) {
  } catch (e) {
    console.error("Error fetching post by slug:", e);
    console.error("Error fetching post by slug:", e);
    res.status(500).json({ error: "Failed to fetch post" });
    res.status(500).json({ error: "Failed to fetch post" });
  }
  }
});
});


app.post("/api/posts", async (req, res) => {
app.post("/api/posts", async (req, res) => {
  try {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: "Admin login required" });
    if (!isAdmin(req)) return res.status(401).json({ error: "Admin login required" });
    const {
    const {
      title,
      title,
      slug,
      slug,
      content = null,
      content = null,
      type = "article",
      type = "article",
      tags = [],
      tags = [],
      meta = {},
      meta = {},
      published = true,
      published = true,
    } = req.body || {};
    } = req.body || {};
    if (!title || !slug) return res.status(400).json({ error: "Title and slug are required" });
    if (!title || !slug) return res.status(400).json({ error: "Title and slug are required" });


    const inserted = await sql`
    const inserted = await sql`
      INSERT INTO posts (title, slug, content, type, tags, meta, published)
      INSERT INTO posts (title, slug, content, type, tags, meta, published)
      VALUES (
      VALUES (
        TRIM(${title}), TRIM(${slug}), ${content},
        TRIM(${title}), TRIM(${slug}), ${content},
        TRIM(${type}), ${Array.isArray(tags) ? tags : []},
        TRIM(${type}), ${Array.isArray(tags) ? tags : []},
        ${meta}::jsonb, ${Boolean(published)}
        ${meta}::jsonb, ${Boolean(published)}
      )
      )
      RETURNING *
      RETURNING *
    `;
    `;
    res.status(201).json(inserted[0]);
    res.status(201).json(inserted[0]);
  } catch (e) {
  } catch (e) {
    console.error("Error creating post:", e);
    console.error("Error creating post:", e);
    if (e.code === "23505") return res.status(409).json({ error: "A post with this slug already exists" });
    if (e.code === "23505") return res.status(409).json({ error: "A post with this slug already exists" });
    res.status(500).json({ error: "Failed to create post" });
    res.status(500).json({ error: "Failed to create post" });
  }
  }
});
});


app.put("/api/posts/:id", async (req, res) => {
app.put("/api/posts/:id", async (req, res) => {
  try {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: "Admin login required" });
    if (!isAdmin(req)) return res.status(401).json({ error: "Admin login required" });
    const id = Number(req.params.id);
    const id = Number(req.params.id);
    const {
    const {
      title, slug, content = null, type = "article",
      title, slug, content = null, type = "article",
      tags = [], meta = {}, published = true,
      tags = [], meta = {}, published = true,
    } = req.body || {};
    } = req.body || {};
    if (!title || !slug) return res.status(400).json({ error: "Title and slug are required" });
    if (!title || !slug) return res.status(400).json({ error: "Title and slug are required" });


    const updated = await sql`
    const updated = await sql`
      UPDATE posts
      UPDATE posts
      SET
      SET
        title = TRIM(${title}),
        title = TRIM(${title}),
        slug = TRIM(${slug}),
        slug = TRIM(${slug}),
        content = ${content},
        content = ${content},
        type = TRIM(${type}),
        type = TRIM(${type}),
        tags = ${Array.isArray(tags) ? tags : []},
        tags = ${Array.isArray(tags) ? tags : []},
        meta = ${meta}::jsonb,
        meta = ${meta}::jsonb,
        published = ${Boolean(published)},
        published = ${Boolean(published)},
        updated_at = NOW()
        updated_at = NOW()
      WHERE id = ${id}
      WHERE id = ${id}
      RETURNING *
      RETURNING *
    `;
    `;
    if (updated.length === 0) return res.status(404).json({ error: "Post not found" });
    if (updated.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(updated[0]);
    res.json(updated[0]);
  } catch (e) {
  } catch (e) {
    console.error("Error updating post:", e);
    console.error("Error updating post:", e);
    if (e.code === "23505") return res.status(409).json({ error: "A post with this slug already exists" });
    if (e.code === "23505") return res.status(409).json({ error: "A post with this slug already exists" });
    res.status(500).json({ error: "Failed to update post" });
    res.status(500).json({ error: "Failed to update post" });
  }
  }
});
});


app.delete("/api/posts/:id", async (req, res) => {
app.delete("/api/posts/:id", async (req, res) => {
  try {
  try {
    if (!isAdmin(req)) return res.status(401).json({ error: "Admin login required" });
    if (!isAdmin(req)) return res.status(401).json({ error: "Admin login required" });
    const id = Number(req.params.id);
    const id = Number(req.params.id);
    const deleted = await sql`DELETE FROM posts WHERE id = ${id} RETURNING *`;
    const deleted = await sql`DELETE FROM posts WHERE id = ${id} RETURNING *`;
    if (deleted.length === 0) return res.status(404).json({ error: "Post not found" });
    if (deleted.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(deleted[0]);
    res.json(deleted[0]);
  } catch (e) {
  } catch (e) {
    console.error("Error deleting post:", e);
    console.error("Error deleting post:", e);
    res.status(500).json({ error: "Failed to delete post" });
    res.status(500).json({ error: "Failed to delete post" });
  }
  }
});
});


// ---------------- Upload ----------------
// ---------------- Upload ----------------
app.post("/api/upload", async (req, res) => {
app.post("/api/upload", async (req, res) => {
  const filename = req.query.filename;
  const filename = req.query.filename;
  const fileBody = req.body;
  const fileBody = req.body;
  if (!filename || !fileBody) return res.status(400).json({ error: "Filename and file body are required." });
  if (!filename || !fileBody) return res.status(400).json({ error: "Filename and file body are required." });
  try {
  try {
    const blob = await put(filename, fileBody, { access: "public", addRandomSuffix: true });
    const blob = await put(filename, fileBody, { access: "public", addRandomSuffix: true });
    res.json(blob);
    res.json(blob);
  } catch (e) {
  } catch (e) {
    console.error("Error uploading file:", e);
    console.error("Error uploading file:", e);
    res.status(500).json({ error: "Failed to upload file." });
    res.status(500).json({ error: "Failed to upload file." });
  }
  }
});
});


// ---------------- Likes ----------------
// ---------------- Likes ----------------
app.get("/api/posts/:id/likes", async (req, res) => {
app.get("/api/posts/:id/likes", async (req, res) => {
  try {
  try {
    const postId = Number(req.params.id);
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const count = countRows[0]?.count || 0;
    const count = countRows[0]?.count || 0;
    let liked = false;
    let liked = false;
    const readerId = await getCurrentReaderId(req);
    const readerId = await getCurrentReaderId(req);
    if (readerId) {
    if (readerId) {
      const exists = await sql`SELECT 1 FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;
      const exists = await sql`SELECT 1 FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;
      liked = exists.length > 0;
      liked = exists.length > 0;
    }
    }
    res.json({ count, liked });
    res.json({ count, liked });
  } catch (e) {
  } catch (e) {
    console.error("Error fetching likes:", e);
    console.error("Error fetching likes:", e);
    res.status(500).json({ error: "Failed to fetch likes" });
    res.status(500).json({ error: "Failed to fetch likes" });
  }
  }
});
});
app.post("/api/posts/:id/like", async (req, res) => {
app.post("/api/posts/:id/like", async (req, res) => {
  try {
  try {
    const postId = Number(req.params.id);
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    const readerId = await getCurrentReaderId(req);
    const readerId = await getCurrentReaderId(req);
    if (!readerId) return res.status(401).json({ error: "Login required for likes" });
    if (!readerId) return res.status(401).json({ error: "Login required for likes" });
    const existing = await sql`SELECT id FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;
    const existing = await sql`SELECT id FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;
    let liked;
    let liked;
    if (existing.length > 0) {
    if (existing.length > 0) {
      await sql`DELETE FROM post_likes WHERE id = ${existing[0].id}`;
      await sql`DELETE FROM post_likes WHERE id = ${existing[0].id}`;
      liked = false;
      liked = false;
    } else {
    } else {
      await sql`INSERT INTO post_likes (post_id, user_id) VALUES (${postId}, ${readerId})`;
      await sql`INSERT INTO post_likes (post_id, user_id) VALUES (${postId}, ${readerId})`;
      liked = true;
      liked = true;
    }
    }
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const count = countRows[0]?.count || 0;
    const count = countRows[0]?.count || 0;
    res.json({ liked, count });
    res.json({ liked, count });
  } catch (e) {
  } catch (e) {
    console.error("Error updating like:", e);
    console.error("Error updating like:", e);
    res.status(500).json({ error: "Failed to update like" });
    res.status(500).json({ error: "Failed to update like" });
  }
  }
});
});


// ---------------- Comments ----------------
// ---------------- Comments ----------------
app.get("/api/posts/:id/comments", async (req, res) => {
app.get("/api/posts/:id/comments", async (req, res) => {
  try {
  try {
    const postId = Number(req.params.id);
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    const rows = await sql`
    const rows = await sql`
      SELECT
      SELECT
        c.id, c.post_id, c.parent_id, c.content, c.created_at, c.updated_at,
        c.id, c.post_id, c.parent_id, c.content, c.created_at, c.updated_at,
        u.id AS user_id, u.name AS user_name, u.avatar_url AS user_avatar_url
        u.id AS user_id, u.name AS user_name, u.avatar_url AS user_avatar_url
      FROM comments c
      FROM comments c
      JOIN users u ON u.id = c.user_id
      JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ${postId}
      WHERE c.post_id = ${postId}
      ORDER BY c.created_at ASC
      ORDER BY c.created_at ASC
    `;
    `;
    res.json(rows);
    res.json(rows);
  } catch (e) {
  } catch (e) {
    console.error("Error fetching comments:", e);
    console.error("Error fetching comments:", e);
    res.status(500).json({ error: "Failed to fetch comments" });
    res.status(500).json({ error: "Failed to fetch comments" });
  }
  }
});
});
app.post("/api/posts/:id/comments", async (req, res) => {
app.post("/api/posts/:id/comments", async (req, res) => {
  try {
  try {
    const postId = Number(req.params.id);
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });
    const readerId = await getCurrentReaderId(req);
    const readerId = await getCurrentReaderId(req);
    if (!readerId) return res.status(401).json({ error: "Login required to comment" });
    if (!readerId) return res.status(401).json({ error: "Login required to comment" });
    const { content, parentId } = req.body || {};
    const { content, parentId } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: "Content is required" });
    if (!content || !String(content).trim()) return res.status(400).json({ error: "Content is required" });
    const inserted = await sql`
    const inserted = await sql`
      INSERT INTO comments (post_id, user_id, parent_id, content)
      INSERT INTO comments (post_id, user_id, parent_id, content)
      VALUES (${postId}, ${readerId}, ${parentId || null}, ${content})
      VALUES (${postId}, ${readerId}, ${parentId || null}, ${content})
      RETURNING id, post_id, parent_id, content, created_at, updated_at
      RETURNING id, post_id, parent_id, content, created_at, updated_at
    `;
    `;
    const comment = inserted[0];
    const comment = inserted[0];
    const userRows = await sql`SELECT id, name, avatar_url FROM users WHERE id = ${readerId} LIMIT 1`;
    const userRows = await sql`SELECT id, name, avatar_url FROM users WHERE id = ${readerId} LIMIT 1`;
    const user = userRows[0] || null;
    const user = userRows[0] || null;
    res.status(201).json({ ...comment, user });
    res.status(201).json({ ...comment, user });
  } catch (e) {
  } catch (e) {
    console.error("Error creating comment:", e);
    console.error("Error creating comment:", e);
    res.status(500).json({ error: "Failed to create comment" });
    res.status(500).json({ error: "Failed to create comment" });
  }
  }
});
});


// ---------------- Projects ----------------
// ---------------- Projects ----------------
app.get("/api/projects", async (req, res) => {
app.get("/api/projects", async (req, res) => {
  try {
  try {
    const rows = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
    const rows = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
    res.json(rows);
    res.json(rows);
  } catch (e) {
  } catch (e) {
    console.error("Error fetching projects:", e);
    console.error("Error fetching projects:", e);
    res.status(500).json({ error: "Failed to fetch projects" });
    res.status(500).json({ error: "Failed to fetch projects" });
  }
  }
});
});


// ----- Start (local dev) -----
// ----- Start (local dev) -----
if (require.main === module) {
if (require.main === module) {
  app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
  app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
}
}
module.exports = app;
module.exports = app;
