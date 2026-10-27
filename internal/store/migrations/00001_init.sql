-- +goose Up

CREATE TABLE processes (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE versions (
    id uuid PRIMARY KEY,
    process_id uuid NOT NULL REFERENCES processes(id),
    parent_id uuid REFERENCES versions(id),
    number int NOT NULL,
    label text NOT NULL DEFAULT '',
    status text NOT NULL CHECK (status IN ('draft', 'frozen', 'published')),
    definition jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    frozen_at timestamptz,
    UNIQUE (process_id, number)
);

CREATE TABLE cases (
    id uuid PRIMARY KEY,
    version_id uuid NOT NULL REFERENCES versions(id),
    reference text NOT NULL UNIQUE,
    is_test boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
    case_id uuid NOT NULL REFERENCES cases(id),
    seq int NOT NULL,
    type text NOT NULL,
    at timestamptz NOT NULL,
    actor text NOT NULL,
    payload json NOT NULL,
    prev_hash text NOT NULL,
    hash text NOT NULL,
    PRIMARY KEY (case_id, seq)
);

CREATE TABLE users (
    id text PRIMARY KEY,
    name text NOT NULL,
    role_ids text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE documents (
    id uuid PRIMARY KEY,
    case_id uuid REFERENCES cases(id),
    name text NOT NULL,
    mime text NOT NULL,
    sha256 text NOT NULL,
    bytes bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose StatementBegin
CREATE FUNCTION refuse_event_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'events is append-only';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER events_append_only
    BEFORE UPDATE OR DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION refuse_event_change();

-- +goose Down

DROP TRIGGER events_append_only ON events;
DROP FUNCTION refuse_event_change();
DROP TABLE documents;
DROP TABLE users;
DROP TABLE events;
DROP TABLE cases;
DROP TABLE versions;
DROP TABLE processes;
