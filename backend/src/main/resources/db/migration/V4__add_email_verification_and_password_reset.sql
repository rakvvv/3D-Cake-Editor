ALTER TABLE users
    ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN verification_token VARCHAR(255),
    ADD COLUMN password_reset_token VARCHAR(255),
    ADD COLUMN password_reset_expiry TIMESTAMPTZ;

UPDATE users SET email_verified = TRUE WHERE role = 'ADMIN';
