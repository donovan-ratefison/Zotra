-- +goose Up

CREATE TABLE bank_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    name text NOT NULL,
    logo bytea,
    logo_mime text,
    primary_color text NOT NULL,
    accent_color text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((logo IS NULL) = (logo_mime IS NULL))
);

INSERT INTO bank_settings (name, primary_color, accent_color)
VALUES ('Banque Ravina', '#0f4c45', '#b8913a');

-- +goose Down

DROP TABLE bank_settings;
