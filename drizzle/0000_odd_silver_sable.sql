CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"account_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"title" text DEFAULT 'Untitled session' NOT NULL,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"session_id" text NOT NULL,
	"account_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_code" text,
	"executed_code" text,
	"result" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "quota_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"window" text DEFAULT 'day' NOT NULL,
	"limit_tokens" integer NOT NULL,
	"used_tokens" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"virtual_key_id" text NOT NULL,
	"session_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "virtual_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"tier" text DEFAULT 'anon' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_message_id_agent_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_buckets" ADD CONSTRAINT "quota_buckets_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_keys" ADD CONSTRAINT "virtual_keys_account_id_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_session_idx" ON "agent_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_messages_account_idx" ON "agent_messages" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_account_idx" ON "agent_sessions" USING btree ("account_id","updated_at");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_message_idx" ON "agent_tool_calls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_account_idx" ON "agent_tool_calls" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "quota_buckets_account_idx" ON "quota_buckets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "usage_log_account_idx" ON "usage_log" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "virtual_keys_account_idx" ON "virtual_keys" USING btree ("account_id");