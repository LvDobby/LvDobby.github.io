-- 「隐藏此次访问」：将当前用户的 login_count - 1（不低于 0）

CREATE OR REPLACE FUNCTION public.hide_current_login()
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
  SET login_count = GREATEST(login_count - 1, 0)
  WHERE id = uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.hide_guest_login(p_id uuid)
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
  SET login_count = GREATEST(login_count - 1, 0)
  WHERE id = p_id AND is_guest = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hide_current_login() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hide_guest_login(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.hide_guest_login(uuid) TO authenticated;
