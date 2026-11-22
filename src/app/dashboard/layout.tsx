import styles from "./space.module.css";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div data-studio-theme="night" data-studio-space className={`${styles.scene} min-h-screen text-foreground`}>
    <div aria-hidden="true" data-studio-starfield className={styles.starfield}>
      <div data-star-depth="far" className={`${styles.layer} ${styles.far}`} />
      <div data-star-depth="middle" className={`${styles.layer} ${styles.middle}`} />
      <div data-star-depth="near" className={`${styles.layer} ${styles.near}`} />
    </div>
    <div data-studio-space-content className={styles.content}>{children}</div>
  </div>;
}
