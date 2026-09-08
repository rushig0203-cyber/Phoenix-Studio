const message =
  "Legacy cloud export worker is disabled in free local mode. Use the local review-file export flow.";

console.error(message);
process.exitCode = 1;

export {};
