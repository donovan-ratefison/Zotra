-- +goose Up

CREATE TABLE policy_files (
    process_id uuid PRIMARY KEY REFERENCES processes(id),
    file_name text NOT NULL,
    mime text NOT NULL,
    bytes bytea NOT NULL,
    sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down

DROP TABLE policy_files;
