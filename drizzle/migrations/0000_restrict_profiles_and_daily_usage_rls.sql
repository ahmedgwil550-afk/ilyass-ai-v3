DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can read usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Anyone can insert usage" ON public.daily_usage;
DROP POLICY IF EXISTS "Anyone can update usage" ON public.daily_usage;