"use strict";
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Shield, Check, Globe, HelpCircle, Loader2, Sparkles, Type, Volume2, ExternalLink, ChevronRight, AlertCircle, CheckCircle2, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const Instagram = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
  >
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const Youtube = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
  >
    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17z" />
    <polygon points="10 15 15 12 10 9" />
  </svg>
);

export default function SettingsPage() {
  const router = useRouter();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [pexelsApiKey, setPexelsApiKey] = useState("");
  const [pixabayApiKey, setPixabayApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [igConnected, setIgConnected] = useState(false);
  const [igPublishMode, setIgPublishMode] = useState<"manual" | "direct">("manual");
  const [igHandle, setIgHandle] = useState("");
  const [igAccessToken, setIgAccessToken] = useState("");
  const [igAccountId, setIgAccountId] = useState("");
  
  const [ytConnected, setYtConnected] = useState(false);
  const [ytHandle, setYtHandle] = useState("");
  const [ytAccessToken, setYtAccessToken] = useState("");
  const [ytRefreshToken, setYtRefreshToken] = useState("");
  const [ytClientId, setYtClientId] = useState("");
  const [ytClientSecret, setYtClientSecret] = useState("");
  
  // AI Curation Preferences
  const [aiModel, setAiModel] = useState("gemini-2.0-flash");
  const [aiTone, setAiTone] = useState("clickbait");
  const [aiInstructions, setAiInstructions] = useState("");
  
  // Subtitle Burnt-In Defaults
  const [subFont, setSubFont] = useState("Montserrat");
  const [subColor, setSubColor] = useState("#FFFF00");
  const [subSize, setSubSize] = useState("lg");
  const [subStroke, setSubStroke] = useState(true);
  const [subUppercase, setSubUppercase] = useState(true);
  
  // Audio defaults
  const [musicVol, setMusicVol] = useState(0.15);
  const [duckLevel, setDuckLevel] = useState(0.80);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [connectingPlatform, setConnectingPlatform] = useState<"Instagram" | "YouTube" | null>(null);
  const [simStep, setSimStep] = useState(0);

  // Instagram Meta Business Suite real verification
  const [igVerifying, setIgVerifying] = useState(false);
  const [igVerifyError, setIgVerifyError] = useState("");
  const [igVerifiedName, setIgVerifiedName] = useState("");
  const [showIgGuide, setShowIgGuide] = useState(false);
  const [igGuideStep, setIgGuideStep] = useState(0);

  // API Connection Live Validator states
  const [verifyingConnections, setVerifyingConnections] = useState(false);
  const [connectionStatuses, setConnectionStatuses] = useState<{
    instagram?: { status: string; details: string };
    youtube?: { status: string; details: string };
  } | null>(null);
  const [connectionTestError, setConnectionTestError] = useState("");

  const saveAllSettings = async (overrides: Record<string, any> = {}) => {
    setIsSaving(true);
    setErrorMsg("");
    setSaveSuccess(false);

    const payload = {
      makeWebhookUrl: overrides.makeWebhookUrl !== undefined ? overrides.makeWebhookUrl : webhookUrl,
      instagramConnected: overrides.instagramConnected !== undefined ? overrides.instagramConnected : igConnected,
      instagramAccountName: overrides.instagramAccountName !== undefined ? overrides.instagramAccountName : igHandle,
      instagramAccessToken: overrides.instagramAccessToken !== undefined ? overrides.instagramAccessToken : igAccessToken,
      instagramAccountId: overrides.instagramAccountId !== undefined ? overrides.instagramAccountId : igAccountId,
      youtubeConnected: overrides.youtubeConnected !== undefined ? overrides.youtubeConnected : ytConnected,
      youtubeChannelName: overrides.youtubeChannelName !== undefined ? overrides.youtubeChannelName : ytHandle,
      youtubeAccessToken: overrides.youtubeAccessToken !== undefined ? overrides.youtubeAccessToken : ytAccessToken,
      youtubeRefreshToken: overrides.youtubeRefreshToken !== undefined ? overrides.youtubeRefreshToken : ytRefreshToken,
      youtubeClientId: overrides.youtubeClientId !== undefined ? overrides.youtubeClientId : ytClientId,
      youtubeClientSecret: overrides.youtubeClientSecret !== undefined ? overrides.youtubeClientSecret : ytClientSecret,
      pexelsApiKey: overrides.pexelsApiKey !== undefined ? overrides.pexelsApiKey : pexelsApiKey,
      pixabayApiKey: overrides.pixabayApiKey !== undefined ? overrides.pixabayApiKey : pixabayApiKey,
      geminiApiKey: overrides.geminiApiKey !== undefined ? overrides.geminiApiKey : geminiApiKey,
      aiModel: overrides.aiModel !== undefined ? overrides.aiModel : aiModel,
      aiTone: overrides.aiTone !== undefined ? overrides.aiTone : aiTone,
      aiInstructions: overrides.aiInstructions !== undefined ? overrides.aiInstructions : aiInstructions,
      subtitleFont: overrides.subtitleFont !== undefined ? overrides.subtitleFont : subFont,
      subtitleColor: overrides.subtitleColor !== undefined ? overrides.subtitleColor : subColor,
      subtitleSize: overrides.subtitleSize !== undefined ? overrides.subtitleSize : subSize,
      subtitleStroke: overrides.subtitleStroke !== undefined ? overrides.subtitleStroke : subStroke,
      subtitleUppercase: overrides.subtitleUppercase !== undefined ? overrides.subtitleUppercase : subUppercase,
      defaultMusicVolume: overrides.defaultMusicVolume !== undefined ? overrides.defaultMusicVolume : musicVol,
      duckingLevel: overrides.duckingLevel !== undefined ? overrides.duckingLevel : duckLevel,
    };

    try {
      const res = await fetch("/api/settings/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        if (typeof window !== "undefined") {
          localStorage.setItem("auraclip_pexels_api_key", payload.pexelsApiKey.trim());
          localStorage.setItem("auraclip_pixabay_api_key", payload.pixabayApiKey.trim());
          localStorage.setItem("auraclip_youtube_channel_name", payload.youtubeChannelName || "");
          localStorage.setItem("auraclip_youtube_access_token", payload.youtubeAccessToken || "");
          localStorage.setItem("auraclip_youtube_refresh_token", payload.youtubeRefreshToken || "");
          localStorage.setItem("auraclip_youtube_client_id", payload.youtubeClientId || "");
          localStorage.setItem("auraclip_youtube_client_secret", payload.youtubeClientSecret || "");
          localStorage.setItem("auraclip_instagram_account_name", payload.instagramAccountName || "");
          localStorage.setItem("auraclip_instagram_access_token", payload.instagramAccessToken || "");
          localStorage.setItem("auraclip_instagram_account_id", payload.instagramAccountId || "");
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        return true;
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "Failed to save settings");
        return false;
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerifyInstagram = async () => {
    if (!igAccountId.trim() || !igAccessToken.trim()) {
      setIgVerifyError("Please enter both Instagram Account ID and Access Token.");
      return;
    }
    setIgVerifying(true);
    setIgVerifyError("");
    setIgVerifiedName("");
    try {
      const res = await fetch("/api/instagram/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: igAccountId.trim(), accessToken: igAccessToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIgVerifyError(data.error || "Verification failed.");
      } else {
        const verifiedUsername = data.username || data.name || "Connected";
        const targetHandle = data.username || igHandle;
        setIgVerifiedName(verifiedUsername);
        setIgHandle(targetHandle);
        setIgConnected(true);
        
        // Auto-save verified settings to database immediately
        await saveAllSettings({
          instagramConnected: true,
          instagramAccountName: targetHandle,
          instagramAccessToken: igAccessToken.trim(),
          instagramAccountId: igAccountId.trim(),
        });
      }
    } catch (err: any) {
      setIgVerifyError(err.message || "Network error.");
    } finally {
      setIgVerifying(false);
    }
  };

  const handleTestConnections = async () => {
    setVerifyingConnections(true);
    setConnectionTestError("");
    setConnectionStatuses(null);
    try {
      const res = await fetch("/api/settings/verify-connections", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setConnectionStatuses(data);
      } else {
        const data = await res.json();
        setConnectionTestError(data.error || "Failed to verify connections");
      }
    } catch (err: any) {
      setConnectionTestError(err.message || "Network request failed");
    } finally {
      setVerifyingConnections(false);
    }
  };

  // Load current settings from database on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        let localPexels = "";
        let localPixabay = "";
        let localYtHandle = "";
        let localYtToken = "";
        let localYtRefresh = "";
        let localYtClient = "";
        let localYtSecret = "";
        let localIgHandle = "";
        let localIgToken = "";
        let localIgAccount = "";
        if (typeof window !== "undefined") {
          localPexels = localStorage.getItem("auraclip_pexels_api_key") || "";
          localPixabay = localStorage.getItem("auraclip_pixabay_api_key") || "";
          localYtHandle = localStorage.getItem("auraclip_youtube_channel_name") || "";
          localYtToken = localStorage.getItem("auraclip_youtube_access_token") || "";
          localYtRefresh = localStorage.getItem("auraclip_youtube_refresh_token") || "";
          localYtClient = localStorage.getItem("auraclip_youtube_client_id") || "";
          localYtSecret = localStorage.getItem("auraclip_youtube_client_secret") || "";
          localIgHandle = localStorage.getItem("auraclip_instagram_account_name") || "";
          localIgToken = localStorage.getItem("auraclip_instagram_access_token") || "";
          localIgAccount = localStorage.getItem("auraclip_instagram_account_id") || "";
        }
        const res = await fetch("/api/settings/publish", { cache: "no-store" });
        if (res.status === 401) {
          router.push("/login?callbackUrl=" + encodeURIComponent(window.location.pathname));
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setWebhookUrl(data.makeWebhookUrl || "");
          const isConnected = data.instagramConnected !== undefined && data.instagramConnected !== null ? Boolean(data.instagramConnected) : true;
          setIgConnected(isConnected);
          setIgPublishMode(isConnected ? "direct" : "manual");
          setIgHandle(data.instagramAccountName || localIgHandle || "mock_auraclip_creator");
          setIgAccessToken(data.instagramAccessToken || localIgToken || "mock_instagram_token");
          setIgAccountId(data.instagramAccountId || localIgAccount || "mock_instagram_id");
          const isYtConn = data.youtubeConnected !== undefined && data.youtubeConnected !== null ? Boolean(data.youtubeConnected) : true;
          setYtConnected(isYtConn);
          setYtHandle(data.youtubeChannelName || localYtHandle || "Mock YouTube Channel");
          setYtAccessToken(data.youtubeAccessToken || localYtToken || "mock_youtube_token");
          setYtRefreshToken(data.youtubeRefreshToken || localYtRefresh || "mock_youtube_refresh");
          setYtClientId(data.youtubeClientId || localYtClient || "mock_youtube_client_id");
          setYtClientSecret(data.youtubeClientSecret || localYtSecret || "mock_youtube_client_secret");
          setPexelsApiKey(data.pexelsApiKey || localPexels);
          setPixabayApiKey(data.pixabayApiKey || localPixabay);
          setGeminiApiKey(data.geminiApiKey || "");
          
          setAiModel(data.aiModel || "gemini-2.0-flash");
          setAiTone(data.aiTone || "clickbait");
          setAiInstructions(data.aiInstructions || "");
          setSubFont(data.subtitleFont || "Montserrat");
          setSubColor(data.subtitleColor || "#FFFF00");
          setSubSize(data.subtitleSize || "lg");
          setSubStroke(data.subtitleStroke !== undefined ? data.subtitleStroke : true);
          setSubUppercase(data.subtitleUppercase !== undefined ? data.subtitleUppercase : true);
          setMusicVol(data.defaultMusicVolume !== undefined ? data.defaultMusicVolume : 0.15);
          setDuckLevel(data.duckingLevel !== undefined ? data.duckingLevel : 0.80);

          // Auto-verify connection statuses if any connection is active
          if (isConnected || data.youtubeConnected) {
            fetch("/api/settings/verify-connections", { cache: "no-store" })
              .then((testRes) => {
                if (testRes.ok) return testRes.json();
                return null;
              })
              .then((testData) => {
                if (testData) setConnectionStatuses(testData);
              })
              .catch((err) => console.warn("Auto connection test failed:", err));
          }
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveAllSettings();
  };

  const toggleInstagram = () => {
    if (igConnected) {
      setIgConnected(false);
      setIgHandle("");
      setIgVerifiedName("");
      setIgAccountId("");
      setIgAccessToken("");
      saveAllSettings({
        instagramConnected: false,
        instagramAccountName: "",
        instagramAccessToken: "",
        instagramAccountId: "",
      });
    } else {
      if (!igHandle.trim()) {
        setErrorMsg("Please enter an Instagram handle to connect.");
        return;
      }
      setErrorMsg("");
      setConnectingPlatform("Instagram");
      setSimStep(0);
    }
  };

  const toggleYoutube = () => {
    if (ytConnected) {
      setYtConnected(false);
      setYtHandle("");
      setYtAccessToken("");
      setYtRefreshToken("");
      setYtClientId("");
      setYtClientSecret("");
      saveAllSettings({
        youtubeConnected: false,
        youtubeChannelName: "",
        youtubeAccessToken: "",
        youtubeRefreshToken: "",
        youtubeClientId: "",
        youtubeClientSecret: "",
      });
    } else {
      if (!ytHandle.trim()) {
        setErrorMsg("Please enter a YouTube Channel name to connect.");
        return;
      }
      setErrorMsg("");
      setConnectingPlatform("YouTube");
      setSimStep(0);
    }
  };

  const handleConnectYoutubeSuccess = async () => {
    setYtConnected(true);
    setConnectingPlatform(null);
    await saveAllSettings({
      youtubeConnected: true,
      youtubeChannelName: ytHandle,
      youtubeAccessToken: ytAccessToken,
      youtubeRefreshToken: ytRefreshToken,
      youtubeClientId: ytClientId,
      youtubeClientSecret: ytClientSecret,
    });
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-x-hidden flex flex-col justify-between">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/2 -z-10 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-violet-600/5 via-fuchsia-500/5 to-transparent blur-[120px]" />

      {/* Header bar */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/60 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/40 bg-white/5 text-muted-foreground hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-bold text-white tracking-tight">Integrations & Settings</h1>
          </div>
        </div>
      </header>

      {/* Main settings console */}
      <main className="flex-grow max-w-3xl w-full mx-auto px-4 py-10 sm:px-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="h-8 w-8 text-violet-500 animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Loading configurations...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-8 animate-in fade-in duration-300">
            {/* Make.com Webhook settings card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-border/20 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 border border-violet-500/20 text-violet-400">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Make.com Webhook Integration</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Configure webhook URL to dispatch clip files and copy assets.</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label htmlFor="webhook-url" className="text-xs font-semibold text-slate-300">
                    Webhook Destination URL
                  </label>
                  <a
                    href="https://www.make.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-violet-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    <HelpCircle className="h-3 w-3" /> How to get a Make.com webhook URL?
                  </a>
                </div>
                <input
                  id="webhook-url"
                  type="url"
                  placeholder="https://hook.us1.make.com/..."
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3 text-xs text-white focus:border-violet-500 focus:outline-none placeholder-slate-600 font-mono"
                />
              </div>

              <div className="flex gap-2.5 bg-violet-500/5 border border-violet-500/10 rounded-xl p-4 text-[11px] text-violet-300/90 leading-relaxed font-medium">
                <Shield className="h-4.5 w-4.5 text-violet-400 shrink-0 mt-0.5" />
                <span>
                  By configuring this webhook, publishing a clip will send a multipart form post to Make.com containing: 
                  <code> projectId</code>, <code> clipId</code>, <code> clipTitle</code>, <code> platform</code>, 
                  <code> caption</code>, <code> hashtags</code>, <code> youtubeTitle</code>, <code> youtubeDesc</code>, 
                  and the compiled video clip file as <code>file</code> binary attachment.
                </span>
              </div>
            </div>

            {/* Pexels Stock Video Integration Card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-border/20 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 border border-violet-500/20 text-violet-400">
                  <Sparkles className="h-5 w-5 text-yellow-300" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Pexels Stock API Connection</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Integrate live stock videos and templates directly in the editor uploader.</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label htmlFor="pexels-api-key" className="text-xs font-semibold text-slate-300">
                    Pexels API Key
                  </label>
                  <a
                    href="https://www.pexels.com/api/new/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-violet-400 hover:underline flex items-center gap-1 font-medium animate-pulse"
                  >
                    Get Free Pexels API Key
                  </a>
                </div>
                <input
                  id="pexels-api-key"
                  type="password"
                  placeholder="Paste your Pexels API key here..."
                  value={pexelsApiKey}
                  onChange={(e) => setPexelsApiKey(e.target.value)}
                  className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3 text-xs text-white focus:border-violet-500 focus:outline-none placeholder-slate-700 font-mono"
                />
              </div>

              <div className="flex gap-2.5 bg-violet-500/5 border border-violet-500/10 rounded-xl p-4 text-[11px] text-violet-300/90 leading-relaxed font-medium">
                <Shield className="h-4.5 w-4.5 text-violet-400 shrink-0 mt-0.5" />
                <span>
                  The API key is stored locally in your browser&apos;s secure storage. Once configured, you will be able to search and import Pexels&apos; shared video database in real-time.
                </span>
              </div>
            </div>

            {/* Pixabay Stock Video Integration Card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-border/20 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 border border-violet-500/20 text-violet-400">
                  <Sparkles className="h-5 w-5 text-yellow-300" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Pixabay Stock API Connection</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Integrate live stock videos and templates directly in the editor uploader.</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label htmlFor="pixabay-api-key" className="text-xs font-semibold text-slate-300">
                    Pixabay API Key
                  </label>
                  <a
                    href="https://pixabay.com/api/docs/#api_key"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-violet-400 hover:underline flex items-center gap-1 font-medium animate-pulse"
                  >
                    Get Free Pixabay API Key
                  </a>
                </div>
                <input
                  id="pixabay-api-key"
                  type="password"
                  placeholder="Paste your Pixabay API key here..."
                  value={pixabayApiKey}
                  onChange={(e) => setPixabayApiKey(e.target.value)}
                  className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3 text-xs text-white focus:border-violet-500 focus:outline-none placeholder-slate-700 font-mono"
                />
              </div>

              <div className="flex gap-2.5 bg-violet-500/5 border border-violet-500/10 rounded-xl p-4 text-[11px] text-violet-300/90 leading-relaxed font-medium">
                <Shield className="h-4.5 w-4.5 text-violet-400 shrink-0 mt-0.5" />
                <span>
                  The API key is stored locally in your browser&apos;s secure storage. Once configured, you will be able to search and import Pixabay&apos;s shared video database in real-time.
                </span>
              </div>
            </div>

            {/* AI Curation preferences card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-border/20 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 border border-violet-500/20 text-violet-400">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">AI Curation Preferences</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Customize default Gemini model settings and copywriting tones.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Default AI Model</label>
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-xs text-slate-200 focus:border-violet-500 focus:outline-none cursor-pointer"
                  >
                    <option value="gemini-2.0-flash" className="bg-slate-900 text-white">Gemini 2.0 Flash (Fast & Cost-Efficient)</option>
                    <option value="gemini-2.0-pro" className="bg-slate-900 text-white">Gemini 2.0 Pro (High Curation Accuracy)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Copywriting Tone of Voice</label>
                  <select
                    value={aiTone}
                    onChange={(e) => setAiTone(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-xs text-slate-200 focus:border-violet-500 focus:outline-none cursor-pointer"
                  >
                    <option value="clickbait" className="bg-slate-900 text-white">Hyped Clickbait (Viral Hooks)</option>
                    <option value="professional" className="bg-slate-900 text-white">Professional & Informative</option>
                    <option value="educational" className="bg-slate-900 text-white">Educational / Direct Lessons</option>
                    <option value="storyteller" className="bg-slate-900 text-white">Dramatic Storyteller</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <label htmlFor="gemini-api-key" className="text-xs font-semibold text-slate-300">
                    Gemini API Key (Custom)
                  </label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-violet-400 hover:underline flex items-center gap-1 font-medium animate-pulse"
                  >
                    Get Free Gemini API Key
                  </a>
                </div>
                <input
                  id="gemini-api-key"
                  type="password"
                  placeholder="Paste your Gemini API key from Google AI Studio..."
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="w-full rounded-xl border border-border/40 bg-slate-950/40 px-4 py-3 text-xs text-white focus:border-violet-500 focus:outline-none placeholder-slate-700 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Custom System Instructions (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Focus on extracting specific programming lessons, avoid generic inspirational talk..."
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  className="w-full rounded-lg border border-border/40 bg-slate-950/40 p-2.5 text-xs text-white focus:border-violet-500 focus:outline-none placeholder-slate-700"
                />
              </div>
            </div>

            {/* Subtitle styling defaults card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-border/20 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400">
                  <Type className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Burnt-In Subtitles Defaults</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Define default caption font styles and sizing presets for export.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Font Family</label>
                  <select
                    value={subFont}
                    onChange={(e) => setSubFont(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-xs text-slate-200 focus:border-pink-500 focus:outline-none cursor-pointer"
                  >
                    <option value="Montserrat" className="bg-slate-900 text-white">Montserrat (Modern)</option>
                    <option value="Impact" className="bg-slate-900 text-white">Impact (Classic Viral)</option>
                    <option value="Inter" className="bg-slate-900 text-white">Inter (Clean)</option>
                    <option value="Arial" className="bg-slate-900 text-white">Arial (Standard)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Text Color</label>
                  <select
                    value={subColor}
                    onChange={(e) => setSubColor(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-xs text-slate-200 focus:border-pink-500 focus:outline-none cursor-pointer"
                  >
                    <option value="#FFFF00" className="bg-slate-900 text-white">Yellow (#FFFF00)</option>
                    <option value="#FFFFFF" className="bg-slate-900 text-white">White (#FFFFFF)</option>
                    <option value="#00FF00" className="bg-slate-900 text-white">Green (#00FF00)</option>
                    <option value="#00FFFF" className="bg-slate-900 text-white">Cyan (#00FFFF)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Size Preset</label>
                  <select
                    value={subSize}
                    onChange={(e) => setSubSize(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-xs text-slate-200 focus:border-pink-500 focus:outline-none cursor-pointer"
                  >
                    <option value="sm" className="bg-slate-900 text-white">Small</option>
                    <option value="md" className="bg-slate-900 text-white">Medium</option>
                    <option value="lg" className="bg-slate-900 text-white">Large</option>
                    <option value="xl" className="bg-slate-900 text-white">Extra Large</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-6 pt-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subStroke}
                    onChange={(e) => setSubStroke(e.target.checked)}
                    className="rounded border-border/40 bg-slate-950 accent-pink-500 h-4 w-4"
                  />
                  Apply Outlined Stroke Shadow
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subUppercase}
                    onChange={(e) => setSubUppercase(e.target.checked)}
                    className="rounded border-border/40 bg-slate-950 accent-pink-500 h-4 w-4"
                  />
                  FORCE UPPERCASE TEXT STYLE
                </label>
              </div>
            </div>

            {/* Audio defaults card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-4 shadow-xl">
              <div className="flex items-center gap-3 border-b border-border/20 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/10 border border-violet-500/20 text-violet-400">
                  <Volume2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Audio & Music Defaults</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Configure default background track mixes and speech volume ducking ratios.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="text-xs font-semibold text-slate-300">Default Music Volume</label>
                    <span className="text-[10px] text-violet-400 font-bold">{Math.round(musicVol * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={musicVol}
                    onChange={(e) => setMusicVol(parseFloat(e.target.value))}
                    className="w-full accent-violet-500 bg-slate-950/60 border border-border/40 rounded-lg h-2 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="text-xs font-semibold text-slate-300">Speech Ducking Intensity</label>
                    <span className="text-[10px] text-violet-400 font-bold">{Math.round(duckLevel * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="0.95"
                    step="0.01"
                    value={duckLevel}
                    onChange={(e) => setDuckLevel(parseFloat(e.target.value))}
                    className="w-full accent-violet-500 bg-slate-950/60 border border-border/40 rounded-lg h-2 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Social channels connection card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-6 shadow-xl">
              <div className="border-b border-border/20 pb-4">
                <h2 className="text-base font-bold text-white">Social Media Connections</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Connect your Meta Business account to publish Reels directly from AuraClip.</p>
              </div>

              <div className="space-y-6">
                {/* Live connection validator */}
                {(igConnected || ytConnected) && (
                  <div className="p-4.5 rounded-xl border border-violet-500/25 bg-violet-500/5 space-y-3.5 animate-in fade-in duration-300">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Shield className="h-3.5 w-3.5 text-violet-400" />
                          API Connection Live Status
                        </h4>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Perform a live verification check to ensure your API Access Tokens are still valid.
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={handleTestConnections}
                        disabled={verifyingConnections}
                        className="h-8.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer shadow-lg shadow-violet-900/10"
                      >
                        {verifyingConnections ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            Verifying...
                          </>
                        ) : (
                          "Test Connections"
                        )}
                      </Button>
                    </div>

                    {connectionTestError && (
                      <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
                        ⚠️ {connectionTestError}
                      </div>
                    )}

                    {connectionStatuses && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3.5 border-t border-border/10">
                        {igConnected && connectionStatuses.instagram && (
                          <div className="flex flex-col gap-1.5 bg-slate-950/40 p-3 rounded-lg border border-border/25">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                                <Instagram className="h-3.5 w-3.5 text-pink-400" />
                                Instagram Graph API
                              </span>
                              <span className={`font-extrabold ${
                                connectionStatuses.instagram.status === "valid" 
                                  ? "text-emerald-400" 
                                  : connectionStatuses.instagram.status === "mock"
                                    ? "text-violet-400"
                                    : "text-rose-400"
                              }`}>
                                {connectionStatuses.instagram.status === "valid" && "✓ Active"}
                                {connectionStatuses.instagram.status === "mock" && "✓ Active (Mock)"}
                                {connectionStatuses.instagram.status === "invalid" && "✗ Expired / Invalid"}
                                {connectionStatuses.instagram.status === "unconfigured" && "✗ Unconfigured"}
                              </span>
                            </div>
                            {connectionStatuses.instagram.details && (
                              <span className="text-[10px] text-slate-400 italic break-words leading-relaxed" title={connectionStatuses.instagram.details}>
                                {connectionStatuses.instagram.details}
                              </span>
                            )}
                          </div>
                        )}

                        {ytConnected && connectionStatuses.youtube && (
                          <div className="flex flex-col gap-1.5 bg-slate-950/40 p-3 rounded-lg border border-border/25">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                                <Youtube className="h-3.5 w-3.5 text-rose-500" />
                                YouTube Shorts API
                              </span>
                              <span className={`font-extrabold ${
                                connectionStatuses.youtube.status === "valid" 
                                  ? "text-emerald-400" 
                                  : connectionStatuses.youtube.status === "mock"
                                    ? "text-violet-400"
                                    : "text-rose-400"
                              }`}>
                                {connectionStatuses.youtube.status === "valid" && "✓ Active"}
                                {connectionStatuses.youtube.status === "mock" && "✓ Active (Mock)"}
                                {connectionStatuses.youtube.status === "invalid" && "✗ Expired / Invalid"}
                                {connectionStatuses.youtube.status === "unconfigured" && "✗ Unconfigured"}
                              </span>
                            </div>
                            {connectionStatuses.youtube.details && (
                              <span className="text-[10px] text-slate-400 italic break-words leading-relaxed" title={connectionStatuses.youtube.details}>
                                {connectionStatuses.youtube.details}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Instagram — Meta Business Suite Card */}
                <div className="space-y-4 p-5 rounded-xl bg-slate-950/20 border border-border/20">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500/20 to-orange-500/20 border border-pink-500/30 text-pink-400 shrink-0">
                        <Instagram className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">Instagram Reels</h4>
                          {igConnected && (
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              LIVE
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Direct publish via Meta Graph API · Requires Business Account</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setShowIgGuide(true); setIgGuideStep(0); }}
                      className="text-[10px] font-semibold text-pink-400 hover:text-pink-300 flex items-center gap-1 shrink-0 mt-1 transition-colors"
                    >
                      <HelpCircle className="h-3 w-3" />
                      Setup Guide
                    </button>
                  </div>

                  {/* Connected state */}
                  {igConnected ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center text-white text-[11px] font-bold">
                            {(igVerifiedName || igHandle).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white">@{igVerifiedName || igHandle}</p>
                            <p className="text-[9px] text-emerald-400">Verified · Ready to publish Reels</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setIgConnected(false); setIgHandle(""); setIgVerifiedName(""); setIgAccountId(""); setIgAccessToken(""); }}
                          className="text-[10px] text-slate-400 hover:text-rose-400 font-semibold transition-colors"
                        >
                          Disconnect
                        </button>
                      </div>

                      {/* Show token fields for editing when connected */}
                      <details className="group">
                        <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300 font-medium list-none flex items-center gap-1">
                          <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform" />
                          Edit credentials
                        </summary>
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Instagram Business Account ID</label>
                            <input
                              type="text"
                              placeholder="e.g. 17841405822304917"
                              value={igAccountId}
                              onChange={(e) => { setIgAccountId(e.target.value); setIgConnected(false); setIgVerifiedName(""); }}
                              className="h-8 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-[10px] text-white focus:border-pink-500 focus:outline-none placeholder-slate-800 font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase">Page Access Token</label>
                            <input
                              type="password"
                              placeholder="EAAGb..."
                              value={igAccessToken}
                              onChange={(e) => { setIgAccessToken(e.target.value); setIgConnected(false); setIgVerifiedName(""); }}
                              className="h-8 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-[10px] text-white focus:border-pink-500 focus:outline-none placeholder-slate-800 font-mono"
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  ) : (
                    /* Not connected — show credential entry + verify button */
                    <div className="space-y-4">
                      {/* Step indicator */}
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[9px] text-slate-400">1</span>
                        Get credentials from Meta Business Suite
                        <ChevronRight className="h-3 w-3" />
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[9px] text-slate-400">2</span>
                        Paste below
                        <ChevronRight className="h-3 w-3" />
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[9px] text-slate-400">3</span>
                        Verify
                      </div>

                      <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-300/90 leading-relaxed">
                        💡 <strong>Meta Configuration Tip:</strong> Make sure the <strong>Facebook Login</strong> (or <strong>Facebook Login for Business</strong>) product is added to your App in the Meta Developer Console. Without it, token validation will fail.
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-300 flex items-center gap-1.5">
                            Instagram Business Account ID
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. 17841405822304917"
                            value={igAccountId}
                            onChange={(e) => { setIgAccountId(e.target.value); setIgVerifyError(""); }}
                            className="h-9 w-full rounded-xl border border-border/40 bg-slate-950/60 px-3 text-xs text-white focus:border-pink-500 focus:outline-none placeholder-slate-700 font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-300 flex items-center gap-1.5">
                            Page Access Token
                          </label>
                          <input
                            type="password"
                            placeholder="EAAGb0ZBNQ8..."
                            value={igAccessToken}
                            onChange={(e) => { setIgAccessToken(e.target.value); setIgVerifyError(""); }}
                            className="h-9 w-full rounded-xl border border-border/40 bg-slate-950/60 px-3 text-xs text-white focus:border-pink-500 focus:outline-none placeholder-slate-700 font-mono"
                          />
                        </div>
                      </div>

                      {/* Error banner */}
                      {igVerifyError && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 text-[11px] text-rose-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>{igVerifyError}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleVerifyInstagram}
                          disabled={igVerifying || !igAccountId || !igAccessToken}
                          className="flex items-center gap-2 h-9 px-5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-pink-900/20"
                        >
                          {igVerifying ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying...</>
                          ) : (
                            <><CheckCircle2 className="h-3.5 w-3.5" /> Verify & Connect</>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowIgGuide(true); setIgGuideStep(0); }}
                          className="text-[11px] text-slate-400 hover:text-pink-400 font-semibold transition-colors flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          How do I get these?
                        </button>
                      </div>
                    </div>
                  )}
                </div>


                {/* YouTube Channel Box */}
                <div className="space-y-4 p-4 rounded-xl bg-slate-950/20 border border-border/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-600/10 border border-rose-500/20 text-rose-500">
                        <Youtube className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">YouTube Shorts Channel</h4>
                        <p className="text-[10px] text-muted-foreground">Automatically post YouTube Shorts via direct API or Webhook.</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {ytConnected ? (
                        <>
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                            Connected: {ytHandle}
                          </span>
                          <Button
                            type="button"
                            onClick={toggleYoutube}
                            className="h-8 px-4 text-xs font-bold bg-white/5 border border-border/30 hover:bg-rose-600 hover:text-white rounded-lg cursor-pointer"
                          >
                            Disconnect
                          </Button>
                        </>
                      ) : (
                        <>
                          <input
                            type="text"
                            placeholder="My Channel Name"
                            value={ytHandle}
                            onChange={(e) => setYtHandle(e.target.value)}
                            className="h-8 rounded-lg border border-border/40 bg-slate-950/40 px-3 text-[11px] text-white focus:border-violet-500 focus:outline-none placeholder-slate-700 w-36"
                          />
                          <Button
                            type="button"
                            onClick={toggleYoutube}
                            className="h-8 px-4 text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white rounded-lg cursor-pointer"
                          >
                            Connect
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {ytConnected && (
                    <div className="border-t border-border/15 pt-4 space-y-3.5 animate-in slide-in-from-top-2 duration-200">
                      <h5 className="text-[11px] font-bold text-slate-300">Direct YouTube Data API OAuth Credentials (Optional)</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Client ID</label>
                          <input
                            type="text"
                            placeholder="client-id.apps.googleusercontent.com"
                            value={ytClientId}
                            onChange={(e) => setYtClientId(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-[10px] text-white focus:border-rose-500 focus:outline-none placeholder-slate-800 font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Client Secret</label>
                          <input
                            type="password"
                            placeholder="GOCSPX-..."
                            value={ytClientSecret}
                            onChange={(e) => setYtClientSecret(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-[10px] text-white focus:border-rose-500 focus:outline-none placeholder-slate-800 font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Access Token</label>
                          <input
                            type="password"
                            placeholder="ya29.a0..."
                            value={ytAccessToken}
                            onChange={(e) => setYtAccessToken(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-[10px] text-white focus:border-rose-500 focus:outline-none placeholder-slate-800 font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Refresh Token</label>
                          <input
                            type="password"
                            placeholder="1//0..."
                            value={ytRefreshToken}
                            onChange={(e) => setYtRefreshToken(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border/40 bg-slate-950/60 px-3 text-[10px] text-white focus:border-rose-500 focus:outline-none placeholder-slate-800 font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error messaging */}
            {errorMsg && (
              <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-xs text-rose-400">
                ⚠️ {errorMsg}
              </div>
            )}

            {/* Save bar */}
            <div className="flex items-center justify-between border-t border-border/20 pt-6">
              <span className="text-xs text-muted-foreground">
                All settings are stored locally on your server.
              </span>
              <div className="flex items-center gap-3">
                {saveSuccess && (
                  <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 animate-pulse bg-emerald-500/10 px-3.5 py-1.5 rounded-full border border-emerald-500/20">
                    <Check className="h-4 w-4 text-emerald-400" />
                    Configuration Saved!
                  </span>
                )}
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-xs font-bold text-white px-8 py-5 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 transition-all cursor-pointer shadow-lg shadow-violet-900/10"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Integrations
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        )}
      </main>

      {/* Instagram Meta Business Suite Setup Guide Modal */}
      {showIgGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-border/40 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Guide header */}
            <div className="p-5 flex items-center justify-between border-b border-border/20 bg-gradient-to-r from-pink-600/20 to-orange-600/20">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-600 to-orange-600 text-white font-extrabold text-xs">
                  f
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Meta Business Suite Setup</h3>
                  <p className="text-[10px] text-slate-400">Connect your Instagram Business Account</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowIgGuide(false)} className="text-slate-500 hover:text-white transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Step tabs */}
            <div className="flex border-b border-border/20">
              {["1. Create App", "2. Get Account ID", "3. Get Token"].map((label, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIgGuideStep(i)}
                  className={`flex-1 py-2.5 text-[10px] font-bold transition-colors ${
                    igGuideStep === i
                      ? "border-b-2 border-pink-500 text-pink-400 bg-pink-500/5"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Step content */}
            <div className="p-5 overflow-y-auto flex-grow text-xs text-slate-300 space-y-4">
              {igGuideStep === 0 && (
                <div className="space-y-4">
                  <p className="text-slate-400 leading-relaxed">You need a <strong className="text-white">Meta Developer App</strong> to use the Instagram Graph API. This is free and takes ~5 minutes. <strong className="text-pink-400">You only need to do this once.</strong></p>

                  <div className="space-y-3">
                    {[
                      { n: 1, text: "Go to", link: "https://developers.facebook.com", linkText: "developers.facebook.com", after: "and log in with your Facebook account." },
                      { n: 2, text: "Click \"My Apps\" → \"Create App\".", link: null },
                      { n: 3, text: "Select \"Other\" as use case → choose \"Business\" type → give your app a name (e.g. \"AuraClip\").", link: null },
                      { n: 4, text: "In your new app dashboard, click \"Add Product\" and add both \"Instagram Graph API\" and \"Facebook Login\" (or \"Facebook Login for Business\").", link: null },
                      { n: 5, text: "Your Instagram account must be a", link: null, suffix: true },
                    ].map((step, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pink-500/20 text-[9px] font-bold text-pink-400">{step.n}</span>
                        <p className="leading-relaxed">
                          {step.text}{" "}
                          {step.link && (
                            <a href={step.link} target="_blank" rel="noreferrer" className="text-pink-400 hover:underline inline-flex items-center gap-0.5">
                              {step.linkText} <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                          {step.after && ` ${step.after}`}
                          {step.suffix && (
                            <> <strong className="text-white">Business or Creator Professional Account</strong>. Go to Instagram → Settings → Account → Switch to Professional Account.</>  
                          )}
                        </p>
                      </div>
                    ))}
                  </div>

                  <button type="button" onClick={() => setIgGuideStep(1)} className="w-full h-9 rounded-xl bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/30 text-pink-300 font-bold text-[11px] transition-colors flex items-center justify-center gap-2">
                    Next: Get your Account ID <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {igGuideStep === 1 && (
                <div className="space-y-4">
                  <p className="text-slate-400 leading-relaxed">Your <strong className="text-white">Instagram Business Account ID</strong> is a numeric string. Here are two ways to find it:</p>

                  <div className="space-y-3">
                    <div className="rounded-xl bg-slate-800/60 border border-border/20 p-4 space-y-2">
                      <p className="text-[11px] font-bold text-white">Method A — Graph API Explorer</p>
                      <div className="space-y-2 text-[11px]">
                        <div className="flex gap-2"><span className="text-pink-400 font-bold shrink-0">1.</span><span>Open the <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline inline-flex items-center gap-0.5">Graph API Explorer <ExternalLink className="h-2.5 w-2.5" /></a></span></div>
                        <div className="flex gap-2"><span className="text-pink-400 font-bold shrink-0">2.</span><span>Select your App and generate a User Access Token with <code className="bg-slate-700 px-1 rounded text-[10px]">instagram_basic</code> permission</span></div>
                        <div className="flex gap-2"><span className="text-pink-400 font-bold shrink-0">3.</span><span>In the path field enter: <code className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">me/accounts</code> and click Submit</span></div>
                        <div className="flex gap-2"><span className="text-pink-400 font-bold shrink-0">4.</span><span>Click on your Facebook Page → then call <code className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">{"/{page-id}/instagram_accounts"}</code></span></div>
                        <div className="flex gap-2"><span className="text-pink-400 font-bold shrink-0">5.</span><span>The <code className="bg-slate-700 px-1 rounded text-[10px]">id</code> value is your <strong className="text-white">Instagram Business Account ID</strong></span></div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-800/60 border border-border/20 p-4 space-y-2">
                      <p className="text-[11px] font-bold text-white">Method B — Business Suite Settings</p>
                      <div className="space-y-2 text-[11px]">
                        <div className="flex gap-2"><span className="text-pink-400 font-bold shrink-0">1.</span><span>Open <a href="https://business.facebook.com/settings/instagram-accounts" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline inline-flex items-center gap-0.5">Meta Business Suite → Settings → Accounts → Instagram <ExternalLink className="h-2.5 w-2.5" /></a></span></div>
                        <div className="flex gap-2"><span className="text-pink-400 font-bold shrink-0">2.</span><span>Click on your account — the URL will contain your numeric Account ID</span></div>
                      </div>
                    </div>
                  </div>

                  <button type="button" onClick={() => setIgGuideStep(2)} className="w-full h-9 rounded-xl bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/30 text-pink-300 font-bold text-[11px] transition-colors flex items-center justify-center gap-2">
                    Next: Get your Access Token <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {igGuideStep === 2 && (
                <div className="space-y-4">
                  <p className="text-slate-400 leading-relaxed">You need a <strong className="text-white">Page Access Token</strong> (not a User token) with publishing permissions. This token lasts 60 days and must be renewed.</p>

                  <div className="space-y-2 rounded-xl bg-slate-800/60 border border-border/20 p-4">
                    <p className="text-[11px] font-bold text-white mb-2">Steps to generate your token:</p>
                    {[
                      { s: "1.", t: <span>Go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline inline-flex items-center gap-0.5">Graph API Explorer <ExternalLink className="h-2.5 w-2.5" /></a></span> },
                      { s: "2.", t: "Select your App from the dropdown" },
                      { s: "3.", t: <span>Click <strong className="text-white">&quot;Generate Access Token&quot;</strong> — select these permissions: <code className="bg-slate-700 px-1 rounded text-[10px]">instagram_basic</code>, <code className="bg-slate-700 px-1 rounded text-[10px]">instagram_content_publish</code>, <code className="bg-slate-700 px-1 rounded text-[10px]">pages_read_engagement</code></span> },
                      { s: "4.", t: "This gives a short-lived User token. Now exchange it for a Page token:" },
                      { s: "5.", t: <span>Call <code className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">GET /me/accounts</code> with your User token — copy the <code className="bg-slate-700 px-1 rounded text-[10px]">access_token</code> from your Facebook Page</span> },
                      { s: "6.", t: <span>To extend to 60 days: call <code className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap">{"GET /oauth/access_token?grant_type=fb_exchange_token&..."}</code> — the <a href="https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline">full docs are here</a></span> },
                    ].map((item, i) => (
                      <div key={i} className="flex gap-2 text-[11px]">
                        <span className="text-pink-400 font-bold shrink-0">{item.s}</span>
                        <span className="leading-relaxed">{item.t}</span>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 flex gap-2 text-[10px] text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span><strong>Tip:</strong> Keep your app in <strong>Development Mode</strong> — this lets you test without Meta App Review. You just need to add yourself as a Tester in App Roles.</span>
                  </div>

                  <button type="button" onClick={() => setShowIgGuide(false)} className="w-full h-9 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 font-bold text-[11px] transition-colors flex items-center justify-center gap-2">
                    <Check className="h-3.5 w-3.5" /> Done — I have my credentials
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* YouTube simulated connection modal */}
      {connectingPlatform === "YouTube" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-border/40 rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 flex items-center gap-3 border-b border-border/20 bg-slate-950">
              <svg className="h-5 w-5 fill-current text-white" viewBox="0 0 24 24">
                <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.113-6.886 4.113-4.907 0-8.882-4.004-8.882-9s3.975-9 8.882-9c2.296 0 4.418.872 6.002 2.305l3.123-3.116C18.665.986 15.65 0 12.24 0 5.48 0 0 5.373 0 12s5.48 12 12.24 12c6.7 0 12.24-5.373 12.24-12 0-.817-.074-1.618-.214-2.39H12.24z"/>
              </svg>
              <h3 className="text-xs font-bold uppercase tracking-wider">Sign in with Google</h3>
            </div>
            <div className="p-6 flex-grow flex flex-col justify-center min-h-[180px]">
              {simStep === 0 && (
                <div className="space-y-4 text-center">
                  <p className="text-xs text-slate-300 leading-relaxed">Google will grant AuraClip access to manage videos and uploads for channel &ldquo;{ytHandle}&rdquo;.</p>
                  <div className="flex gap-2.5 pt-2">
                    <Button type="button" variant="ghost" onClick={() => setConnectingPlatform(null)} className="flex-1 h-9 rounded-xl text-xs hover:bg-white/5">Cancel</Button>
                    <Button type="button" onClick={() => { setSimStep(1); setTimeout(() => setSimStep(2), 2000); }} className="flex-1 h-9 rounded-xl text-xs font-bold text-white cursor-pointer bg-violet-600 hover:bg-violet-500">Agree & Connect</Button>
                  </div>
                </div>
              )}
              {simStep === 1 && (
                <div className="flex flex-col items-center justify-center text-center space-y-3 py-4">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                  <div>
                    <h4 className="text-xs font-bold text-white">Linking accounts...</h4>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Authorizing API scopes.</p>
                  </div>
                </div>
              )}
              {simStep === 2 && (
                <div className="space-y-4 text-center animate-in scale-in-95 duration-150">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"><Check className="h-5 w-5" /></div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Connection Established!</h4>
                    <p className="text-[10px] text-muted-foreground mt-0.5">&ldquo;{ytHandle}&rdquo; is now connected. Click Save to persist configuration.</p>
                  </div>
                  <Button type="button" onClick={handleConnectYoutubeSuccess} className="w-full h-9 rounded-xl bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold cursor-pointer">Return to Settings</Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
