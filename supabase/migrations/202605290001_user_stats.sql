-- 生活手绘注释图 — 用户登录与访问统计
-- 在 Supabase Dashboard → SQL Editor 中执行，或使用 supabase db push

CREATE TABLE IF NOT EXISTS public.user_stats (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL DEFAULT '',
  avatar_url text DEFAULT '',
  first_login timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz NOT NULL DEFAULT now(),
  login_count integer NOT NULL DEFAULT 0 CHECK (login_count >= 0),
  draw_count integer NOT NULL DEFAULT 0 CHECK (draw_count >= 0)
);

CREATE INDEX IF NOT EXISTS user_stats_login_count_idx ON public.user_stats (login_count DESC);

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_stats_select_all" ON public.user_stats;
CREATE POLICY "user_stats_select_all" ON public.user_stats
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "user_stats_insert_own" ON public.user_stats;
CREATE POLICY "user_stats_insert_own" ON public.user_stats
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "user_stats_update_own" ON public.user_stats;
CREATE POLICY "user_stats_update_own" ON public.user_stats
  FOR UPDATE USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.record_user_login(p_user_name text, p_avatar_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.user_stats (id, user_name, avatar_url, first_login, last_login, login_count, draw_count)
  VALUES (uid, COALESCE(NULLIF(trim(p_user_name), ''), 'GitHub User'), COALESCE(p_avatar_url, ''), now(), now(), 1, 0)
  ON CONFLICT (id) DO UPDATE SET
    user_name = EXCLUDED.user_name,
    avatar_url = EXCLUDED.avatar_url,
    last_login = now(),
    login_count = public.user_stats.login_count + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_draw_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_stats
  SET draw_count = draw_count + 1
  WHERE id = uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_user_login(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_draw_count() TO authenticated;
