-- Cloudflare D1 CountaNeura Master Schema

-- Table 1: Knowledge Base Content
CREATE TABLE IF NOT EXISTS site_content (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    extra_data TEXT,
    category TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table 2: Unified Chat Logs (Web & Telegram)
CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL, -- 'web' or 'telegram'
    chat_id TEXT NOT NULL,
    user_name TEXT,
    user_msg TEXT NOT NULL,
    ai_msg TEXT,
    human_reply TEXT,
    is_human INTEGER DEFAULT 0,
    sentiment TEXT, -- e.g., 'هاديء', 'منفعل'
    needs_intervention INTEGER DEFAULT 0, -- 1 if intervention recommended
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table 3: Chat Sessions Tracking
CREATE TABLE IF NOT EXISTS chat_sessions (
    chat_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    user_name TEXT,
    status TEXT DEFAULT 'active', -- 'active', 'paused' (human takeover), 'closed' (archived)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
