CREATE TABLE "audit_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"actorEmail" varchar(255) NOT NULL,
	"targetEmail" varchar(255),
	"action" varchar(100) NOT NULL,
	"resourceType" varchar(50) NOT NULL,
	"resourceId" varchar(255),
	"metadata" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_email" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"step" varchar(255),
	"video_type" varchar(20),
	"video_url" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_user_email_users_email_fk" FOREIGN KEY ("user_email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actorEmail");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "video_jobs_user_email_idx" ON "video_jobs" USING btree ("user_email");--> statement-breakpoint
CREATE INDEX "video_jobs_status_created_at_idx" ON "video_jobs" USING btree ("status","created_at");