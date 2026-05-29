-- 游客登录改为纯数据库记录，不依赖 Supabase Auth / GitHub 匿名登录
-- 在 Supabase SQL Editor 执行（若已执行过 002，本迁移会覆盖相关函数）

ALTER TABLE public.user_stats DROP CONSTRAINT IF EXISTS user_stats_id_fkey;

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.register_guest_user()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  next_num integer;
  guest_name text;
  guest_avatar text;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE
        WHEN user_name ~ '^游客[0-9]+$' THEN CAST(substring(user_name FROM 4) AS integer)
        ELSE 0
      END
    ),
    0
  ) + 1
  INTO next_num
  FROM public.user_stats;

  guest_name := '游客' || lpad(next_num::text, 2, '0');
  guest_avatar := 'https://github.com/identicons/' || guest_name || '.png';

  INSERT INTO public.user_stats (id, user_name, avatar_url, first_login, last_login, login_count, draw_count, is_guest)
  VALUES (new_id, guest_name, guest_avatar, now(), now(), 1, 0, true);

  RETURN json_build_object(
    'id', new_id,
    'user_name', guest_name,
    'avatar_url', guest_avatar
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_guest_draw_count(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Missing guest id';
  END IF;

  UPDATE public.user_stats
  SET draw_count = draw_count + 1
  WHERE id = p_id AND is_guest = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_guest_user() TO anon;
GRANT EXECUTE ON FUNCTION public.register_guest_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_guest_draw_count(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_guest_draw_count(uuid) TO authenticated;
