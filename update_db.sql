-- Add push_token column to users table
ALTER TABLE users ADD COLUMN push_token TEXT NULL;

-- Create index for faster lookups
CREATE INDEX idx_users_push_token ON users(push_token);
