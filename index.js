// 1. Import our tools
require("dotenv").config({ path: ".env.local" }); // Read .env.local
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless"); // Import Neon
const { put } = require("@vercel/blob");

// 2. Get the database connection string (CRITICAL)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set in your .env.local file");
}
// 2b. Get the Admin Password (CRITICAL)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD is not set in your .env.local file");
}

// 3. Create the SQL client
const sql = neon(connectionString);

// 4. Create the Express app
const app = express();
const PORT = process.env.PORT || 8080;

// 5. CORS setup (admin + public frontend)
const allowedOrigins = [
  "http://localhost:3000",
  // add your production frontend URL here when deployed:
  // "https://your-frontend-domain.vercel.app"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.log(`CORS blocked request from: ${origin}`);
      return callback(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body & cookie parsers
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.raw({ type: "image/*", limit: "10mb" }));

// ====================================================
// Helper: get current reader ID (for likes/comments)
// ====================================================
//
// For now this is a stub that always returns null.
// In Phase 2.3 we will connect this to Google sign-in
// and set a secure cookie (e.g. reader-token) to identify
// the logged-in reader.
//
async function getCurrentReaderId(req) {
  // placeholder: try to read a numeric ID from cookie/header (dev only)
  const fromCookie = req.cookies["reader-id"];
  const fromHeader = req.get("x-demo-user-id");
  const raw = fromCookie || fromHeader;
  if (!raw) return null;

  const id = Number(raw);
  if (Number.isNaN(id)) return null;
  return id;
}

// ====================================================
// ADMIN AUTH (existing)
// ====================================================

// Login route for admin (password-based)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (password === ADMIN_PASSWORD) {
      const token = crypto.randomBytes(32).toString("hex");

      res.cookie("auth-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "none",
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      });

      return res.status(200).json({ success: true, message: "Login successful" });
    } else {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "An internal server error occurred" });
  }
});

// Logout clears the admin cookie
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("auth-token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
  });
  res.status(200).json({ success: true, message: "Logged out successfully" });
});

// ====================================================
// POSTS (existing CRUD + featured)
// ====================================================

// Get all posts (admin + articles page)
app.get("/api/posts", async (req, res) => {
  try {
    const posts = await sql`SELECT * FROM posts ORDER BY created_at DESC`;
    res.json(posts);
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// Featured posts for homepage
app.get("/api/posts/featured", async (req, res) => {
  try {
    const posts = await sql`
      SELECT * FROM posts
      ORDER BY created_at DESC
      LIMIT 3
    `;
    res.json(posts);
  } catch (error) {
    console.error("Error fetching featured posts:", error);
    res.status(500).json({ error: "Failed to fetch featured posts" });
  }
});

// Get one post by ID (admin editor)
app.get("/api/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const post = await sql`
      SELECT * FROM posts
      WHERE id = ${id}
    `;
    if (post.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json(post[0]);
  } catch (error) {
    console.error("Error fetching post:", error);
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

// Get one post by slug (public article page)
app.get("/api/posts/slug/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const post = await sql`
      SELECT * FROM posts
      WHERE TRIM(slug) = TRIM(${slug})
    `;

    if (post.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json(post[0]);
  } catch (error) {
    console.error("Error fetching post by slug:", error);
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

// Create a new post
app.post("/api/posts", async (req, res) => {
  try {
    const { title, slug, content, category } = req.body;
    if (!title || !slug) {
      return res.status(400).json({ error: "Title and slug are required" });
    }
    const newPost = await sql`
      INSERT INTO posts (title, slug, content)
      VALUES (TRIM(${title}), TRIM(${slug}), TRIM(${content}))
      RETURNING *
    `;
    // Category is not stored yet, but it's safe to ignore for now.
    res.status(201).json(newPost[0]);
  } catch (error) {
    console.error("Error creating post:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "A post with this slug already exists" });
    }
    res.status(500).json({ error: "Failed to create post" });
  }
});

// Update a post by ID
app.put("/api/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug, content, category } = req.body;
    if (!title || !slug) {
      return res.status(400).json({ error: "Title and slug are required" });
    }
    const updatedPost = await sql`
      UPDATE posts
      SET
        title = TRIM(${title}),
        slug = TRIM(${slug}),
        content = TRIM(${content})
      WHERE
        id = ${id}
      RETURNING *
    `;
    if (updatedPost.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    // Category is ignored for now.
    res.status(200).json(updatedPost[0]);
  } catch (error) {
    console.error("Error updating post:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "A post with this slug already exists" });
    }
    res.status(500).json({ error: "Failed to update post" });
  }
});

// Delete a post
app.delete("/api/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deletedPost = await sql`
      DELETE FROM posts
      WHERE id = ${id}
      RETURNING *
    `;
    if (deletedPost.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    res.status(200).json(deletedPost[0]);
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ error: "Failed to delete post" });
  }
});

// ====================================================
// WORLD-CLASS BLOB UPLOAD (existing)
// ====================================================

app.post("/api/upload", async (req, res) => {
  const filename = req.query.filename;
  const fileBody = req.body;

  if (!filename || !fileBody) {
    return res.status(400).json({ error: "Filename and file body are required." });
  }

  try {
    const blob = await put(filename, fileBody, {
      access: "public",
      addRandomSuffix: true,
    });

    res.status(200).json(blob);
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({ error: "Failed to upload file." });
  }
});

// ====================================================
// SOCIAL LAYER: Likes
// ====================================================

// Get like count (+ whether current reader liked) for a post
app.get("/api/posts/:id/likes", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) {
      return res.status(400).json({ error: "Invalid post id" });
    }

    const countRows =
      await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const count = countRows[0]?.count || 0;

    let liked = false;
    const readerId = await getCurrentReaderId(req);
    if (readerId) {
      const existing =
        await sql`SELECT 1 FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;
      liked = existing.length > 0;
    }

    res.json({ count, liked });
  } catch (error) {
    console.error("Error fetching likes:", error);
    res.status(500).json({ error: "Failed to fetch likes" });
  }
});

// Toggle like/unlike for the current reader
app.post("/api/posts/:id/like", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) {
      return res.status(400).json({ error: "Invalid post id" });
    }

    const readerId = await getCurrentReaderId(req);
    if (!readerId) {
      return res.status(401).json({ error: "Login required for likes" });
    }

    // Check if already liked
    const existing =
      await sql`SELECT id FROM post_likes WHERE post_id = ${postId} AND user_id = ${readerId} LIMIT 1`;

    let liked = false;
    if (existing.length > 0) {
      // Unlike
      await sql`DELETE FROM post_likes WHERE id = ${existing[0].id}`;
      liked = false;
    } else {
      // Like
      await sql`
        INSERT INTO post_likes (post_id, user_id)
        VALUES (${postId}, ${readerId})
      `;
      liked = true;
    }

    const countRows =
      await sql`SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = ${postId}`;
    const count = countRows[0]?.count || 0;

    res.json({ liked, count });
  } catch (error) {
    console.error("Error toggling like:", error);
    res.status(500).json({ error: "Failed to update like" });
  }
});

// ====================================================
// SOCIAL LAYER: Comments
// ====================================================

// Get comments for a post (flat list, with user info)
app.get("/api/posts/:id/comments", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) {
      return res.status(400).json({ error: "Invalid post id" });
    }

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
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// Create a new comment for a post
app.post("/api/posts/:id/comments", async (req, res) => {
  try {
    const postId = Number(req.params.id);
    if (!Number.isInteger(postId)) {
      return res.status(400).json({ error: "Invalid post id" });
    }

    const readerId = await getCurrentReaderId(req);
    if (!readerId) {
      return res.status(401).json({ error: "Login required to comment" });
    }

    const { content, parentId } = req.body;
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: "Content is required" });
    }

    const inserted = await sql`
      INSERT INTO comments (post_id, user_id, parent_id, content)
      VALUES (${postId}, ${readerId}, ${parentId || null}, ${content})
      RETURNING id, post_id, parent_id, content, created_at, updated_at
    `;

    const comment = inserted[0];

    // Attach user info
    const userRows =
      await sql`SELECT id, name, avatar_url FROM users WHERE id = ${readerId} LIMIT 1`;
    const user = userRows[0] || null;

    res.status(201).json({ ...comment, user });
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).json({ error: "Failed to create comment" });
  }
});

// 15. Start the server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running on http://localhost:${PORT}`);
});