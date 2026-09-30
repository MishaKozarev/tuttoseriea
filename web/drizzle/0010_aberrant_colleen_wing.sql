ALTER TABLE "football"."players" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "football"."players"
SET "slug" = coalesce(
  nullif(
    regexp_replace(
      regexp_replace(
        replace(
          lower(
            regexp_replace(
              normalize("provider_name", NFKD),
              U&'[\0300-\036f]',
              '',
              'g'
            )
          ),
          '&',
          ' and '
        ),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '(^-+|-+$)',
      '',
      'g'
    ),
    ''
  ),
  'player'
) || '-' || "provider_player_id"::text;--> statement-breakpoint
ALTER TABLE "football"."players" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "players_slug_unique" ON "football"."players" USING btree ("slug");
