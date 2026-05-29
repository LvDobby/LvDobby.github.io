-- 手绘注释图 — 使用次数额度

ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS remaining_draw_quota integer NOT NULL DEFAULT 1 CHECK (remaining_draw_quota >= 0),
  ADD COLUMN IF NOT EXISTS total_draw_quota_used integer NOT NULL DEFAULT 0 CHECK (total_draw_quota_used >= 0);

UPDATE public.user_stats
SET remaining_draw_quota = 1
WHERE remaining_draw_quota IS NULL;

UPDATE public.user_stats
SET total_draw_quota_used = 0
WHERE total_draw_quota_used IS NULL;

CREATE OR REPLACE FUNCTION public.consume_draw_quota()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  remaining integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_stats
  SET
    remaining_draw_quota = remaining_draw_quota - 1,
    total_draw_quota_used = total_draw_quota_used + 1,
    draw_count = draw_count + 1
  WHERE id = uid AND remaining_draw_quota >= 1
  RETURNING remaining_draw_quota INTO remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient quota';
  END IF;

  RETURN json_build_object('remaining_draw_quota', remaining);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_guest_draw_quota(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Missing guest id';
  END IF;

  UPDATE public.user_stats
  SET
    remaining_draw_quota = remaining_draw_quota - 1,
    total_draw_quota_used = total_draw_quota_used + 1,
    draw_count = draw_count + 1
  WHERE id = p_id AND is_guest = true AND remaining_draw_quota >= 1
  RETURNING remaining_draw_quota INTO remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient quota';
  END IF;

  RETURN json_build_object('remaining_draw_quota', remaining);
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_bonus_draw_quota()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  remaining integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_stats
  SET remaining_draw_quota = remaining_draw_quota + 1
  WHERE id = uid
  RETURNING remaining_draw_quota INTO remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN json_build_object('remaining_draw_quota', remaining);
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_guest_bonus_draw_quota(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Missing guest id';
  END IF;

  UPDATE public.user_stats
  SET remaining_draw_quota = remaining_draw_quota + 1
  WHERE id = p_id AND is_guest = true
  RETURNING remaining_draw_quota INTO remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid guest';
  END IF;

  RETURN json_build_object('remaining_draw_quota', remaining);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_draw_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_guest_draw_quota(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.consume_guest_draw_quota(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_bonus_draw_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_guest_bonus_draw_quota(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.grant_guest_bonus_draw_quota(uuid) TO authenticated;
