// 1. Import our tools
require('dotenv').config({ path: '.env.local' }); // Read .env.local
const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless'); // Import Neon
const { put } = require('@vercel/blob');

// 2. Get the database connection string (CRITICAL)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set in your .env.local file');
}
// 2b. Get the Admin Password (CRITICAL)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD is not set in your .env.local file');
}

// 3. Create the SQL client
const sql = neon(connectionString);

// 4. Create the Express app
const app = express();
const PORT = process.env.PORT || 8080;

// 5. Set up middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'image/*', limit: '10mb' }));

// --- API ROUTES ---

// 6. Define our "GET all posts" route (for the /blog page)
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await sql`SELECT * FROM posts ORDER BY created_at DESC`;
    res.json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// 7. *** NEW: "WORLD-CLASS" FEATURED POSTS ROUTE (for Homepage) ***
app.get('/api/posts/featured', async (req, res) => {
  try {
    // "Aggressively Excellent" SQL: Get top 3 newest posts
    const posts = await sql`
      SELECT * FROM posts 
      ORDER BY created_at DESC 
      LIMIT 3
    `;
    res.json(posts);
  } catch (error) {
    console.error('Error fetching featured posts:', error);
    res.status(500).json({ error: 'Failed to fetch featured posts' });
  }
});


// 8. GET *ONE* POST (by ID) - Used for "Edit" form
app.get('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const post = await sql`
      SELECT * FROM posts 
      WHERE id = ${id}
    `;
    if (post.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(post[0]);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// 9. GET *ONE* POST (by SLUG) - Used for public post page
app.get('/api/posts/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await sql`
      SELECT * FROM posts 
      WHERE slug = TRIM(${slug})
    `;
    if (post.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(post[0]);
  } catch (error) {
    console.error('Error fetching post by slug:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});


// 10. CREATE a new post" route
app.post('/api/posts', async (req, res) => {
  try {
    const { title, slug, content } = req.body;
    if (!title || !slug) {
      return res.status(400).json({ error: 'Title and slug are required' });
    }
    const newPost = await sql`
      INSERT INTO posts (title, slug, content) 
      VALUES (TRIM(${title}), TRIM(${slug}), TRIM(${content}))
      RETURNING *
    `;
    res.status(201).json(newPost[0]);
  } catch (error)
 {
    console.error('Error creating post:', error);
    if (error.code === '23505') { 
      return res.status(409).json({ error: 'A post with this slug already exists' });
    }
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// 11. UPDATE A POST (by ID)
app.put('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug, content } = req.body; 
    if (!title || !slug) {
      return res.status(400).json({ error: 'Title and slug are required' });
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
      return res.status(404).json({ error: 'Post not found' });
    }
    res.status(200).json(updatedPost[0]);
  } catch (error) {
    console.error('Error updating post:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A post with this slug already exists' });
    }
    res.status(500).json({ error: 'Failed to update post' });
  }
});


// 12. AUTHENTICATION ROUTE
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (password === ADMIN_PASSWORD) {
      res.status(200).json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// 13. DELETE POST ROUTE
app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedPost = await sql`
      DELETE FROM posts 
      WHERE id = ${id}
      RETURNING *
    `;
    if (deletedPost.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.status(200).json(deletedPost[0]);
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});


// 14. "WORLD-CLASS" BLOB UPLOAD ROUTE (FIXED)
app.post('/api/upload', async (req, res) => {
  const filename = req.query.filename;
  const fileBody = req.body;

  if (!filename || !fileBody) {
    return res.status(400).json({ error: 'Filename and file body are required.' });
  }

  try {
    const blob = await put(filename, fileBody, {
      access: 'public', 
      addRandomSuffix: true,
    });
    
    res.status(200).json(blob);

  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file.' });
  }
});


// 15. Start the server
app.listen(PORT, () => {
  console.log(`✅ Backend server is running on http://localhost:${PORT}`);
});