export const QUICK_TEMPLATE_STORAGE_KEY = "phoenix-quick-template-v1";

export type QuickTemplateRequest = {
  requestId: string;
  templateId: string;
  title: string;
  query: string;
  jobId?: string;
};

export function parseQuickTemplateRequest(raw: string | null): QuickTemplateRequest | null {
  try {
    if (!raw || raw.length > 2048) return null;
    const value = JSON.parse(raw);
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)
      || ![value.templateId, value.title, value.query].every(text => typeof text === "string" && text.trim().length >= 2 && text.length <= 100 && !/[\u0000-\u001f\u007f]/.test(text))
      || (value.jobId !== undefined && (typeof value.jobId !== "string" || !/^[a-z0-9_-]{1,180}$/i.test(value.jobId)))) return null;
    return { requestId: value.requestId, templateId: value.templateId, title: value.title, query: value.query, ...(value.jobId ? { jobId: value.jobId } : {}) };
  } catch { return null; }
}

export function quickTemplateReview<T extends { id: string; status: string; processing?: { jobId?: string } }>(files: T[], jobId?: string): T | undefined {
  return jobId ? files.find(file => file.status === "READY" && (file.processing?.jobId === jobId || file.id === jobId)) : undefined;
}
