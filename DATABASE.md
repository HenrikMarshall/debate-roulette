# Database Schema (For Future User Accounts)

When you're ready to add user accounts, here's the database structure you'll need.

## Recommended Database: PostgreSQL

Available free on:
- Railway (built-in, just add it)
- Render (free tier)
- Supabase (generous free tier + auth built-in)

---

## Tables

### users
Stores user account information.

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    rating INTEGER DEFAULT 1000,
    total_debates INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    profile_picture_url TEXT,
    bio TEXT,
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    banned_until TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_rating ON users(rating DESC);
```

### debates
Stores debate history.

```sql
CREATE TABLE debates (
    id SERIAL PRIMARY KEY,
    user1_id INTEGER REFERENCES users(id),
    user2_id INTEGER REFERENCES users(id),
    topic TEXT NOT NULL,
    user1_side VARCHAR(10) NOT NULL, -- 'PRO' or 'CON'
    user2_side VARCHAR(10) NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    duration_seconds INTEGER,
    winner_id INTEGER REFERENCES users(id),
    rating_change_user1 INTEGER,
    rating_change_user2 INTEGER,
    was_completed BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_debates_user1 ON debates(user1_id);
CREATE INDEX idx_debates_user2 ON debates(user2_id);
CREATE INDEX idx_debates_started_at ON debates(started_at DESC);
```

### debate_votes
For spectators to vote on debate winners.

```sql
CREATE TABLE debate_votes (
    id SERIAL PRIMARY KEY,
    debate_id INTEGER REFERENCES debates(id),
    voter_id INTEGER REFERENCES users(id),
    voted_for_user_id INTEGER REFERENCES users(id),
    voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(debate_id, voter_id)
);

CREATE INDEX idx_debate_votes_debate ON debate_votes(debate_id);
```

### reports
User reporting system for moderation.

```sql
CREATE TABLE reports (
    id SERIAL PRIMARY KEY,
    reporter_id INTEGER REFERENCES users(id),
    reported_user_id INTEGER REFERENCES users(id),
    debate_id INTEGER REFERENCES debates(id),
    reason VARCHAR(50) NOT NULL, -- 'harassment', 'inappropriate', 'spam', etc.
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'actioned', 'dismissed'
    reviewed_by_admin_id INTEGER,
    reviewed_at TIMESTAMP,
    action_taken TEXT
);

CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_reported_user ON reports(reported_user_id);
```

### user_preferences
User settings and preferences.

```sql
CREATE TABLE user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    preferred_topics TEXT[], -- array of topic categories
    avoid_topics TEXT[],
    notification_email BOOLEAN DEFAULT TRUE,
    notification_match BOOLEAN DEFAULT TRUE,
    allow_spectators BOOLEAN DEFAULT TRUE,
    preferred_debate_length INTEGER DEFAULT 30, -- seconds per turn
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### friendships
Friend system (optional).

```sql
CREATE TABLE friendships (
    id SERIAL PRIMARY KEY,
    user1_id INTEGER REFERENCES users(id),
    user2_id INTEGER REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'accepted', 'blocked'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,
    UNIQUE(user1_id, user2_id)
);

CREATE INDEX idx_friendships_user1 ON friendships(user1_id);
CREATE INDEX idx_friendships_user2 ON friendships(user2_id);
```

### debate_recordings
For saving debate videos (optional).

```sql
CREATE TABLE debate_recordings (
    id SERIAL PRIMARY KEY,
    debate_id INTEGER REFERENCES debates(id) UNIQUE,
    video_url TEXT NOT NULL, -- S3 or similar storage
    thumbnail_url TEXT,
    duration_seconds INTEGER,
    file_size_bytes BIGINT,
    is_public BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recordings_public ON debate_recordings(is_public, created_at DESC);
```

---

## Sample Queries

### Get User Leaderboard
```sql
SELECT 
    username,
    rating,
    total_debates,
    wins,
    ROUND(wins::numeric / NULLIF(total_debates, 0) * 100, 1) as win_rate
FROM users
WHERE total_debates >= 10
ORDER BY rating DESC
LIMIT 100;
```

### Get User Debate History
```sql
SELECT 
    d.id,
    d.topic,
    d.started_at,
    d.duration_seconds,
    CASE 
        WHEN d.user1_id = $1 THEN u2.username 
        ELSE u1.username 
    END as opponent,
    CASE 
        WHEN d.winner_id = $1 THEN 'WIN'
        WHEN d.winner_id IS NULL THEN 'DRAW'
        ELSE 'LOSS'
    END as result
FROM debates d
JOIN users u1 ON d.user1_id = u1.id
JOIN users u2 ON d.user2_id = u2.id
WHERE d.user1_id = $1 OR d.user2_id = $1
ORDER BY d.started_at DESC
LIMIT 50;
```

### Get Recent Debates (for homepage)
```sql
SELECT 
    d.id,
    d.topic,
    u1.username as user1_username,
    u2.username as user2_username,
    d.started_at,
    dr.video_url,
    dr.view_count
FROM debates d
JOIN users u1 ON d.user1_id = u1.id
JOIN users u2 ON d.user2_id = u2.id
LEFT JOIN debate_recordings dr ON d.id = dr.debate_id
WHERE dr.is_public = TRUE
ORDER BY d.started_at DESC
LIMIT 20;
```

---

## Adding to Your Project

### Step 1: Choose Database Provider

**Option A: Railway (Easiest)**
```bash
# In Railway dashboard:
# Click "New" → "Database" → "Add PostgreSQL"
# Get connection string from variables
```

**Option B: Supabase (Best for Auth)**
```bash
# Go to https://supabase.com
# Create new project
# Get connection string from settings
# Bonus: Built-in authentication!
```

**Option C: Render**
```bash
# Go to https://render.com
# Create "New PostgreSQL"
# Get connection string
```

### Step 2: Install pg (PostgreSQL client)
```bash
npm install pg
```

### Step 3: Create Database Module

Create `database.js`:
```javascript
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected:', res.rows[0].now);
    }
});

module.exports = pool;
```

### Step 4: Run Schema
```javascript
// init-db.js
const pool = require('./database');
const fs = require('fs');

async function initDatabase() {
    const schema = fs.readFileSync('schema.sql', 'utf8');
    await pool.query(schema);
    console.log('Database initialized!');
    process.exit(0);
}

initDatabase();
```

Run: `node init-db.js`

### Step 5: Add to server.js
```javascript
const db = require('./database');

// Save debate when it ends
socket.on('end-debate', async ({ debateId }) => {
    const debate = activeDebates.get(debateId);
    if (debate) {
        // Save to database
        await db.query(`
            INSERT INTO debates (user1_id, user2_id, topic, user1_side, user2_side, ended_at, duration_seconds)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        `, [debate.user1, debate.user2, debate.topic, debate.user1Side, debate.user2Side, 
            Math.floor((Date.now() - debate.startedAt) / 1000)]);
    }
    
    // ... rest of cleanup
});
```

---

## ELO Rating System

When you add competitive rankings:

```javascript
function calculateELO(winner_rating, loser_rating) {
    const K = 32; // K-factor (how much ratings change)
    
    const expected_winner = 1 / (1 + Math.pow(10, (loser_rating - winner_rating) / 400));
    const expected_loser = 1 / (1 + Math.pow(10, (winner_rating - loser_rating) / 400));
    
    const winner_change = Math.round(K * (1 - expected_winner));
    const loser_change = Math.round(K * (0 - expected_loser));
    
    return {
        winner_new_rating: winner_rating + winner_change,
        loser_new_rating: loser_rating + loser_change,
        winner_change,
        loser_change
    };
}

// Usage after debate
const { winner_new_rating, loser_new_rating } = calculateELO(1200, 1150);
// Update database with new ratings
```

---

## Migration Path

**Phase 1 (Current)**: Anonymous debates, no database
**Phase 2**: Add database, track anonymous debates
**Phase 3**: Add user registration (optional for users)
**Phase 4**: Add ratings, leaderboards
**Phase 5**: Add social features (friends, recordings)

You can keep the platform working without accounts and add them gradually!

---

## Security Notes

- **Never store passwords in plain text** - always use bcrypt
- **Use parameterized queries** - prevents SQL injection
- **Add rate limiting** - prevent abuse
- **Validate all inputs** - never trust user data
- **Use HTTPS** - Railway provides this automatically

---

## Recommended Libraries

```bash
npm install pg                  # PostgreSQL client
npm install bcrypt              # Password hashing
npm install jsonwebtoken        # JWT for sessions
npm install express-validator   # Input validation
npm install express-rate-limit  # Rate limiting
```

---

This schema is ready to use when you want to add user accounts. Start simple with just the `users` and `debates` tables, then add more features over time!
