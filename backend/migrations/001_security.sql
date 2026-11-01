-- Additive only: existing users and roles are preserved.
CREATE TABLE IF NOT EXISTS auth_sessions (
 id CHAR(64) PRIMARY KEY,
 user_id INT NOT NULL,
 expires_at DATETIME NOT NULL,
 last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (user_id) REFERENCES users(id),
 INDEX ix_sessions_user(user_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_id INT NULL,
 action VARCHAR(80) NOT NULL,
 target_id INT NULL,
 details JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX ix_audit_created(created_at)
);
-- The API exposes no UPDATE or DELETE operation for audit_logs.
-- A database administrator can still change data; this is not tamper-proof storage.
