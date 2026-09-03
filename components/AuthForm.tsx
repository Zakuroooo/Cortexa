"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Overline, Spinner } from "@/components/ui";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${location.origin}/auth/callback`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        setNotice(
          "Account created. If email confirmation is enabled in Supabase, check your inbox — otherwise log in now."
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        const next = search.get("next") || "/dashboard";
        router.push(next);
        router.refresh();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <Link
          href="/"
          className="mb-10 flex items-center justify-center gap-2.5"
        >
          <svg viewBox="0 0 20 20" className="h-6 w-6" aria-hidden>
            <rect x="1" y="1" width="18" height="18" rx="4" fill="#3ecf8e" fillOpacity="0.12" stroke="#3ecf8e" strokeOpacity="0.5" />
            <path d="M6 13V7l4 3.5L14 7v6" stroke="#3ecf8e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          <span className="text-lg font-semibold tracking-tight">Cortexa</span>
        </Link>

        <Overline className="text-center">
          {mode === "login" ? "Welcome back" : "Create your second brain"}
        </Overline>

        <form onSubmit={submit} className="mt-8 space-y-5">
          {mode === "signup" && (
            <div>
              <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
                Full name
              </label>
              <Input
                placeholder="Ada Lovelace"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}
          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
              Email
            </label>
            <Input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
              Password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                placeholder="min 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                // tabIndex -1 keeps Tab going straight from password to submit,
                // which is what people expect when filling a login form.
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-dim transition-colors hover:text-fg focus-visible:text-fg focus-visible:outline-none"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3.5 py-2.5 text-sm text-red-400">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg border border-acid/25 bg-acid/[0.06] px-3.5 py-2.5 text-sm leading-relaxed text-acid">
              {notice}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Spinner />}
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-dim">
          {mode === "login" ? (
            <>
              No account?{" "}
              <Link href="/signup" className="text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-acid">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already registered?{" "}
              <Link href="/login" className="text-fg underline decoration-line underline-offset-4 transition-colors hover:decoration-acid">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
