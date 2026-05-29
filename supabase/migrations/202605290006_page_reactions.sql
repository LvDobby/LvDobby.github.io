-- 页面赞 / 踩：累计计数 + 点击明细

CREATE TABLE IF NOT EXISTS public.page_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text NOT NULL DEFAULT '',
  avatar_url text DEFAULT '',
  reaction_type text NOT NULL CHECK (reaction_type IN ('like', 'dislike')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_reactions_created_at_idx
  ON public.page_reactions (created_at DESC);

CREATE INDEX IF NOT EXISTS page_reactions_type_idx
  ON public.page_reactions (reaction_type);

ALTER TABLE public.page_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "page_reactions_select_all" ON public.page_reactions;
CREATE POLICY "page_reactions_select_all" ON public.page_reactions
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.record_page_reaction(
  p_reaction text,
  p_user_name text DEFAULT '',
  p_avatar_url text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_reaction NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid reaction';
  END IF;

  INSERT INTO public.page_reactions (user_id, user_name, avatar_url, reaction_type)
  VALUES (
    uid,
    COALESCE(NULLIF(trim(p_user_name), ''), 'GitHub User'),
    COALESCE(p_avatar_url, ''),
    p_reaction
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_guest_page_reaction(
  p_id uuid,
  p_reaction text,
  p_user_name text DEFAULT '',
  p_avatar_url text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Missing guest id';
  END IF;

  IF p_reaction NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid reaction';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_stats WHERE id = p_id AND is_guest = true
  ) THEN
    RAISE EXCEPTION 'Invalid guest';
  END IF;

  INSERT INTO public.page_reactions (user_id, user_name, avatar_url, reaction_type)
  VALUES (
    p_id,
    COALESCE(NULLIF(trim(p_user_name), ''), '游客'),
    COALESCE(p_avatar_url, ''),
    p_reaction
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_page_reaction(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_guest_page_reaction(uuid, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_guest_page_reaction(uuid, text, text, text) TO authenticated;
