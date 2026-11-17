
CREATE TABLE public.daily_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(device_id, request_date)
);

ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read usage" ON public.daily_usage FOR SELECT USING (true);
CREATE POLICY "Anyone can insert usage" ON public.daily_usage FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update usage" ON public.daily_usage FOR UPDATE USING (true);
