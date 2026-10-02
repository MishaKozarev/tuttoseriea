ALTER TABLE "football"."matches" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "football"."matches" AS "match"
SET "slug" =
  coalesce(
    nullif(
      regexp_replace(
        regexp_replace(
          replace(
            lower(
              regexp_replace(
                normalize("home_club"."provider_name", NFKD),
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
    'home-club'
  )
  || '-' ||
  coalesce(
    nullif(
      regexp_replace(
        regexp_replace(
          replace(
            lower(
              regexp_replace(
                normalize("away_club"."provider_name", NFKD),
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
    'away-club'
  )
  || '-' || "match"."provider_fixture_id"::text
FROM "football"."clubs" AS "home_club",
     "football"."clubs" AS "away_club"
WHERE "home_club"."id" = "match"."home_club_id"
  AND "away_club"."id" = "match"."away_club_id";--> statement-breakpoint
ALTER TABLE "football"."matches" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_slug_unique" ON "football"."matches" USING btree ("slug");
