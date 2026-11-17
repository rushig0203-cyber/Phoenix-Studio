import type { Metadata } from "next";
import PublicInfoPage from "@/components/PublicInfoPage";

export const metadata: Metadata = {
  title: "Privacy policy — Phoenix Studio",
  description: "How the personal Phoenix Studio app uses YouTube permissions, stores connected-account data and handles local videos and optional AI requests.",
};

export default function PrivacyPage() {
  return <PublicInfoPage title="Privacy policy" description="Effective November 17, 2026. This notice describes the personal, owner-operated Phoenix Studio installation and these public information pages.">
    <section>
      <h2>YouTube permissions and data</h2>
      <p>Connecting YouTube requests <code>youtube.readonly</code>. Phoenix Studio reads the authorized channel&apos;s ID and name to identify the destination and display its channel link. Enabling YouTube uploads separately requests <code>youtube.upload</code>. The app does not request Google email, Gmail, Drive or YouTube Analytics permissions.</p>
      <p>Google returns access tokens, a refresh token when available, granted permissions and token-expiry information. Phoenix Studio uses these to maintain the connection and perform the approved YouTube actions.</p>
      <p>Only after the final Post to YouTube action does the app send the selected local MP4, title, description, privacy choice and made-for-kids setting to YouTube. It saves the resulting video ID or link, upload status and returned visibility with the local publishing record.</p>
    </section>
    <section>
      <h2>Use and sharing of Google data</h2>
      <p>Phoenix Studio uses Google API data to identify the connected channel and carry out or report uploads that the operator approves. It does not sell Google API data, use it for advertising, or use it to train AI models. Google OAuth tokens are not sent to the app&apos;s AI providers.</p>
      <p>The app follows the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements. Google&apos;s handling of information sent to its services is described in the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>
    </section>
    <section>
      <h2>Local storage and protection</h2>
      <p>Connected-account details and access or refresh tokens are saved in an encrypted credential vault on the installation&apos;s computer. On Windows, the vault uses DPAPI protection tied to the current Windows user. OAuth tokens are handled by the local server and are not returned to browser screens.</p>
      <p>Imported media, finished videos, editing files, captions, job records and publishing history are also stored locally. These working files and records are separate from the encrypted account vault. The computer&apos;s operator controls access to those files and any backups.</p>
      <p>The browser remembers recently shown template IDs and a pending creation request so suggestions can rotate and interrupted requests can be restored. The connection flow also uses temporary browser and server state to bind consent to the browser that started it.</p>
    </section>
    <section>
      <h2>Other connected services and optional AI</h2>
      <p>The operator may separately connect Instagram or a linked Facebook Page, search footage libraries, or configure a writing provider. Those features send the information needed for the selected request to that service, such as a footage search, writing prompt or explicitly approved video upload.</p>
      <p>With separate sampled-frame permission, caption analysis can send three small video-frame samples and limited related text to the configured Groq or Cloudflare provider. This permission is separate from Google authorization. Turning it off in Writing settings stops future frame requests to that provider.</p>
      <p>Providers apply their own data-handling and retention policies to information sent to them. Local files remain saved for editing, review and retries; enabling a provider does not erase those files.</p>
    </section>
    <section>
      <h2>Disconnecting, revoking access and deletion</h2>
      <p>Use Settings → Your channels → Disconnect to remove the selected local account, its tokens and pending consent requests from Phoenix Studio. Disconnect does not revoke the Google grant or delete previously uploaded YouTube videos, local media, job or upload history, saved upload sessions, or app client credentials.</p>
      <p>To revoke Google access, remove Phoenix Studio in your <a href="https://myaccount.google.com/connections">Google Account&apos;s third-party connections</a>. Manage or delete uploaded videos directly on YouTube. Reconnecting requires authorization again.</p>
      <p>Remaining local files, records, private app settings and backups are under the installation operator&apos;s control. Library Trash is recoverable and does not erase the underlying media. For questions or help identifying remaining app data, contact the maintainer through the <a href="https://github.com/rushig0203-cyber/Phoenix-Studio/issues">public issue tracker</a>; issues are public.</p>
    </section>
    <section>
      <h2>Public pages and policy updates</h2>
      <p>These information pages do not require an app account or Google sign-in and do not add advertising or analytics scripts. Hosting and network services may process ordinary request information, such as IP addresses, browser details and page requests, to serve the website.</p>
      <p>Changes to the app&apos;s use of Google data will be described here before that use is enabled, with additional consent where required. The <a href="/about">About page</a> describes the app, and the <a href="/terms">terms of use</a> cover reviewing and publishing content.</p>
    </section>
  </PublicInfoPage>;
}
