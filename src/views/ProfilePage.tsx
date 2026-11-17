import { useState, useEffect } from "react";
import { useNavigate } from "@/lib/nav";
import { accountClient as supabase } from "@/lib/account-client";
import type { User as SupaUser } from "@supabase/supabase-js";
import { ArrowLeft, LogOut, MessageSquare, Calendar, Zap, Crown, Edit2, Check, X, Infinity as InfinityIcon, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import aiLogoAsset from "@/assets/ai-logo.png.asset.json";
const aiLogo = aiLogoAsset.url;
import { verifyUnlockCode } from "@/lib/unlock";

interface ProfileData {
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface UsageStats {
  totalRequests: number;
  todayRequests: number;
  daysActive: number;
}

const profileFromUser = (user: SupaUser): ProfileData => {
  const metadata = user.user_metadata;
  return {
    display_name: metadata.display_name ?? metadata.full_name ?? metadata.name ?? null,
    avatar_url: metadata.avatar_url ?? metadata.picture ?? null,
    created_at: user.created_at,
  };
};

const ProfilePage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<UsageStats>({ totalRequests: 0, todayRequests: 0, daysActive: 0 });
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [unlocked, setUnlocked] = useState<boolean>(() => localStorage.getItem("ilyass-unlocked") === "1");
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [codeInput, setCodeInput] = useState("");

  const [verifying, setVerifying] = useState(false);

  const handleUnlock = async () => {
    const code = codeInput.trim();
    if (!code || verifying) return;
    setVerifying(true);
    const ok = await verifyUnlockCode(code); // التحقق يتم على الخادم
    setVerifying(false);
    if (ok) {
      localStorage.setItem("ilyass-unlock-code", code);
      localStorage.setItem("ilyass-unlocked", "1");
      setUnlocked(true);
      setShowCodeInput(false);
      setCodeInput("");
      toast({ title: "🎉 تم التفعيل", description: "أصبح استخدامك للذكاء الاصطناعي غير محدود!" });
    } else {
      toast({ title: "❌ كود غير صحيح", description: "يرجى التحقق من الكود وإعادة المحاولة.", variant: "destructive" });
    }
  };

  // مستخدمون فعّلوا قبل هذا التحديث: نتحقق من كودهم المخزن مرة واحدة بصمت
  useEffect(() => {
    const stored = localStorage.getItem("ilyass-unlock-code");
    if (stored && localStorage.getItem("ilyass-unlocked") !== "1") {
      verifyUnlockCode(stored).then((ok) => {
        if (ok) { localStorage.setItem("ilyass-unlocked", "1"); setUnlocked(true); }
        else localStorage.removeItem("ilyass-unlock-code");
      });
    }
  }, []);

  const handleRevoke = () => {
    localStorage.removeItem("ilyass-unlock-code");
    localStorage.removeItem("ilyass-unlocked");
    setUnlocked(false);
    toast({ title: "تم إلغاء التفعيل" });
  };

  useEffect(() => {
    let cancelled = false;
    const withTimeout = <T,>(p: PromiseLike<T>, ms: number): Promise<T | null> =>
      Promise.race([Promise.resolve(p), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

    const loadData = async (u: SupaUser) => {
      try {
        const deviceId = localStorage.getItem("ilyass-device-id");
        if (deviceId) {
          const usageRes: any = await withTimeout(
            fetch("/api/usage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deviceId }),
            }).then((r) => r.json()),
            8000,
          );
          const usageData = usageRes?.rows as { request_count: number; request_date: string }[] | undefined;
          if (!cancelled && usageData && usageData.length > 0) {
            const total = usageData.reduce((sum, d) => sum + d.request_count, 0);
            const today = new Date().toISOString().split("T")[0];
            const todayRow = usageData.find((d) => d.request_date === today);
            setStats({
              totalRequests: total,
              todayRequests: todayRow?.request_count || 0,
              daysActive: usageData.length,
            });
          }
        }
      } catch (e) {
        console.error("profile data failed", e);
      }
    };

    const init = async () => {
      try {
        const res = await withTimeout(supabase.auth.getUser(), 6000);
        const u = res?.data?.user ?? null;
        if (cancelled) return;
        if (!u) {
          navigate("/auth");
          return;
        }
        setUser(u);
        const userProfile = profileFromUser(u);
        setProfile(userProfile);
        setNewName(userProfile.display_name || "");
        setLoading(false); // show the page immediately; details fill in after
        loadData(u);
      } catch (e) {
        console.error("profile init failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user && !cancelled) {
        setUser(session.user);
        const userProfile = profileFromUser(session.user);
        setProfile(userProfile);
        setNewName(userProfile.display_name || "");
        setLoading(false);
        setTimeout(() => loadData(session.user), 0);
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdateName = async () => {
    if (!user || !newName.trim()) return;
    const { data, error } = await supabase.auth.updateUser({
      data: { display_name: newName.trim() },
    });

    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    } else {
      if (data.user) {
        setUser(data.user);
        setProfile(profileFromUser(data.user));
      } else {
        setProfile((p) => p ? { ...p, display_name: newName.trim() } : p);
      }
      setEditingName(false);
      toast({ title: "✅ تم التحديث" });
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <img src={aiLogo} alt="AI" className="h-8 w-8 animate-pulse rounded-lg" />
          <span>جاري التحميل...</span>
        </div>
      </div>
    );
  }

  const displayName = profile?.display_name || user?.email?.split("@")[0] || "مستخدم";
  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url;
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString("ar-MA", { year: "numeric", month: "long", day: "numeric" })
    : "";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-lg">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate("/")} className="glass-icon-btn h-10 w-10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold" style={{ fontFamily: "Poppins, sans-serif" }}>
            الملف الشخصي
          </h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[95%] md:max-w-[600px] py-6 space-y-6">
        {/* Avatar & Name Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="ai-response-card rounded-[24px] p-6 flex flex-col items-center gap-4"
        >
          {/* Avatar */}
          <div className="relative">
            <div className="h-24 w-24 rounded-full border-4 border-primary/30 overflow-hidden bg-muted flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-primary">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <span className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-accent border-3 border-card flex items-center justify-center">
              <Check className="h-3 w-3 text-accent-foreground" />
            </span>
          </div>

          {/* Name */}
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleUpdateName()}
              />
              <button onClick={handleUpdateName} className="glass-icon-btn h-8 w-8">
                <Check className="h-4 w-4 text-accent" />
              </button>
              <button onClick={() => setEditingName(false)} className="glass-icon-btn h-8 w-8">
                <X className="h-4 w-4 text-destructive" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{displayName}</h2>
              <button onClick={() => setEditingName(true)} className="text-muted-foreground hover:text-foreground transition-colors">
                <Edit2 className="h-4 w-4" />
              </button>
            </div>
          )}

          <p className="text-sm text-muted-foreground">{user?.email}</p>

          {memberSince && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
              <Calendar className="h-3.5 w-3.5" />
              <span>عضو منذ {memberSince}</span>
            </div>
          )}
        </motion.div>

        {/* Usage Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-3"
        >
          <div className="ai-response-card rounded-[20px] p-4 flex flex-col items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <span className="text-2xl font-bold">{stats.totalRequests}</span>
            <span className="text-xs text-muted-foreground text-center">إجمالي الطلبات</span>
          </div>

          <div className="ai-response-card rounded-[20px] p-4 flex flex-col items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center">
              <Zap className="h-5 w-5 text-accent" />
            </div>
            <span className="text-2xl font-bold">{stats.todayRequests}<span className="text-sm text-muted-foreground">/3</span></span>
            <span className="text-xs text-muted-foreground text-center">طلبات اليوم</span>
          </div>

          <div className="ai-response-card rounded-[20px] p-4 flex flex-col items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-secondary/10 flex items-center justify-center">
              <Crown className="h-5 w-5 text-secondary" />
            </div>
            <span className="text-2xl font-bold">{stats.daysActive}</span>
            <span className="text-xs text-muted-foreground text-center">أيام نشطة</span>
          </div>
        </motion.div>

        {/* Usage Progress */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="ai-response-card rounded-[20px] p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">استخدام اليوم</span>
            <span className="text-xs text-muted-foreground">
              {unlocked ? "∞ غير محدود" : `${stats.todayRequests} / 3`}
            </span>
          </div>
          {!unlocked && (
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min((stats.todayRequests / 3) * 100, 100)}%` }}
                transition={{ duration: 0.8, ease: "easeOut", delay: 0.4 }}
                className={`h-full rounded-full ${
                  stats.todayRequests >= 3
                    ? "bg-destructive"
                    : stats.todayRequests >= 2
                    ? "bg-yellow-500"
                    : "bg-accent"
                }`}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {unlocked
              ? "✨ تم تفعيل الاستخدام غير المحدود — استمتع!"
              : stats.todayRequests >= 3
              ? "⚠️ استهلكت جميع محاولاتك اليوم. عد غداً!"
              : `متبقي ${3 - stats.todayRequests} محاولات لهذا اليوم`}
          </p>
        </motion.div>

        {/* Unlock / Premium card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="ai-response-card rounded-[20px] p-5 space-y-3"
          dir="rtl"
        >
          <div className="flex items-center gap-2">
            <div className={`h-9 w-9 rounded-full flex items-center justify-center ${unlocked ? "bg-accent/15" : "bg-primary/10"}`}>
              {unlocked ? <InfinityIcon className="h-5 w-5 text-accent" /> : <Sparkles className="h-5 w-5 text-primary" />}
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold">
                {unlocked ? "الاستخدام غير المحدود مُفعّل" : "تفعيل الاستخدام غير المحدود"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {unlocked ? "تم رفع حد الـ 3 طلبات يومياً." : "أدخل كود التفعيل الخاص بك لرفع الحد اليومي."}
              </p>
            </div>
          </div>

          {unlocked ? (
            <button
              onClick={handleRevoke}
              className="w-full rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]"
            >
              إلغاء التفعيل
            </button>
          ) : showCodeInput ? (
            <div className="space-y-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                placeholder="ادخل الكود هنا"
                autoFocus
                dir="ltr"
                className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-center text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleUnlock}
                  disabled={verifying}
                  className="flex-1 rounded-xl bg-gradient-to-r from-primary to-secondary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                >
                  {verifying ? "..." : "تفعيل"}
                </button>
                <button
                  onClick={() => { setShowCodeInput(false); setCodeInput(""); }}
                  className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]"
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCodeInput(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98]"
            >
              <Sparkles className="h-4 w-4" />
              إدخال كود التفعيل
            </button>
          )}
        </motion.div>

        {/* Sign Out */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3.5 text-sm font-medium text-destructive transition-all hover:bg-destructive/10 active:scale-[0.98]"
          >
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default ProfilePage;
