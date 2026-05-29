-- 游客登录：自动分配 游客01、游客02… 并使用 GitHub identicon 默认头像
CREATE OR REPLACE FUNCTION public.register_guest_user()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  next_num integer;
  guest_name text;
  guest_avatar text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

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

  INSERT INTO public.user_stats (id, user_name, avatar_url, first_login, last_login, login_count, draw_count)
  VALUES (uid, guest_name, guest_avatar, now(), now(), 1, 0)
  ON CONFLICT (id) DO UPDATE SET
    last_login = now(),
    login_count = public.user_stats.login_count + 1;

  RETURN json_build_object(
    'user_name', (SELECT user_name FROM public.user_stats WHERE id = uid),
    'avatar_url', (SELECT avatar_url FROM public.user_stats WHERE id = uid)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_guest_user() TO authenticated;
