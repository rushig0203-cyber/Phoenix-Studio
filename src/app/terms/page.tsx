import type { Metadata } from "next";
import PublicInfoPage from "@/components/PublicInfoPage";

export const metadata: Metadata = {
  title: "Terms of use — Phoenix Studio",
  description: "Usage responsibilities for the personal Phoenix Studio app, including content rights, final video review and connected services.",
};

export default function TermsPage() {
  return <PublicInfoPage title="Terms of use" description="Effective November 17, 2026. These terms describe use of the personal, owner-operated Phoenix Studio video app.">
    <section>
      <h2>Your workspace and content</h2>
      <p>Use Phoenix Studio with media and accounts you own or have permission to manage. The local installation&apos;s operator controls its files, connected channels and provider settings.</p>
      <p>Before publishing, confirm that you have the rights needed for the footage, music, narration, images and other material in the video. Check source licences and include any required credits. A suggestion or generated caption does not establish those rights.</p>
    </section>
    <section>
      <h2>Review before posting</h2>
      <p>Watch and listen to the complete finished video. Check its accuracy, captions, soundtrack, description, destination account, visibility and made-for-kids setting. The final Post action authorizes the selected upload with those choices.</p>
      <p>Connecting an account or opening a preview does not publish a video. An approved upload can continue processing in the saved queue. Check the app&apos;s status and the destination platform before retrying an uncertain upload.</p>
    </section>
    <section>
      <h2>Connected services</h2>
      <p>Phoenix Studio uses YouTube API Services for its optional YouTube connection and uploads. Using those features also means agreeing to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>. Google&apos;s processing is described in the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>
      <p>Other connected platforms, footage libraries and configured writing providers have their own terms and usage limits. Review those terms before enabling a service or using its material. Platform processing, permissions and final visibility are determined by the platform.</p>
    </section>
    <section>
      <h2>Files, access and questions</h2>
      <p>Keep the local files and backups you need. Disconnecting a channel removes its local account connection; it does not delete local videos, publishing history or videos already uploaded to the platform. The <a href="/privacy">privacy policy</a> explains storage, optional AI requests, revocation and deletion in more detail.</p>
      <p>Read <a href="/about">About Phoenix Studio</a> for the app&apos;s purpose. App and policy questions can be raised through the <a href="https://github.com/rushig0203-cyber/Phoenix-Studio/issues">public repository issue tracker</a>. Issues are public.</p>
    </section>
  </PublicInfoPage>;
}
