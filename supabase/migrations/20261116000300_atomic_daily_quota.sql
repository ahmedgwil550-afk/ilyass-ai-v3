-- Atomic daily quota consumption. This prevents concurrent requests from exceeding the limit.
CREATE OR REPLACE FUNCTION public.consume_daily_usage(p_device_id uuid, p_daily_limit integer DEFAULT 3)
RETURNS TABLE(allowed boolean, remaining integer, request_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_daily_limit < 1 OR p_daily_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid daily limit';
  END IF;

  INSERT INTO public.daily_usage AS usage (device_id, request_date, request_count)
  VALUES (p_device_id::text, v_today, 1)
  ON CONFLICT (device_id, request_date)
  DO UPDATE SET
    request_count = usage.request_count + 1,
    updated_at = now()
  WHERE public.daily_usage.request_count < p_daily_limit
  RETURNING usage.request_count INTO v_count;

  IF v_count IS NULL THEN
    SELECT d.request_count INTO v_count
    FROM public.daily_usage d
    WHERE d.device_id = p_device_id::text AND d.request_date = v_today;
    RETURN QUERY SELECT false, 0, COALESCE(v_count, p_daily_limit);
  ELSE
    RETURN QUERY SELECT true, GREATEST(p_daily_limit - v_count, 0), v_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_daily_usage(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_daily_usage(uuid, integer) TO service_role;
