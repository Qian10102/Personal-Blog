import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { createBreakdownHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const publishableKeys = JSON.parse(
  Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}",
);
const publicKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY")!;
const userClient = (token: string) =>
  createClient(url, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
Deno.serve(
  createBreakdownHandler({
    apiKey: Deno.env.get("DEEPSEEK_API_KEY"),
    model: Deno.env.get("REVIEW_AI_MODEL") || "deepseek-flash",
    async authenticate(token) {
      const { data, error } = await userClient(token).auth.getUser(token);
      return error ? null : data.user;
    },
    async loadPlanner(token, userId) {
      const { data, error } = await userClient(token)
        .from("review_planners")
        .select("revision,document")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  }),
);
