export type LocalProject = {
  id: string;
  title: string;
  duration: number;
  previewUrl: string;
};

// These projects deliberately stay on the local machine. They are available in
// the editor but never require S3, an API key, or a cloud upload.
export const localProjects: LocalProject[] = [
  { id: "local-01", title: "Weekly business review", duration: 30, previewUrl: "/local-videos/01-weekly-business-review.mp4" },
  { id: "local-02", title: "Track customer feedback", duration: 30, previewUrl: "/local-videos/02-customer-feedback.mp4" },
  { id: "local-03", title: "Make a useful business budget", duration: 30, previewUrl: "/local-videos/03-business-budget.mp4" },
  { id: "local-04", title: "Why a clear offer wins attention", duration: 30, previewUrl: "/local-videos/04-clear-offer.mp4" },
  { id: "local-05", title: "Build a weekly business review", duration: 30, previewUrl: "/local-videos/05-weekly-review.mp4" },
];

export function getLocalProject(id: string) {
  return localProjects.find((project) => project.id === id);
}
