"use strict";
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Shield, Check, Globe, HelpCircle, Loader2 } from "lucide-react";
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
  const [webhookUrl, setWebhookUrl] = useState("");
  const [igConnected, setIgConnected] = useState(false);
  const [igHandle, setIgHandle] = useState("");
  const [ytConnected, setYtConnected] = useState(false);
  const [ytHandle, setYtHandle] = useState("");
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [connectingPlatform, setConnectingPlatform] = useState<"Instagram" | "YouTube" | null>(null);
  const [simStep, setSimStep] = useState(0);

  // Load current settings from database on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings/publish");
        if (res.ok) {
          const data = await res.json();
          setWebhookUrl(data.makeWebhookUrl || "");
          setIgConnected(data.instagramConnected || false);
          setIgHandle(data.instagramAccountName || "");
          setYtConnected(data.youtubeConnected || false);
          setYtHandle(data.youtubeChannelName || "");
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
    setIsSaving(true);
    setErrorMsg("");
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/settings/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          makeWebhookUrl: webhookUrl,
          instagramConnected: igConnected,
          instagramAccountName: igHandle,
          youtubeConnected: ytConnected,
          youtubeChannelName: ytHandle,
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        const data = await res.json();
        setErrorMsg(data.error || "Failed to save settings");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleInstagram = () => {
    if (igConnected) {
      setIgConnected(false);
      setIgHandle("");
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

            {/* Social channels connection card */}
            <div className="rounded-2xl border border-border/40 bg-card/20 p-6 space-y-6 shadow-xl">
              <div className="border-b border-border/20 pb-4">
                <h2 className="text-base font-bold text-white">Social Media Connections</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Toggle and customize target accounts. Make.com will orchestrate direct publishing hooks.</p>
              </div>

              <div className="space-y-6">
                {/* Instagram Channel Box */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/20 border border-border/20">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400">
                      <Instagram className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Instagram Business Account</h4>
                      <p className="text-[10px] text-muted-foreground">Automatically post Reels via Make.com triggers.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {igConnected ? (
                      <>
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                          Connected: @{igHandle}
                        </span>
                        <Button
                          type="button"
                          onClick={toggleInstagram}
                          className="h-8 px-4 text-xs font-bold bg-white/5 border border-border/30 hover:bg-rose-600 hover:text-white rounded-lg cursor-pointer"
                        >
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          placeholder="creator_handle"
                          value={igHandle}
                          onChange={(e) => setIgHandle(e.target.value)}
                          className="h-8 rounded-lg border border-border/40 bg-slate-950/40 px-3 text-[11px] text-white focus:border-violet-500 focus:outline-none placeholder-slate-700 w-36"
                        />
                        <Button
                          type="button"
                          onClick={toggleInstagram}
                          className="h-8 px-4 text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white rounded-lg cursor-pointer"
                        >
                          Connect
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* YouTube Channel Box */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/20 border border-border/20">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-600/10 border border-rose-500/20 text-rose-500">
                      <Youtube className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">YouTube Shorts Channel</h4>
                      <p className="text-[10px] text-muted-foreground">Automatically post YouTube Shorts via Make.com triggers.</p>
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

      {/* Simulated OAuth popup Modal */}
      {connectingPlatform && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-border/40 rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className={`p-4 flex items-center gap-3 border-b border-border/20 text-white ${
              connectingPlatform === "Instagram" ? "bg-gradient-to-r from-blue-600 to-indigo-600" : "bg-slate-950"
            }`}>
              {connectingPlatform === "Instagram" ? (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-blue-600 font-extrabold text-sm">
                  f
                </div>
              ) : (
                <svg className="h-5 w-5 fill-current text-white" viewBox="0 0 24 24">
                  <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.113-6.886 4.113-4.907 0-8.882-4.004-8.882-9s3.975-9 8.882-9c2.296 0 4.418.872 6.002 2.305l3.123-3.116C18.665.986 15.65 0 12.24 0 5.48 0 0 5.373 0 12s5.48 12 12.24 12c6.7 0 12.24-5.373 12.24-12 0-.817-.074-1.618-.214-2.39H12.24z"/>
                </svg>
              )}
              <h3 className="text-xs font-bold uppercase tracking-wider">
                {connectingPlatform === "Instagram" ? "Connect with Facebook" : "Sign in with Google"}
              </h3>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex-grow flex flex-col justify-center min-h-[180px]">
              {simStep === 0 && (
                <div className="space-y-4 text-center">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {connectingPlatform === "Instagram" 
                      ? `Facebook will grant AuraClip access to manage Reels and publish media for @${igHandle}.`
                      : `Google will grant AuraClip access to manage videos and uploads for channel "${ytHandle}".`
                    }
                  </p>
                  
                  {/* Account Selector */}
                  <div className="rounded-xl border border-border/20 bg-slate-950/40 p-3 flex items-center justify-between text-left text-xs">
                    <div>
                      <p className="font-bold text-white">Rishi Kumar</p>
                      <p className="text-[10px] text-muted-foreground">rishi@gmail.com</p>
                    </div>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-violet-400">
                      Active Session
                    </span>
                  </div>

                  <div className="flex gap-2.5 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConnectingPlatform(null)}
                      className="flex-1 h-9 rounded-xl text-xs hover:bg-white/5"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        setSimStep(1);
                        setTimeout(() => setSimStep(2), 2000);
                      }}
                      className={`flex-1 h-9 rounded-xl text-xs font-bold text-white cursor-pointer ${
                        connectingPlatform === "Instagram" ? "bg-blue-600 hover:bg-blue-500" : "bg-violet-600 hover:bg-violet-500"
                      }`}
                    >
                      Agree & Connect
                    </Button>
                  </div>
                </div>
              )}

              {simStep === 1 && (
                <div className="flex flex-col items-center justify-center text-center space-y-3 py-4">
                  <Loader2 className={`h-8 w-8 animate-spin ${
                    connectingPlatform === "Instagram" ? "text-blue-500" : "text-violet-500"
                  }`} />
                  <div>
                    <h4 className="text-xs font-bold text-white">Linking Connected accounts...</h4>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Authorizing API publishing scopes and security credentials.</p>
                  </div>
                </div>
              )}

              {simStep === 2 && (
                <div className="space-y-4 text-center animate-in scale-in-95 duration-150">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Connection Established!</h4>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {connectingPlatform === "Instagram" 
                        ? `@${igHandle} is now connected. Click Save to persist configuration.`
                        : `"${ytHandle}" is now connected. Click Save to persist configuration.`
                      }
                    </p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => {
                      if (connectingPlatform === "Instagram") setIgConnected(true);
                      if (connectingPlatform === "YouTube") setYtConnected(true);
                      setConnectingPlatform(null);
                    }}
                    className="w-full h-9 rounded-xl bg-slate-800 hover:bg-slate-750 text-white text-xs font-bold cursor-pointer"
                  >
                    Return to Settings
                  </Button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
