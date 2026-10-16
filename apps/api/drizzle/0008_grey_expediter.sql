CREATE INDEX "devices_canvas_hash_idx" ON "devices" USING btree ("canvas_hash");--> statement-breakpoint
CREATE INDEX "devices_webgl_hash_idx" ON "devices" USING btree ("webgl_hash");--> statement-breakpoint
CREATE INDEX "devices_audio_hash_idx" ON "devices" USING btree ("audio_hash");--> statement-breakpoint
CREATE INDEX "devices_fonts_hash_idx" ON "devices" USING btree ("fonts_hash");