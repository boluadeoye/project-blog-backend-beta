// index.js
// Complete backend (Express) with posts, upload, likes, comments, and Google reader sign-in.
// Drop-in replacement. Requires: google-auth-library, cookie-parser, @neondatabase/serverless, @vercel/blob

require("dotenv").config({ path: ".env.local" });
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const { put } = require("@vercel/blob");
const { OAuth2Client } = require("google-auth-library");

// ----- Config checks -----
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set in .env.local");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set in .env.local");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ""; // for reader sign-in

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || ""; // optional prod origin, e.g. https://your-frontend.vercel.app
const isProd = process.env.NODE_ENV === "production";

// ----- DB client -----
const sql = neon(connectionString);

// ----- App -----
const app = express();
const PORT = process.env.PORT || 8080;

// ----- CORS -----
const allowedOrigins = ["http://localhost:3000"];
if (FRONTEND_ORIGIN) allowedOrigins.push(FRONTEND_ORIGIN);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      console.log(`CORS blocked request from: ${origin}`);
      return cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// ----- Parsers -----
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.raw({ type: "image/*", limit: "10mb" }));

// ----- Helpers -----
// Health
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Resolve current reader (Google-authenticated) by cookie
async function getCurrentReaderId(req) {
  const raw = req.cookies["reader-id"];
  if (!raw) return null;
  const id = Number(raw);
  if (Number.isNaN(id)) return null;
  return id;
}

// ----- Admin auth (password) -----
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (password === ADMIN_PASSWORD) {
      const token = crypto.randomBytes(32).toString("hex");
      res.cookie("auth-token", token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        maxAge: 24 * 60 * 60 * 1000
      });
      return res.status(200).json({ success: true, message: "Login successful" });
    }
    return res.status(401).json({ success: false, error: "Invalid credentials" });
  } catch (e) {
    console.error("Admin login error:", e);
    res.status(500).json({ error: "An internal server error occurred" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("auth-token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });
  res.json({ success: true, message: "Logged out successfully" });
});

// ----- Reader auth (Google) -----
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Verify Google ID token, upsert user, set reader cookie
app.post("/api/auth/reader/google", async (req, res) => {
  try {
    if (!googleClient) return res.status(500).json({ error: "Missing GOOGLE_CLIENT_ID" });
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: "idToken required" });

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) return res.status(400).json({ error: "Invalid Google token" });

    const google_id = payload.sub;
    const email = payload.email || "";
    const name = payload.name || null;
    const avatar_url = payload.picture || null;

    const existing = await sql`SELECT id FROM users WHERE google_id = ${google_id} LIMIT 1`;
    let userId;

    if (existing.length > 0) {
      userId = existing[0].id;
      await sql`
        UPDATE users
        SET name = ${name}, avatar_url = ${avatar_url}
        WHERE id = ${userId}
      `;
    } else {
      const inserted = await sql`
        INSERT INTO users (google_id, email, name, avatar_url)
        VALUES (${google_id}, ${email}, ${name}, ${avatar_url})
        RETURNING id
      `;
      userId = inserted[0].id;
    }

    res.cookie("reader-id", String(userId), {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ user: { id: userId, name, email, avatar_url } });
  } catch (e) {
    console.error("Reader Google sign-in error:", e);
    res.status(500).json({ error: "Failed to sign in" });
  }
});

// Current reader (if any)
app.get("/api/auth/reader/me", async (req, res) => {
  try {
    const readerId = await getCurrentReaderId(req);
    if (!readerId) return res.json({ user: null });
    const rows = await sql`
      SELECT id, name, email, avatar_url
      FROM users
      WHERE id = ${readerId}
      LIMIT 1
    `;
    const user = rows[0] || null;
    res.json({ user });
  } catch (e) {
    console.error("Reader me error:", e);
    res.status(500).json({ error: "Failed to get current user" });
  }
});

app.post("/api/auth/reader/logout", async (req, res) => {
  res.clearCookie("reader-id", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });
  res.json({ success: true });
});

// ----- Posts (CRUD + featured) -----
app.get("/api/posts", async (req, res) => {
  try {
    const posts = await sql`SELECT * FROM posts ORDER BY created_at DESC`;
    res.json(posts);
  } catch (e) {
    console.error("Error fetching posts:", e);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

app.get("/api/posts/featured", async (req, res) => {
  try {
    const posts = await sql`
      SELECT * FROM posts
      ORDER BY created_at DESC
      LIMIT 3
    `;
    res.json(posts);
  } catch (e) {
    console.error("Error fetching featured posts:", e);
    res.status(500).json({ error: "Failed to fetch featured posts" });
  }
});

app.get("/api/posts/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const post = await sql`SELECT * FROM posts WHERE id = ${id}`;
    if (post.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(post[0]);
  } catch (e) {
    console.error("Error fetching post:", e);
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

app.get("/api/posts/slug/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await sql`SELECT * FROM posts WHERE TRIM(slug) = TRIM(${slug})`;
    if (post.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(post[0]);
  } catch (e) {
    console.error("Error fetching post by slug:", e);
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

app.post("/api/posts", async (req, res) => {
  try {
    const { title, slug, content } = req.body || {};
    if (!title || !slug) return res.status(400).json({ error: "Title and slug are required" });
    const inserted = await sql`
      INSERT INTO posts (title, slug, content)
      VALUES (TRIM(${title}), TRIM(${slug}), TRIM(${content}))
      RETURNING *
    `;
    res.status(201).json(inserted[0]);
  } catch (e) {
    console.error("Error creating post:", e);
    if (e.code === "23505") return res.status(409).json({ error: "A post with this slug already exists" });
    res.status(500).json({ error: "Failed to create post" });
  }
});

app.put("/api/posts/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { title, slug, content } = req.body || {};
    if (!title || !slug) return res.status(400).json({ error: "Title and slug are required" });
    const updated = await sql`
      UPDATE posts
      SET title = TRIM(${title}), slug = TRIM(${slug}), content = TRIM(${content})
      WHERE id = ${id}
      RETURNING *
    `;
    if (updated.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(updated[0]);
  } catch (e) {
    console.error("Error updating post:", e);
    if (e.code === "23505") return res.status(409).json({ error: "A post with this slug already exists" });
    res.status(500).json({ error: "Failed to update post" });
  }
});

app.delete("/api/posts/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const deleted = await sql`DELETE FROM posts WHERE id = ${id} RETURNING *`;
    if (deleted.length === 0) return res.status(404).json({ error: "Post not found" });
    res.json(deleted[0]);
  } catch (e) {
    console.error("Error deleting post:", e);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

// ----- Upload (public image upload) -----
app.post("/api/upload", async (req, res) => {
  const filename = req.query.filename;
  const fileBody = req.body;
  if (!filename || !fileBody) return res.status(400).json({ error: "Filename and file body are required." });
  try {
    const blob = await put(filename, fileBody, { access: "public", addRandomSuffix: true });
    res.json(blob);
  } catch (e) {
    console.error("Error uploading file:", e);
    res.status(500).json({ error: "Failed to upload file." });
  }
});

// ----- Likes -----
app.get("/api/posts/:id/likes", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });

    const countRows = await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const count = countRows[0]?.count || 0;

    let liked = false;
    const readerId = await getCurrentReaderId(req);
    if (readerId) {
      const exists = await sql`SELECT 1 FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;
      liked = exists.length > 0;
    }

    res.json({ count, liked });
  } catch (e) {
    console.error("Error fetching likes:", e);
    res.status(500).json({ error: "Failed to fetch likes" });
  }
});

app.post("/api/posts/:id/like", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });

    const readerId = await getCurrentReaderId(req);
    if (!readerId) return res.status(401).json({ error: "Login required for likes" });

    const existing = await sql`SELECT id FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;
    let liked;
    if (existing.length > 0) {
      await sql`DELETE FROM post_likes WHERE id = ${existing[0].id}`;
      liked = false;
    } else {
      await sql`INSERT INTO post_likes (post_id, user_id) VALUES (${postId}, ${readerId})`;
      liked = true;
    }

    const countRows = await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const count = countRows[0]?.count || 0;

    res.json({ liked, count });
  } catch (e) {
    console.error("Error updating like:", e);
    res.status(500).json({ error: "Failed to update like" });
  }
});

// ----- Comments -----
app.get("/api/posts/:id/comments", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });

    const rows = await sql`
      SELECT
        c.id,
        c.post_id,
        c.parent_id,
        c.content,
        c.created_at,
        c.updated_at,
        u.id AS user_id,
        u.name AS user_name,
        u.avatar_url AS user_avatar_url
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ${postId}
      ORDER BY c.created_at ASC
    `;
    res.json(rows);
  } catch (e) {
    console.error("Error fetching comments:", e);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

app.post("/api/posts/:id/comments", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) return res.status(400).json({ error: "Invalid post id" });

    const readerId = await getCurrentReaderId(req);
    if (!readerId) return res.status(401).json({ error: "Login required to comment" });

    const { content, parentId } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: "Content is required" });

    const inserted = await sql`
      INSERT INTO comments (post_id, user_id, parent_id, content)
      VALUES (${postId}, ${readerId}, ${parentId || null}, ${content})
      RETURNING id, post_id, parent_id, content, created_at, updated_at
    `;
    const comment = inserted[0];

    const userRows = await sql`SELECT id, name, avatar_url FROM users WHERE id = ${readerId} LIMIT 1`;
    const user = userRows[0] || null;

    res.status(201).json({ ...comment, user });
  } catch (e) {
    console.error("Error creating comment:", e);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// ----- Listen -----
app.listen(PORT, () => {
  console.log(`✅ Backend server running on http://localhost:${PORT}`);
});