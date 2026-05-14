"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Brand from "@/components/Brand";

type View = "signin" | "signup" | "forgot" | "forgot-sent";
type AuthMode = "email" | "phone";

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/console";
  const [view, setView] = useState<View>("signin");
  const [authMode, setAuthMode] = useState<AuthMode>("email");

  // Shared field state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function resetFields() {
    setOtp("");
    setOtpSent(false);
    setPassword("");
    setConfirmPassword("");
  }

  function go(v: View) {
    resetFields();
    setView(v);
  }

  function handleSendOtp() {
    if (phone.replace(/\D/g, "").length < 10) return;
    setOtpSent(true);
  }

  function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => router.push(redirectTo), 400);
  }

  function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (authMode === "email" && password !== confirmPassword) return;
    if (!agreed) return;
    setSubmitting(true);
    setTimeout(() => router.push(redirectTo), 400);
  }

  function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setView("forgot-sent");
    }, 400);
  }

  const passwordMismatch =
    view === "signup" && confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Left marketing panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-12 py-12 text-white lg:flex">
        <div>
          <Brand size="md" variant="light" />
          <p className="mt-2 text-xs text-emerald-100/80">openidea.world</p>
        </div>

        <div className="relative z-10">
          <h2 className="text-4xl font-bold leading-tight">
            Your business deserves a website that works while you sleep.
          </h2>
          <p className="mt-6 text-emerald-50/90">
            AI-powered websites for 50+ Indian business categories. Free hosting. Zero commission. Ready in 24 hours.
          </p>

          <ul className="mt-10 space-y-3 text-sm text-emerald-50/90">
            {[
              "50+ pre-built templates from restaurant to barber shop",
              "Online ordering, bookings, payments — built-in",
              "WhatsApp, Google Maps, UPI integrated",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-20 h-80 w-80 rounded-full bg-teal-300/20 blur-3xl" />
      </aside>

      {/* Right form panel */}
      <div className="flex items-center justify-center bg-white px-6 py-12 sm:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Brand size="md" />
          </div>

          {/* Sign in / Sign up toggle */}
          {(view === "signin" || view === "signup") && (
            <div className="mb-6 flex rounded-full bg-zinc-100 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => go("signin")}
                className={`flex-1 rounded-full px-4 py-2 transition ${
                  view === "signin" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => go("signup")}
                className={`flex-1 rounded-full px-4 py-2 transition ${
                  view === "signup" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
                }`}
              >
                Sign up
              </button>
            </div>
          )}

          {view === "signin" && (
            <SignInForm
              authMode={authMode}
              setAuthMode={setAuthMode}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              phone={phone}
              setPhone={setPhone}
              otp={otp}
              setOtp={setOtp}
              otpSent={otpSent}
              sendOtp={handleSendOtp}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              submitting={submitting}
              onSubmit={handleSignIn}
              onForgot={() => go("forgot")}
            />
          )}

          {view === "signup" && (
            <SignUpForm
              authMode={authMode}
              setAuthMode={setAuthMode}
              name={name}
              setName={setName}
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              confirmPassword={confirmPassword}
              setConfirmPassword={setConfirmPassword}
              phone={phone}
              setPhone={setPhone}
              otp={otp}
              setOtp={setOtp}
              otpSent={otpSent}
              sendOtp={handleSendOtp}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              agreed={agreed}
              setAgreed={setAgreed}
              passwordMismatch={passwordMismatch}
              submitting={submitting}
              onSubmit={handleSignUp}
            />
          )}

          {view === "forgot" && (
            <ForgotForm
              email={email}
              setEmail={setEmail}
              submitting={submitting}
              onSubmit={handleForgot}
              onBack={() => go("signin")}
            />
          )}

          {view === "forgot-sent" && (
            <ForgotSent email={email} onBack={() => go("signin")} />
          )}

          <p className="mt-8 text-center text-xs text-zinc-400">
            By continuing, you agree to our{" "}
            <a href="#" className="underline hover:text-zinc-600">Terms</a>{" "}and{" "}
            <a href="#" className="underline hover:text-zinc-600">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </main>
  );
}

/* ────────────────  SIGN IN  ──────────────── */

function SignInForm(props: {
  authMode: AuthMode;
  setAuthMode: (m: AuthMode) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpSent: boolean;
  sendOtp: () => void;
  showPassword: boolean;
  setShowPassword: (fn: (s: boolean) => boolean) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onForgot: () => void;
}) {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Welcome back</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Sign in to manage your website and track your visitors.
      </p>

      <SocialButtons />
      <Divider />
      <AuthModeTabs mode={props.authMode} onChange={props.setAuthMode} />

      <form onSubmit={props.onSubmit} className="space-y-4">
        {props.authMode === "email" ? (
          <>
            <Field
              id="signin-email"
              label="Email"
              type="email"
              value={props.email}
              onChange={props.setEmail}
              placeholder="you@yourbusiness.com"
              autoComplete="email"
            />

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="signin-password" className="block text-sm font-medium text-zinc-700">
                  Password
                </label>
                <button
                  type="button"
                  onClick={props.onForgot}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  Forgot password?
                </button>
              </div>
              <PasswordInput
                id="signin-password"
                value={props.password}
                onChange={props.setPassword}
                show={props.showPassword}
                toggle={() => props.setShowPassword((s) => !s)}
                autoComplete="current-password"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500" />
              Keep me signed in for 30 days
            </label>
          </>
        ) : (
          <PhoneOtpFields
            phone={props.phone}
            setPhone={props.setPhone}
            otp={props.otp}
            setOtp={props.setOtp}
            otpSent={props.otpSent}
            sendOtp={props.sendOtp}
          />
        )}

        <button
          type="submit"
          disabled={props.submitting || (props.authMode === "phone" && !props.otpSent)}
          className="w-full rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </>
  );
}

/* ────────────────  SIGN UP  ──────────────── */

function SignUpForm(props: {
  authMode: AuthMode;
  setAuthMode: (m: AuthMode) => void;
  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpSent: boolean;
  sendOtp: () => void;
  showPassword: boolean;
  setShowPassword: (fn: (s: boolean) => boolean) => void;
  agreed: boolean;
  setAgreed: (v: boolean) => void;
  passwordMismatch: boolean;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Create your account</h1>
      <p className="mt-2 text-sm text-zinc-600">Get your business online in 24 hours. No card required.</p>

      <SocialButtons />
      <Divider />
      <AuthModeTabs mode={props.authMode} onChange={props.setAuthMode} />

      <form onSubmit={props.onSubmit} className="space-y-4">
        <Field
          id="signup-name"
          label="Full name"
          type="text"
          value={props.name}
          onChange={props.setName}
          placeholder="Aman Sharma"
          autoComplete="name"
        />

        {props.authMode === "email" ? (
          <>
            <Field
              id="signup-email"
              label="Email"
              type="email"
              value={props.email}
              onChange={props.setEmail}
              placeholder="you@yourbusiness.com"
              autoComplete="email"
            />

            <div>
              <label htmlFor="signup-password" className="block text-sm font-medium text-zinc-700">
                Password
              </label>
              <PasswordInput
                id="signup-password"
                value={props.password}
                onChange={props.setPassword}
                show={props.showPassword}
                toggle={() => props.setShowPassword((s) => !s)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
              <PasswordStrength value={props.password} />
            </div>

            <div>
              <label htmlFor="signup-confirm" className="block text-sm font-medium text-zinc-700">
                Confirm password
              </label>
              <input
                id="signup-confirm"
                type={props.showPassword ? "text" : "password"}
                required
                autoComplete="new-password"
                value={props.confirmPassword}
                onChange={(e) => props.setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className={`mt-1 block w-full rounded-lg border px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 ${
                  props.passwordMismatch
                    ? "border-rose-300 focus:border-rose-500 focus:ring-rose-200"
                    : "border-zinc-300 focus:border-emerald-500 focus:ring-emerald-200"
                }`}
              />
              {props.passwordMismatch && (
                <p className="mt-1 text-xs text-rose-600">Passwords don&apos;t match.</p>
              )}
            </div>
          </>
        ) : (
          <PhoneOtpFields
            phone={props.phone}
            setPhone={props.setPhone}
            otp={props.otp}
            setOtp={props.setOtp}
            otpSent={props.otpSent}
            sendOtp={props.sendOtp}
          />
        )}

        <label className="flex items-start gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={props.agreed}
            onChange={(e) => props.setAgreed(e.target.checked)}
            className="mt-1 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
          />
          I agree to the Terms of Service and Privacy Policy.
        </label>

        <button
          type="submit"
          disabled={
            props.submitting ||
            !props.agreed ||
            (props.authMode === "phone" && !props.otpSent) ||
            (props.authMode === "email" && props.password !== props.confirmPassword)
          }
          className="w-full rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </>
  );
}

/* ────────────────  FORGOT  ──────────────── */

function ForgotForm(props: {
  email: string;
  setEmail: (v: string) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={props.onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to sign in
      </button>

      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Forgot password?</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Enter the email on your account and we&apos;ll send you a reset link.
      </p>

      <form onSubmit={props.onSubmit} className="mt-6 space-y-4">
        <Field
          id="forgot-email"
          label="Email"
          type="email"
          value={props.email}
          onChange={props.setEmail}
          placeholder="you@yourbusiness.com"
          autoComplete="email"
        />

        <button
          type="submit"
          disabled={props.submitting}
          className="w-full rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {props.submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </>
  );
}

function ForgotSent({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <>
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Check your inbox</h1>
      <p className="mt-2 text-sm text-zinc-600">
        We&apos;ve sent a password reset link to{" "}
        <span className="font-semibold text-zinc-900">{email || "your email"}</span>.
        The link will expire in 30 minutes.
      </p>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          Back to sign in
        </button>
        <p className="text-center text-xs text-zinc-500">
          Didn&apos;t get the email? Check your spam folder or{" "}
          <button onClick={() => location.reload()} className="font-medium text-emerald-700 hover:text-emerald-800">
            try again
          </button>
          .
        </p>
      </div>
    </>
  );
}

/* ────────────────  SHARED PIECES  ──────────────── */

function SocialButtons() {
  return (
    <div className="mt-8 grid grid-cols-2 gap-3">
      <button
        type="button"
        className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
        </svg>
        Google
      </button>
      <button
        type="button"
        className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        <svg className="h-4 w-4 text-zinc-900" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
        </svg>
        Apple
      </button>
    </div>
  );
}

function Divider() {
  return (
    <div className="my-6 flex items-center gap-3">
      <div className="h-px flex-1 bg-zinc-200" />
      <span className="text-xs uppercase tracking-wider text-zinc-400">or</span>
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}

function AuthModeTabs({ mode, onChange }: { mode: AuthMode; onChange: (m: AuthMode) => void }) {
  return (
    <div className="mb-4 flex rounded-lg bg-zinc-100 p-1 text-sm font-medium">
      <button
        type="button"
        onClick={() => onChange("email")}
        className={`flex-1 rounded-md px-3 py-1.5 transition ${
          mode === "email" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
        }`}
      >
        Email
      </button>
      <button
        type="button"
        onClick={() => onChange("phone")}
        className={`flex-1 rounded-md px-3 py-1.5 transition ${
          mode === "phone" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"
        }`}
      >
        Phone OTP
      </button>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
      />
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  show,
  toggle,
  autoComplete,
  placeholder = "••••••••",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggle: () => void;
  autoComplete: string;
  placeholder?: string;
}) {
  return (
    <div className="relative mt-1">
      <input
        id={id}
        type={show ? "text" : "password"}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 pr-14 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
      />
      <button
        type="button"
        onClick={toggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function PasswordStrength({ value }: { value: string }) {
  const score = strengthScore(value);
  const labels = ["Too weak", "Weak", "Fair", "Strong"];
  const colors = ["bg-rose-400", "bg-amber-400", "bg-yellow-400", "bg-emerald-500"];
  if (value.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${i < score ? colors[score - 1] : "bg-zinc-200"}`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-zinc-500">{labels[Math.max(0, score - 1)]}</p>
    </div>
  );
}

function strengthScore(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
}

function PhoneOtpFields({
  phone,
  setPhone,
  otp,
  setOtp,
  otpSent,
  sendOtp,
}: {
  phone: string;
  setPhone: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  otpSent: boolean;
  sendOtp: () => void;
}) {
  return (
    <>
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-zinc-700">
          Phone number
        </label>
        <div className="mt-1 flex">
          <span className="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-600">
            +91
          </span>
          <input
            id="phone"
            type="tel"
            inputMode="numeric"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="98765 43210"
            className="block w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </div>
      </div>

      {otpSent ? (
        <div>
          <label htmlFor="otp" className="block text-sm font-medium text-zinc-700">
            Enter 6-digit OTP
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-center text-lg tracking-widest text-zinc-900 placeholder:text-zinc-300 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            Didn&apos;t get it?{" "}
            <button
              type="button"
              onClick={sendOtp}
              className="font-medium text-emerald-700 hover:text-emerald-800"
            >
              Resend OTP
            </button>
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={sendOtp}
          disabled={phone.length < 10}
          className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send OTP
        </button>
      )}
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500">
          Loading…
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
