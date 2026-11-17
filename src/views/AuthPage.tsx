import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@/lib/nav";
import { accountClient as supabase } from "@/lib/account-client";
import { lovable } from "@/integrations/lovable/index";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import MikaCharacter from "@/components/MikaCharacter";
import NeonBackground from "@/components/NeonBackground";
import type { CharacterAction, CharacterHandle } from "@/components/AuthCharacter";

type FocusField = "email" | "password" | null;

const AuthPage = ({ next = "/" }: { next?: string }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<FocusField>(null);
  const [hovering, setHovering] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [shake, setShake] = useState(false);
  const [mood, setMood] = useState<"happy" | "neutral" | "surprised" | "shy">("happy");

  const charRef = useRef<CharacterHandle>(null);
  const lastReaction = useRef(-1);

  // ✨ v4: أثناء عرض مسرحي (twerk / poleSpin) لا يُقاطَع — لا مؤقّت الخمول
  // (18 ثانية) ولا ضغطة ثانية على الزر ولا لمسة للشخصية. play() يرجع
  // Promise يتحلّ عند انتهاء العرض، فالحارس يبقى مرفوعاً طوال العرض.
  const playingShow = useRef(false);
  const playShow = async (action: CharacterAction) => {
    if (playingShow.current || loading) return;
    playingShow.current = true;
    try {
      await charRef.current?.play(action);
    } finally {
      playingShow.current = false;
    }
  };

  // أثناء انتظار رد تسجيل الدخول تدخل الشخصية وضعية التفكير (إن تأخّر الرد أكثر من 0.6 ثانية)
  async function withThinking<T>(p: PromiseLike<T>): Promise<T> {
    const t = window.setTimeout(() => charRef.current?.play("think"), 600);
    try {
      return await p;
    } finally {
      window.clearTimeout(t);
    }
  }

  // الضغط على الشخصية = ردّ فعل عشوائي (بدون تكرار نفس الحركة مرتين متتاليتين)
  const REACTIONS: CharacterAction[] = ["wave", "jump", "spin", "dance", "kiss"];
  const poke = () => {
    if (focused || loading || playingShow.current) return;
    let i = Math.floor(Math.random() * REACTIONS.length);
    if (i === lastReaction.current) i = (i + 1) % REACTIONS.length;
    lastReaction.current = i;
    setMood("surprised");
    setTimeout(() => setMood("happy"), 700);
    charRef.current?.play(REACTIONS[i]);
  };

  useEffect(() => {
    (async () => {
      await charRef.current?.playEntrance();
      setShowForm(true);
    })();
    const fallback = setTimeout(() => setShowForm(true), 15000);
    return () => clearTimeout(fallback);
  }, []);

  // إذا تركتها بلا لمس 18 ثانية تتحرّك من تلقاء نفسها (فقط عندما لا تكتب ولا ينتظر الطلب)
  useEffect(() => {
    if (!showForm) return;
    const id = window.setInterval(() => {
      if (focused || loading || document.hidden || playingShow.current) return;
      const idle: CharacterAction[] = ["wave", "dance", "spin"];
      charRef.current?.play(idle[Math.floor(Math.random() * idle.length)]);
    }, 18000);
    return () => window.clearInterval(id);
  }, [showForm, focused, loading]);

  const shakeForm = () => {
    setShake(true);
    setTimeout(() => setShake(false), 600);
    setMood("surprised");
    setTimeout(() => setMood("happy"), 800);
    charRef.current?.play("shake");
  };

  useEffect(() => {
    if (next === "/") return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) navigate(next);
    });
    return () => { active = false; };
  }, [navigate, next]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    charRef.current?.play("press");
    if (!email.trim() || !password.trim()) {
      shakeForm();
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await withThinking(
          supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: new URL(next, window.location.origin).href },
          })
        );
        if (error) throw error;
        await charRef.current?.play("celebrate");
        toast({ title: "تم إنشاء الحساب ✅", description: "تحقق من بريدك الإلكتروني" });
      } else {
        const { error } = await withThinking(supabase.auth.signInWithPassword({ email, password }));
        if (error) throw error;
        await charRef.current?.play("celebrate");
        setTimeout(() => navigate(next), 500);
      }
    } catch (err: any) {
      shakeForm();
      toast({ title: "خطأ", description: err.message || "حدث خطأ", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const isInAppBrowser = () => {
    const ua = navigator.userAgent || "";
    return /FBAN|FBAV|Instagram|Line|MicroMessenger|WeChat|Twitter|TikTok|Snapchat|Pinterest|LinkedInApp|Messenger|wv\)/i.test(ua);
  };

  const copyAndNotify = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "تم نسخ الرابط ✅", description: "افتح Chrome أو Safari والصق الرابط." });
    } catch {
      toast({ title: "افتح في متصفح حقيقي", description: window.location.href });
    }
  };

  const handleGoogleLogin = async () => {
    charRef.current?.play("press");
    if (isInAppBrowser()) {
      toast({
        title: "⚠️ افتح في متصفح حقيقي",
        description: "Google لا يسمح بتسجيل الدخول من داخل تطبيقات مثل Instagram أو TikTok.",
        variant: "destructive",
      });
      await copyAndNotify();
      return;
    }
    setLoading(true);
    try {
      if (next !== "/") window.sessionStorage.setItem("ilyass-oauth-next", next);
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        window.sessionStorage.removeItem("ilyass-oauth-next");
        toast({ title: "خطأ", description: result.error.message, variant: "destructive" });
      } else if (!result.redirected) {
        window.sessionStorage.removeItem("ilyass-oauth-next");
        navigate(next);
      }
    } catch (err: any) {
      window.sessionStorage.removeItem("ilyass-oauth-next");
      toast({ title: "خطأ", description: err.message || "حدث خطأ", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const passwordHiding = focused === "password";

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        background: "#05020f",
        fontFamily: "Poppins, sans-serif",
      }}
    >
      {/* خلفية نيون ثلاثية الأبعاد */}
      <NeonBackground className="absolute inset-0 z-0" />

      {/* Back button */}
      <div className="p-4 relative z-10">
        <button
          onClick={() => navigate("/")}
          className="h-10 w-10 rounded-full bg-[#e8c88a]/10 backdrop-blur-md border border-[#e8c88a]/30 text-[#f5e6c8] flex items-center justify-center hover:bg-[#e8c88a]/20 transition"
          aria-label="رجوع"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-4 pb-8 relative z-10">
        <div className="w-full max-w-[900px] flex flex-col md:flex-row items-center justify-center gap-2 md:gap-8">

           {/* Uploaded 3D character */}
           <div
             onClick={poke}
             className="flex items-end justify-center w-full md:w-[300px] h-[220px] md:h-[440px] shrink-0 relative overflow-visible cursor-pointer"
           >
             <MikaCharacter
              ref={charRef}
              coverEyes={passwordHiding}
              mood={hovering ? "shy" : mood}
               className="h-full w-full select-none"
            />

            {/* Hover sparkle */}
            <AnimatePresence>
              {hovering && !passwordHiding && (
                <motion.div
                  key="spark"
                  initial={{ opacity: 0, scale: 0, y: 0 }}
                  animate={{ opacity: 1, scale: 1, y: -10 }}
                  exit={{ opacity: 0, scale: 0 }}
                  className="absolute text-3xl pointer-events-none"
                  style={{ top: "8%", right: "20%" }}
                >
                  ✨
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Form card */}
          <AnimatePresence>
            {showForm && (
              <motion.form
                key="form"
                onSubmit={handleEmailAuth}
                initial={{ opacity: 0, y: 40, scale: 0.95 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  x: shake ? [0, -14, 14, -12, 12, -6, 6, 0] : 0,
                }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                transition={{ duration: shake ? 0.55 : 0.5, ease: "easeOut" }}
                className="w-full max-w-[380px] p-7 rounded-[20px] text-center"
                style={{
                  background: "rgba(28, 22, 16, 0.55)",
                  backdropFilter: "blur(18px) saturate(120%)",
                  WebkitBackdropFilter: "blur(18px) saturate(120%)",
                  border: "1px solid rgba(232, 200, 138, 0.35)",
                  boxShadow: "0 0 40px rgba(232, 200, 138, 0.15), 0 20px 60px rgba(0, 0, 0, 0.55)",
                }}
              >
                <h2 className="text-white text-2xl font-bold mb-1">
                  {isSignUp ? "Register Now" : "Welcome Back"}
                </h2>
                <p className="text-white/80 text-xs mb-6">
                  {isSignUp ? "Fill the form to start your journey" : "Sign in to continue your journey"}
                </p>

                <div className="mb-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      charRef.current?.play("typing-email");
                    }}
                    onFocus={() => {
                      setFocused("email");
                      charRef.current?.play("typing-email");
                    }}
                    onBlur={() => setFocused(null)}
                    placeholder="Email"
                    className="w-full py-3 px-5 rounded-full border-0 outline-none text-sm bg-white/95 text-gray-800 focus:bg-white focus:shadow-[0_0_0_3px_rgba(255,255,255,0.4)] transition"
                  />
                </div>

                <div className="mb-4">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      charRef.current?.play("typing-password");
                    }}
                    onFocus={() => setFocused("password")}
                    onBlur={() => setFocused(null)}
                    placeholder="Password"
                    minLength={6}
                    className="w-full py-3 px-5 rounded-full border-0 outline-none text-sm bg-white/95 text-gray-800 focus:bg-white focus:shadow-[0_0_0_3px_rgba(255,255,255,0.4)] transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  onMouseEnter={() => setHovering(true)}
                  onMouseLeave={() => setHovering(false)}
                  onTouchStart={() => setHovering(true)}
                  onTouchEnd={() => setHovering(false)}
                  className="w-full py-3 rounded-full font-bold cursor-pointer transition disabled:opacity-60 hover:brightness-105 active:scale-[.97]"
                  style={{
                    background: "linear-gradient(90deg, #d4a574, #f0d89c)",
                    boxShadow: "0 8px 24px rgba(232, 200, 138, 0.4)",
                    color: "#1a1410",
                  }}
                >
                  {loading ? "..." : isSignUp ? "SIGN UP" : "LOGIN"}
                </button>

                <div className="flex items-center gap-2 my-4">
                  <div className="flex-1 h-px bg-[#e8c88a]/25" />
                  <span className="text-xs text-[#e8c88a]/70">OR</span>
                  <div className="flex-1 h-px bg-white/30" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full py-3 rounded-full font-medium cursor-pointer transition flex items-center justify-center gap-2 bg-white text-gray-800 hover:bg-gray-50 active:scale-[.97] disabled:opacity-60"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>

                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="block mx-auto mt-4 text-[#e8c88a] text-xs hover:underline"
                >
                  {isSignUp ? "Already have an account? Login" : "Don't have an account? Register"}
                </button>

                <div className="mt-3 flex justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => playShow("twerk")}
                    className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    💃 Twerk
                  </Button>
                  {/* ✨ v3: زر العرض المسرحي — ذهبي فاخر يطابق إضاءة المسرح */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => playShow("poleSpin")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition active:scale-95 disabled:opacity-50"
                    style={{
                      background: "linear-gradient(135deg, rgba(232,200,138,0.22), rgba(139,92,246,0.12))",
                      border: "1px solid rgba(232,200,138,0.45)",
                      color: "#f0d89c",
                      boxShadow: "0 4px 14px rgba(232,200,138,0.25)",
                    }}
                  >
                    <span>✨</span>
                    <span>Pole Dance</span>
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;