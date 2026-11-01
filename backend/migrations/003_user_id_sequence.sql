-- One row coordinates generated application User IDs across concurrent requests.
CREATE TABLE IF NOT EXISTS user_id_sequences (
 sequence_name VARCHAR(30) NOT NULL PRIMARY KEY,
 `last_value` INT UNSIGNED NOT NULL
) ENGINE=InnoDB;
