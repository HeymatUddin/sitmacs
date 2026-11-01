-- Stores only the agreed contact phone. Existing accounts are preserved.
CREATE TABLE IF NOT EXISTS employee_profiles (
 user_id INT NOT NULL PRIMARY KEY,
 contact_phone VARCHAR(20) NOT NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_employee_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
);
