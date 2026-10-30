-- +goose Up

ALTER TABLE processes ADD COLUMN archived_at timestamptz;

-- +goose Down

ALTER TABLE processes DROP COLUMN archived_at;
