-- Create a table for users to store long-term memory facts and interaction statistics
CREATE TABLE IF NOT EXISTS public.users (
    user_id TEXT PRIMARY KEY,
    facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) on the table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- If you are using the service_role key to bypass RLS, this policy allows service_role full access.
-- If you want to use an anon key or allow specific roles, adjust policies accordingly.
CREATE POLICY "service role full access"
    ON public.users
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Optional: Create an index on user_id (already indexed due to Primary Key)
-- Optional: Create an index on last_updated for faster sorting by recent activity
CREATE INDEX IF NOT EXISTS idx_users_last_updated ON public.users(last_updated DESC);
