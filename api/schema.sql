-- DROP TABLE IF EXISTS users;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid VARCHAR NOT NULL UNIQUE,
    username VARCHAR NOT NULL UNIQUE,
    email VARCHAR NOT NULL UNIQUE,
    password_hash VARCHAR NOT NULL,
    create_at VARCHAR DEFAULT CURRENT_TIMESTAMP,
    updated_at VARCHAR DEFAULT CURRENT_TIMESTAMP,
    is_admin INTEGER DEFAULT 0
)