-- 生活手绘注释图 — 访客留言

CREATE TABLE IF NOT EXISTS public.page_guestbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_name text NOT NULL DEFAULT '',
  avatar_url text DEFAULT '',
  content text NOT NULL CHECK (char_length(content) >= 1 AND char_length(content) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_guestbook_created_at_idx
  ON public.page_guestbook (created_at DESC);

ALTER TABLE public.page_guestbook ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "page_guestbook_select_all" ON public.page_guestbook;
CREATE POLICY "page_guestbook_select_all" ON public.page_guestbook
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.record_page_guestbook(
  p_content text,
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
  body text := trim(p_content);
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF body IS NULL OR char_length(body) < 1 THEN
    RAISE EXCEPTION 'Empty message';
  END IF;

  IF char_length(body) > 500 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;

  INSERT INTO public.page_guestbook (user_id, user_name, avatar_url, content)
  VALUES (
    uid,
    COALESCE(NULLIF(trim(p_user_name), ''), 'GitHub User'),
    COALESCE(p_avatar_url, ''),
    body
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_guest_page_guestbook(
  p_id uuid,
  p_content text,
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
  body text := trim(p_content);
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Missing guest id';
  END IF;

  IF body IS NULL OR char_length(body) < 1 THEN
    RAISE EXCEPTION 'Empty message';
  END IF;

  IF char_length(body) > 500 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_stats WHERE id = p_id AND is_guest = true
  ) THEN
    RAISE EXCEPTION 'Invalid guest';
  END IF;

  INSERT INTO public.page_guestbook (user_id, user_name, avatar_url, content)
  VALUES (
    p_id,
    COALESCE(NULLIF(trim(p_user_name), ''), '游客'),
    COALESCE(p_avatar_url, ''),
    body
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_page_guestbook(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_guest_page_guestbook(uuid, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_guest_page_guestbook(uuid, text, text, text) TO authenticated;
