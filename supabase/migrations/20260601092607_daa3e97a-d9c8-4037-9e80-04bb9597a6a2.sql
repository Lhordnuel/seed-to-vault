CREATE POLICY "Trusted backend can manage delivery events"
ON public.email_delivery_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);