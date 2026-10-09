"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Camera, Link2, Loader2, RefreshCw, Play } from "lucide-react";
import type { ChannelPlatform, ChannelStatus } from "@/lib/channelConnections";
import { socialHandle } from "@/lib/socialAccounts";

const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:cursor-wait disabled:opacity-50";
const field = "mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400";
const names = { youtube: "YouTube", instagram: "Instagram" };

export default function ChannelConnections({ compact = false }: { compact?: boolean }) {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ChannelPlatform | null>(null);
  const actionInFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [setup, setSetup] = useState<ChannelPlatform | null>(null);
  const [credentials, setCredentials] = useState({ clientId: "", clientSecret: "", accessToken: "", pageId: "" });
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/channels", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load channel connections.");
      setChannels(data.channels);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Channel connections are unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const query = new URLSearchParams(window.location.search);
    if (query.has("channelError")) setNotice(query.get("channelError") || "Channel connection failed.");
    else if (query.has("channelConnected")) setNotice("Account verified. Check upload permission below, then use a finished video's posting tools.");
  }, [load]);

  function showSetup(channel: ChannelStatus) {
    setSetup(setup === channel.platform ? null : channel.platform);
    setCredentials({ clientId: channel.clientId, clientSecret: "", accessToken: "", pageId: channel.pageId || "" });
    setNotice("");
  }
  function connectInstagram() {
    if (!credentials.accessToken.trim()) { setNotice("Paste your Instagram access token into the private input first."); return; }
    const pageId = credentials.pageId.trim();
    if (pageId && !/^\d{5,30}$/.test(pageId)) {
      setNotice("Use the numeric Page ID from Meta Business Suite → Business assets → your Page → Summary, not a Facebook profile URL."); return;
    }
    // The backend normalizes quoted tokens and Authorization/Bearer headers.
    void action("instagram", { action: "instagram-token", accessToken: credentials.accessToken, ...(pageId ? { pageId } : {}) });
  }
  async function action(platform: ChannelPlatform, data: Record<string, string>, method = "POST") {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(platform); setNotice("");
    try {
      const response = await fetch(`/api/channels/${platform}`, { method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(data) } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The channel action failed.");
      if (result.authorizationUrl) { window.location.assign(result.authorizationUrl); return; }
      setChannels(result.channels);
      setCredentials((current) => ({ ...current, clientSecret: "", accessToken: "", pageId: "" }));
      setNotice(method === "DELETE" ? "Disconnected from Phoenix. You can also remove Phoenix access in your platform account settings." : data.action === "configure"
        ? platform === "instagram" ? result.channels?.find((item: ChannelStatus) => item.platform === "instagram")?.connected
          ? "Meta app credentials saved securely. Your Instagram token connection is retained. Try Find location in a video's posting review; Meta decides lookup access."
          : "Meta app credentials saved securely. Connect Instagram with a token issued by this same app."
        : "App credentials saved securely on this PC. Select Enable YouTube uploads to authorize your channel."
        : "Connection verified successfully.");
      if (data.action === "instagram-token") setSetup(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The channel action failed."); await load(); }
    finally { actionInFlight.current = false; setBusy(null); }
  }

  return <section id="channels" className="scroll-mt-5 rounded-2xl border border-white/10 bg-[#18191d] p-5 text-white">
    <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-violet-400"/>Your channels</h2><p className="mt-1 text-xs leading-5 text-slate-400">Connect your account, then enable uploading access. Upload reviewed videos from their posting tools, or use the manual platform links below.</p></div><button className={button} onClick={() => void load()} disabled={loading || Boolean(busy)} aria-label="Refresh channel status"><RefreshCw className="h-3.5 w-3.5"/></button></div>
    {notice && <p role="status" className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/10 p-3 text-xs leading-5 text-violet-100">{notice}</p>}
    {loading ? <p className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin"/>Loading channels…</p> : <div className={`mt-4 grid gap-3 ${compact ? "" : "xl:grid-cols-2"}`}>
      {channels.map((channel) => {
        const platform = channel.platform, Icon = platform === "youtube" ? Play : Camera;
        return <div key={platform} className="rounded-xl border border-white/10 bg-black/15 p-4">
          <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><Icon className={`h-4 w-4 ${platform === "youtube" ? "text-red-400" : "text-pink-400"}`}/>{names[platform]}</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${channel.connected ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{channel.connected ? "Connected" : channel.state === "needs_attention" ? "Reconnect needed" : "Not connected"}</span></div>
          <p className="mt-2 text-xs text-slate-300">{channel.name || (platform === "instagram" ? `Intended account: ${socialHandle("instagram")}` : "Choose your YouTube channel")}</p>
          {channel.verifiedAt && <p className="mt-1 text-[10px] text-slate-500">Last verified {new Date(channel.verifiedAt).toLocaleString()}</p>}
          {channel.error && <p className="mt-2 text-xs text-amber-300">{channel.error}</p>}
          <p className={`mt-2 text-xs ${channel.publishReady ? "text-emerald-300" : "text-slate-400"}`}>{channel.publishReady ? "Ready for confirmed uploads" : channel.publishReason || "Uploading is not authorized yet."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(channel.connected || channel.state === "needs_attention") && <><button className={button} disabled={Boolean(busy)} onClick={() => void action(platform, { action: "verify" })}>{busy === platform ? <Loader2 className="h-3 w-3 animate-spin"/> : <RefreshCw className="h-3 w-3"/>}Check connection</button><button className={button} disabled={Boolean(busy)} onClick={() => void action(platform, {}, "DELETE")}>Disconnect</button></>}
            {!channel.connected && <button className={button} disabled={Boolean(busy)} onClick={() => channel.configured && channel.oauthAvailable ? void action(platform, { action: "connect" }) : showSetup(channel)}>{busy === platform ? "Connecting…" : `Connect ${names[platform]}`}</button>}
            {platform === "youtube" && !channel.publishReady && <button className={button} disabled={Boolean(busy)} onClick={() => channel.configured ? void action(platform, { action: "connect", intent: "upload" }) : showSetup(channel)}>Enable YouTube uploads</button>}
            <a className={button} href={platform === "youtube" ? "https://www.youtube.com/upload" : "https://www.instagram.com/"} target="_blank" rel="noopener noreferrer">{platform === "youtube" ? "Open YouTube upload" : "Open Instagram · Create"}<ExternalLink className="h-3 w-3"/></a>
            <button className={button} disabled={Boolean(busy)} onClick={() => showSetup(channel)}>{setup === platform ? "Close setup" : "Connection setup"}</button>
          </div>
          {setup === platform && <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
            {platform === "youtube" ? <><p className="text-xs leading-5 text-slate-400">In Google Cloud, enable YouTube Data API v3, configure the OAuth consent screen with your account as a test user, then create a Web application OAuth client. Add this exact redirect URI:</p><code className="block break-all rounded-lg bg-black/20 p-2 text-[11px] text-slate-300">{channel.redirectUri}</code><a className="inline-flex items-center gap-1 text-xs text-violet-300 underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Open Google credentials<ExternalLink className="h-3 w-3"/></a><p className="text-xs text-slate-400">Connect verifies your channel with read-only access. Enable YouTube uploads requests separate upload consent; connecting alone never publishes anything or enables a paid AI service.</p></> : <>
              <p className="text-xs leading-5 text-slate-400">Use a Creator or Business account. An Instagram Login token connects directly without a Facebook Page, but this local-file uploader currently supports Facebook Login. Link your professional Instagram account to its Facebook Page and authorize that Page.</p>
              <p className="text-xs leading-5 text-slate-400">For uploading from Graph API Explorer, grant instagram_basic, instagram_content_publish, pages_show_list and pages_read_engagement. Page roles granted through Business Manager may additionally require ads_read. An accepted identity-only token is not publishing permission.</p>
              <a className="inline-flex items-center gap-1 text-xs text-violet-300 underline" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Open Graph API Explorer · Facebook Login tokens<ExternalLink className="h-3 w-3"/></a>
              <form onSubmit={(event) => { event.preventDefault(); if (!busy) connectInstagram(); }} className="space-y-3">
                <label className="block text-xs">Instagram access token<input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={16000} className={field} value={credentials.accessToken} onChange={(event) => setCredentials({ ...credentials, accessToken: event.target.value })} placeholder="Paste token or Authorization: Bearer header"/></label>
                <label className="block text-xs">Facebook Page ID (optional)<input type="text" inputMode="numeric" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={30} pattern="[0-9]{5,30}" className={field} value={credentials.pageId} onChange={(event) => setCredentials({ ...credentials, pageId: event.target.value })} placeholder="For a Page missing from Meta’s automatic list"/></label>
                <p className="text-xs leading-5 text-slate-400">Find the actual Page ID in Meta Business Suite → Settings → Business assets → your Page → Summary. The ID in a Facebook profile URL may be different. Phoenix verifies the Page and its linked Instagram account before saving.</p>
                <button type="submit" className={button} disabled={Boolean(busy)}>{busy === platform ? <Loader2 className="h-3 w-3 animate-spin"/> : null}Verify and connect Instagram</button>
              </form>
              <p className="text-xs text-slate-500">Local HTTP is supported for token verification. No token is displayed in connection status and nothing is posted by connecting.</p>
            </>}
            {platform === "instagram" && <div className="space-y-2"><h3 className="text-xs font-semibold">Meta app credentials · location search</h3><p className="text-xs leading-5 text-slate-400">Use App settings → Basic in the same Meta app that issued your saved Facebook Login token. These fields work on localhost; adding the app for the first time retains that token connection. Name lookup also needs Meta&apos;s Pages Search access. No ads, payment or publishing happens here.</p><a className="inline-flex items-center gap-1 text-xs text-violet-300 underline" href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer">Open Meta app settings<ExternalLink className="h-3 w-3"/></a></div>}
            <form onSubmit={(event) => { event.preventDefault(); if (!busy) void action(platform, { action: "configure", clientId: credentials.clientId, clientSecret: credentials.clientSecret }); }} className="space-y-3">
              <label className="block text-xs">{platform === "youtube" ? "OAuth client ID" : "Meta app ID"}<input className={field} value={credentials.clientId} onChange={(event) => setCredentials({ ...credentials, clientId: event.target.value })} autoComplete="off" maxLength={500} required/></label>
              <label className="block text-xs">{platform === "youtube" ? "OAuth client secret" : "Meta app secret"}<input type="password" className={field} value={credentials.clientSecret} onChange={(event) => setCredentials({ ...credentials, clientSecret: event.target.value })} autoComplete="off" maxLength={2000} placeholder={channel.hasClientSecret ? "Saved · leave blank to keep" : "Enter the app secret"} required={!channel.hasClientSecret}/></label>
              {channel.clientId && credentials.clientId.trim() !== channel.clientId && <p className="text-xs text-amber-300">Replacing the saved app ID disconnects this channel. Reconnect with the new app after saving.</p>}
              <div className="flex flex-wrap gap-2"><button type="submit" className={button} disabled={Boolean(busy) || !credentials.clientId.trim()}>Save app credentials</button>{channel.configured && channel.oauthAvailable && <button type="button" className={button} disabled={Boolean(busy)} onClick={() => void action(platform, { action: "connect", ...(platform === "youtube" ? { intent: "upload" } : {}) })}>{platform === "youtube" ? "Authorize YouTube uploads" : `Connect ${names[platform]}`}</button>}</div>
            </form>
            <p className="text-[10px] leading-4 text-slate-500">Secrets are encrypted in this computer&apos;s private storage. Each finished video asks for your final approval before any upload. Manual download and posting links remain available.</p>
          </div>}
        </div>;
      })}
    </div>}
  </section>;
}
