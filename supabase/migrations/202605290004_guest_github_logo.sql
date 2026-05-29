-- 游客默认头像改为 GitHub 经典 Logo
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
  guest_avatar text := 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
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

  INSERT INTO public.user_stats (id, user_name, avatar_url, first_login, last_login, login_count, draw_count, is_guest)
  VALUES (new_id, guest_name, guest_avatar, now(), now(), 1, 0, true);

  RETURN json_build_object(
    'id', new_id,
    'user_name', guest_name,
    'avatar_url', guest_avatar
  );
END;
$$;

UPDATE public.user_stats
SET avatar_url = 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
WHERE is_guest = true;
