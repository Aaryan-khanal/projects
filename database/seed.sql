USE nirikshan_db;

INSERT INTO users (name, email, password_hash, role, status)
VALUES (
  'Super Admin',
  'superadmin',
  '$2a$10$Jf2xkF1/U6Q5z/18szYQ9eJQjT4W6lwpUOsyA8rx9d4sXIW7Rz0xO',
  'super_admin',
  'active'
)
ON DUPLICATE KEY UPDATE email = VALUES(email);
