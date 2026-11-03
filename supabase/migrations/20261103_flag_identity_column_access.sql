-- 2026-11-03: Approved flag designs remain visible; designer identities remain private.
-- The public flag gallery already selects exactly the approved display fields.
REVOKE SELECT ON TABLE public.school_competition_entries FROM authenticated;
GRANT SELECT (id, competition_slug, title, image_path, approved, created_at, meaning, option_id)
ON TABLE public.school_competition_entries TO authenticated;
-- Row-level policy "school_competition_entries_visible" keeps non-approved designs hidden.
-- No change to project/roster write privileges or moderation service roles.
